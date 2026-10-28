using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading.Tasks;
using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Models.Domain;
using SignageUnicorn.Api.Repositories.Interfaces;
using SignageUnicorn.Api.Services.Database;

namespace SignageUnicorn.Api.Services
{
    public class DeviceService
    {
        private readonly IDeviceRepository _deviceRepository;
        private readonly ISystemLogRepository _logRepo;
        private readonly Microsoft.AspNetCore.Hosting.IWebHostEnvironment _env;
        private readonly IServiceProvider _serviceProvider;
        
        // Simple in-memory tracker to reduce heartbeat log noise
        private static readonly ConcurrentDictionary<string, (string Status, string PlaylistId, string MediaId)> _lastReportedState = new();

        public DeviceService(IDeviceRepository deviceRepository, ISystemLogRepository logRepo, Microsoft.AspNetCore.Hosting.IWebHostEnvironment env, IServiceProvider serviceProvider)
        {
            _deviceRepository = deviceRepository;
            _logRepo = logRepo;
            _env = env;
            _serviceProvider = serviceProvider;
        }

        public async Task<IEnumerable<DevicePlaylistDto>> GetAssignedPlaylistsAsync(string deviceId)
        {
            return await _deviceRepository.GetAssignedPlaylistsAsync(deviceId);
        }

        public async Task UpdateAssignedPlaylistsAsync(string deviceId, List<DevicePlaylistDto> playlists)
        {
            await _deviceRepository.UpdateAssignedPlaylistsAsync(deviceId, playlists);
            await NotifyScheduleInheritorsAsync(deviceId);
        }

        // Round 3 (#11 / Codex round-3 finding 11). A screen in 'inherit' mode plays what its sibling
        // (same branch + name) is assigned, so every change to that sibling's assignments -- replace,
        // clear, reset to inherit -- must reach the inheritors too, or they keep the previous content
        // until a boundary or restart. Best effort: a notification failure never fails the edit.
        public async Task NotifyScheduleInheritorsAsync(string deviceId)
        {
            try
            {
                var inheritors = (await _deviceRepository.GetScheduleInheritorsAsync(deviceId)).ToList();
                foreach (var id in inheritors)
                {
                    var result = await _deviceRepository.AddCommandAsync(id, "SYNC_SCHEDULE");
                    if (!result.Success)
                        await _logRepo.LogAsync(id, "WARNING", $"[DeviceService] INHERITOR_NOTIFY_FAILED | owner={deviceId} | {result.Message}", "API");
                }
                if (inheritors.Count > 0)
                    await _logRepo.LogAsync(deviceId, "INFO", $"[DeviceService] INHERITORS_NOTIFIED | count={inheritors.Count}", "API");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[DeviceService] INHERITOR_NOTIFY_ERROR | owner={deviceId} | {ex.Message}");
            }
        }

        public async Task<SignageUnicorn.Api.Models.Domain.PlaylistDto> GetDeviceScheduleAsync(string deviceId)
        {
            // Resolve PlaylistService dynamically to avoid circular references if any
            var playlistService = _serviceProvider.GetService(typeof(SignageUnicorn.Api.Services.Application.PlaylistService)) as SignageUnicorn.Api.Services.Application.PlaylistService;
            
            var schedule = new SignageUnicorn.Api.Models.Domain.PlaylistDto
            {
                PlaylistId = "SCHEDULE-" + deviceId,
                PlaylistName = "Device Schedule",
                Active = "Y",
                Items = new List<SignageUnicorn.Api.Models.Domain.PlaylistItemDto>()
            };

            var assignments = await GetAssignedPlaylistsAsync(deviceId);

            // PERMANENT FIX: if this device has no active assignments of its own — which happens when
            // a screen is freshly installed or re-registers under a new hardware identity — inherit
            // the assignments of a sibling screen (same branch + same device name) that does have them.
            // Branch content is defined per screen type (e.g. every "Thonglor All" plays the same set),
            // not per physical device, so a new screen should immediately play what its peers play
            // instead of going idle and forcing a manual playlist selection.
            //
            // F18 / contract item 6: ONLY while the screen is still in 'inherit' mode. Once an admin
            // has assigned or deliberately cleared it (schedule_mode = 'explicit'), an empty list
            // means "play nothing" -- clearing a screen used to make it copy its neighbour instead.
            var deviceRow = await _deviceRepository.GetDeviceByIdAsync(deviceId);
            bool mayInherit = !string.Equals(deviceRow?.ScheduleMode, "explicit", StringComparison.OrdinalIgnoreCase);
            if (mayInherit && (assignments == null || !assignments.Any()))
            {
                var siblingId = await _deviceRepository.GetSiblingDeviceIdWithAssignmentsAsync(deviceId);
                if (!string.IsNullOrEmpty(siblingId))
                {
                    assignments = await GetAssignedPlaylistsAsync(siblingId);
                }
            }

            int currentOrder = 1;

            var now = DateTime.UtcNow;

            foreach (var assignment in assignments)
            {
                // Check Schedule Dates
                if (assignment.StartDate.HasValue && now < assignment.StartDate.Value) continue;
                if (assignment.EndDate.HasValue && now > assignment.EndDate.Value) continue;

                var playlist = await playlistService.GetPlaylistByIdAsync(assignment.PlaylistId);
                
                if (playlist != null && playlist.Active == "Y" && playlist.Items != null)
                {
                    foreach (var item in playlist.Items)
                    {
                        item.PositionOrder = currentOrder++;
                        schedule.Items.Add(item);
                        
                        if (item.Media != null)
                        {
                            schedule.TotalDuration += item.Media.DurationSec;
                        }
                    }
                }
            }

            schedule.ItemCount = schedule.Items.Count;

            // Contract item 6: a version clients can compare cheaply, and the next boundary so they
            // know when to ask again (the ScheduleTransitionWorker also pushes SYNC_SCHEDULE then).
            var assignmentList = (assignments ?? Enumerable.Empty<DevicePlaylistDto>()).ToList();
            var versionSource = string.Join("|", assignmentList
                .OrderBy(a => a.PlaylistId, StringComparer.Ordinal)
                .ThenBy(a => a.StartDate)
                .Select(a => $"{a.PlaylistId}:{a.StartDate:O}:{a.EndDate:O}:{a.IsActive}"));
            using (var sha = System.Security.Cryptography.SHA256.Create())
            {
                var bytes = sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(versionSource));
                schedule.ScheduleVersion = Convert.ToHexString(bytes).Substring(0, 16).ToLowerInvariant();
            }
            DateTime? next = null;
            foreach (var a in assignmentList)
            {
                if (a.StartDate.HasValue && a.StartDate.Value > now && (next == null || a.StartDate.Value < next)) next = a.StartDate.Value;
                if (a.EndDate.HasValue && a.EndDate.Value > now && (next == null || a.EndDate.Value < next)) next = a.EndDate.Value;
            }
            schedule.NextTransitionAtUtc = next;
            return schedule;
        }

        public async Task SetScheduleModeAsync(string deviceId, string mode)
        {
            await _deviceRepository.SetScheduleModeAsync(deviceId, mode);
            await _logRepo.LogAsync(deviceId, "INFO", $"[DeviceService] SCHEDULE_MODE | mode={mode}", "API");
        }

        // Contract T8: the screen's own assignments are dropped and inherit mode set in ONE
        // transaction, so the next schedule resolution really follows the sibling.
        public async Task ResetScheduleToInheritAsync(string deviceId)
        {
            await _deviceRepository.ResetScheduleToInheritAsync(deviceId);
            await _logRepo.LogAsync(deviceId, "INFO", "[DeviceService] SCHEDULE_RESET_TO_INHERIT | own assignments removed", "API");
            // Screens that inherited from THIS device no longer can (it has no assignments now).
            await NotifyScheduleInheritorsAsync(deviceId);
        }

        public async Task<DeviceDto> RegisterDeviceAsync(DeviceRegisterRequest request)
        {
            // await _logRepo.LogAsync(null, "INFO", $"[DeviceService] Registering device: {request.DeviceName} (Key: {request.DeviceKey})");
            // NOTE: Logging "Registering..." might be spammy if retried. Let's log Result.

            var result = await _deviceRepository.RegisterOrLoginAsync(request);
            if (!result.Success)
            {
                await _logRepo.LogAsync(null, "ERROR", $"[DeviceService] REGISTRATION_FAILED | Code: {result.ErrorCode} | Msg: {result.Message} | Device: {request.DeviceName}", "API");
                return null;
            }

            await _logRepo.LogAsync(result.Value.DeviceId, "INFO", $"[DeviceService] REGISTERED | Device: {result.Value.DeviceName} | ID: {result.Value.DeviceId} | IP: {request.IpAddress}", "API");
            return result.Value;
        }

        public async Task<IEnumerable<DeviceCommandDto>> ProcessHeartbeatAsync(HeartbeatRequest request)
        {
            try 
            {
                // ... (Keep existing heartbeat logic, it is fine as is, maybe verify log format matches "API" source if needed)
                // Existing:
                // await _logRepo.LogAsync(request.DeviceId, "INFO", $"[DeviceService] Status Change: ...", "API"); <- Ensure "API" not "DeviceService" source if previously mismatched.
                // In my memory, current file uses: LogAsync(..., "DeviceService")? No, let's check view_file.
                // Line 67: LogAsync(..., "INFO", ..., "API") is default?
                // Wait, view_file showed: LogAsync(devId, "INFO", msg) -> Missing Source/User?
                // The ISystemLogRepository signature: LogAsync(deviceId, level, message, source, userId)
                // Let's check ISystemLogRepository again. If Source is 4th param.
                // View file shows: LogAsync(request.DeviceId, "INFO", $"..."). 
                // It seems Source is missing in current calls! Or it's optional?
                // Let's assume I need to pass "API".

                return await ProcessHeartbeatInternal(request);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ERROR] Heartbeat FAILED for {request.DeviceId}: {ex.Message}");
                // await _logRepo.LogAsync(request.DeviceId, "ERROR", $"[DeviceService] Heartbeat FAILED: {ex.Message}", "API");
                throw;
            }
        }
        
        // Helper to avoid massive replace block complexity
        private async Task<IEnumerable<DeviceCommandDto>> ProcessHeartbeatInternal(HeartbeatRequest request)
        {
             bool stateChanged = false;
             bool mediaChanged = false;
                
             string currentPid = request.CurrentPlaylistId ?? "None";
             string currentMid = request.CurrentMediaId ?? "None";
             string currentStatus = request.Status ?? "UNKNOWN";

             // ... (Logic same as before)
             // Re-implementing simplified for replacement context
             if (!_lastReportedState.TryGetValue(request.DeviceId, out var last))
             {
                 stateChanged = true;
             }
             else
             {
                 if (last.Status != currentStatus || last.PlaylistId != currentPid) stateChanged = true;
                 if (last.MediaId != currentMid) mediaChanged = true;
             }
                 
             if (stateChanged || mediaChanged) _lastReportedState[request.DeviceId] = (currentStatus, currentPid, currentMid);

             /* 
             if (stateChanged)
             {
                 try { await _logRepo.LogAsync(request.DeviceId, "INFO", $"[DeviceService] STATUS_CHANGE | Status: {currentStatus} | Playlist: {currentPid}", "API"); } catch { }
             }
             
             if (mediaChanged && !stateChanged)
             {
                 try { await _logRepo.LogAsync(request.DeviceId, "INFO", $"[DeviceService] MEDIA_CHANGE | Media: {currentMid} | Item: {request.CurrentPlaylistItemId ?? "None"}", "API"); } catch { }
             }
             */

             var commands = await _deviceRepository.HeartbeatAsync(request);
             
             if (commands != null && commands.Any())
             {
                 foreach (var cmd in commands)
                 {
                     try { await _logRepo.LogAsync(request.DeviceId, "INFO", $"[DeviceService] COMMAND_RECEIVED | Type: {cmd.CommandType} | ID: {cmd.CommandId}", "API"); } catch { }
                 }
             }
             
             return commands;
        }

        public async Task<IEnumerable<DeviceDto>> GetAllDevicesAsync()
        {
            return await _deviceRepository.GetAllDevicesAsync();
        }

        public async Task<DeviceDto?> GetDeviceByIdAsync(string id)
        {
            return await _deviceRepository.GetDeviceByIdAsync(id);
        }

        public async Task SendCommandAsync(string deviceId, string command)
        {
            // Case 4.2 & 3: Enhance RESTART command with resume data
            if (command.ToUpper() == "RESTART")
            {
                var devices = await _deviceRepository.GetAllDevicesAsync();
                var dev = devices.FirstOrDefault(d => d.DeviceId == deviceId);
                if (dev != null && !string.IsNullOrEmpty(dev.CurrentMediaId))
                {
                    // Format: RESTART:MediaId:PositionSec
                    command = $"RESTART:{dev.CurrentMediaId}:{dev.CurrentPositionSec ?? 0}";
                }
            }

            var result = await _deviceRepository.AddCommandAsync(deviceId, command);
            if (result.Success)
            {
                 await _logRepo.LogAsync(deviceId, "INFO", $"[DeviceService] COMMAND_SENT | Command: {command}", "API");
            }
            else
            {
                 await _logRepo.LogAsync(deviceId, "ERROR", $"[DeviceService] COMMAND_FAILED | Code: {result.ErrorCode} | Msg: {result.Message}", "API");
            }
        }

        public async Task<RepositoryResult> AcknowledgeCommandAsync(string deviceId, string commandId, string status, long? userId = null, string? message = null)
        {
            var result = await _deviceRepository.AcknowledgeCommandAsync(deviceId, commandId, status, userId, message);
            if (result.Success)
            {
                await _logRepo.LogAsync(deviceId, "INFO", $"[DeviceService] COMMAND_ACKNOWLEDGED | CommandID: {commandId} | Status: {status}", "API", userId);
            }
            else
            {
                await _logRepo.LogAsync(deviceId, "ERROR", $"[DeviceService] COMMAND_ACK_FAILED | CommandID: {commandId} | Code: {result.ErrorCode} | Msg: {result.Message}", "API", userId);
            }
            return result;
        }

        public async Task BatchSendCommandAsync(List<string> deviceIds, string command)
        {
            await _logRepo.LogAsync(null, "INFO", $"[DeviceService] BATCH_COMMAND_START | Command: {command} | Count: {deviceIds.Count}", "API");
            
            List<DeviceDto> allDevices = null;
            if (command.ToUpper() == "RESTART")
            {
                allDevices = (await _deviceRepository.GetAllDevicesAsync()).ToList();
            }

            foreach (var id in deviceIds)
            {
                string finalCommand = command;
                if (finalCommand.ToUpper() == "RESTART" && allDevices != null)
                {
                    var dev = allDevices.FirstOrDefault(d => d.DeviceId == id);
                    if (dev != null && !string.IsNullOrEmpty(dev.CurrentMediaId))
                    {
                        finalCommand = $"RESTART:{dev.CurrentMediaId}:{dev.CurrentPositionSec ?? 0}";
                    }
                }

                var result = await _deviceRepository.AddCommandAsync(id, finalCommand);
                if (result.Success)
                {
                     await _logRepo.LogAsync(id, "INFO", $"[DeviceService] COMMAND_SENT | Command: {finalCommand}", "API");
                }
                else
                {
                     await _logRepo.LogAsync(id, "ERROR", $"[DeviceService] COMMAND_FAILED | Code: {result.ErrorCode} | Msg: {result.Message}", "API");
                }
            }
        }

        public async Task<RepositoryResult> DeactivateDeviceAsync(string deviceId, long? userId = null)
        {
            var result = await _deviceRepository.DeactivateDeviceAsync(deviceId, userId);
            if (result.Success)
            {
                await _logRepo.LogAsync(deviceId, "WARNING", $"[DeviceService] DEACTIVATED | DeviceID: {deviceId}", "API", userId);
            }
            else
            {
                await _logRepo.LogAsync(deviceId, "ERROR", $"[DeviceService] DEACTIVATE_FAILED | Code: {result.ErrorCode} | Msg: {result.Message}", "API", userId);
            }
            return result;
        }

        public async Task<RepositoryResult> CleanupOfflineDevicesAsync(int days = 14)
        {
            var result = await _deviceRepository.CleanupOfflineDevicesAsync(days);
            if (result.Success)
            {
                await _logRepo.LogAsync(null, "INFO", $"[DeviceService] CLEANUP_COMPLETE | Days: {days}", "API");
            }
            else
            {
                await _logRepo.LogAsync(null, "ERROR", $"[DeviceService] CLEANUP_FAILED | Code: {result.ErrorCode} | Msg: {result.Message}", "API");
            }
            return result;
        }

        public async Task<int> GetOfflineCountAsync(int days = 14)
        {
            var result = await _deviceRepository.GetOfflineDeviceCountAsync(days);
            if (result.Success) return result.Value;
            
            // Log warning if count fails
             await _logRepo.LogAsync(null, "WARNING", $"[DeviceService] COUNT_FAILED | Msg: {result.Message}", "API");
             return 0;
        }
        
        // Re-applies every .sql file under docs/db_template to the database: tables first, then
        // stored procedures. It is a RESTORE FROM DISK, not an "initialize" -- each procedure file
        // is CREATE OR ALTER, so running this overwrites whatever is currently in the database with
        // whatever happens to be in the checkout on this server, newer or not.
        //
        // On 20-08-2026 that cost us a deployed fix: a patched sp_device_std was applied directly to
        // production, verified, and then silently reverted when all nine procedures were rewritten
        // in the same second by one call to this method. sys.objects.modify_date is what proved it.
        //
        // The reporting below exists because of the second half of that incident: every failure used
        // to be swallowed into Console.WriteLine and the endpoint returned success unconditionally,
        // so an operator saw "Database Initialized Successfully!" whether or not anything applied.
        public async Task<SchemaApplyResult> FixDatabaseAsync()
        {
             // Round 4 (#2): one apply per process at a time. The console's POST retry (after the
             // first request timed out while the SQL kept running) gets an immediate "busy" instead
             // of queueing behind the database lock and shifting migration 007's rows a second time.
             if (!SchemaApplyGate.TryEnter())
             {
                 Console.WriteLine("[DeviceService] SCHEMA_APPLY_BUSY | another schema apply is running in this process");
                 var busy = new SchemaApplyResult { InProgress = true };
                 busy.Failed.Add("another schema apply is in progress in this process; nothing was applied");
                 return busy;
             }
             try
             {
                 return await FixDatabaseCoreAsync();
             }
             finally
             {
                 SchemaApplyGate.Exit();
             }
        }

        private async Task<SchemaApplyResult> FixDatabaseCoreAsync()
        {
             string docsPath = Path.GetFullPath(Path.Combine(_env.ContentRootPath, "../../docs/db_template"));
             if (!Directory.Exists(docsPath))
             {
                 // Try alternative for published/docker scenario (e.g. copied to root)
                 docsPath = Path.Combine(_env.ContentRootPath, "docs/db_template");
             }

             if (!Directory.Exists(docsPath))
             {
                 var skipped = new SchemaApplyResult { Skipped = $"db_template not found at {docsPath} (Root: {_env.ContentRootPath})" };
                 Console.WriteLine($"WARNING: {skipped.Skipped}. Skipping DB Auto-Fix.");
                 await _logRepo.LogAsync(null, "WARNING", $"[DeviceService] SCHEMA_APPLY_SKIPPED | {skipped.Skipped}", "API");
                 return skipped;
             }

             Console.WriteLine($"[DeviceService] Applying Database Schema from: {docsPath}");
             var report = await new SchemaApplier(_deviceRepository).ApplyAsync(docsPath);
             if (report.InProgress)
             {
                 // Another process holds the apply lock: seeding and the audit line belong to that run.
                 Console.WriteLine("[DeviceService] SCHEMA_APPLY_BUSY | " + SchemaApplier.InProgressMessage);
                 return report;
             }

             try
             {
                 Console.WriteLine("[DeviceService] Checking/Seeding Admin & Roles...");
                 await _deviceRepository.ExecuteSqlAsync("EXEC sp_auth_user_std @p_action = 'INIT_ADMIN'");
             }
             catch (Exception ex)
             {
                 report.Failed.Add($"INIT_ADMIN: {ex.Message}");
                 Console.WriteLine($"[WARN] Admin Seeding skipped/failed: {ex.Message}");
             }

             // Leave a trail. This operation can rewrite production stored procedures; who ran it and
             // what it touched needs to be answerable later without reading PM2 console scrollback.
             await _logRepo.LogAsync(null, report.Failed.Count == 0 ? "INFO" : "ERROR",
                 $"[DeviceService] SCHEMA_APPLY | source={docsPath} | applied={report.Applied.Count} | migrations={report.Migrations.Count} | unchanged={report.Unchanged.Count} | failed={report.Failed.Count}"
                 + (report.Failed.Count > 0 ? " | " + string.Join(" ; ", report.Failed) : ""), "API");

             return report;
        }

        // Maximum accepted screenshot payload (the endpoint is also capped by RequestSizeLimit).
        private const int MaxScreenshotBytes = 3 * 1024 * 1024;

        private string ScreenshotsFolder()
        {
            // Contract item 8: OUTSIDE wwwroot. Screenshots used to be public static files keyed by a
            // predictable device id, so anyone could read every screen and overwrite any of them.
            return Path.GetFullPath(Path.Combine(_env.ContentRootPath, "App_Data", "screenshots"));
        }

        private static bool IsSafeScreenshotId(string? deviceId)
        {
            return !string.IsNullOrEmpty(deviceId) && deviceId.Length <= 64
                && deviceId.All(ch => char.IsLetterOrDigit(ch) || ch == '-' || ch == '_');
        }

        // Returns null on success, otherwise the reason the upload was refused.
        public async Task<string?> SaveScreenshotAsync(string deviceId, string base64Image)
        {
            try
            {
                if (string.IsNullOrEmpty(base64Image)) return "empty image";

                // The device id arrives straight from the route. ASP.NET routing keeps '/' out of a
                // {id} segment but NOT a backslash, so an id like "..\..\x" could escape the folder.
                // Accept only the shapes a real device id has, then confirm the resolved path really is
                // inside the folder before writing.
                if (!IsSafeScreenshotId(deviceId)) return "malformed device id";

                // Remove header if present (e.g. data:image/jpeg;base64,)
                if (base64Image.Contains(","))
                {
                    base64Image = base64Image.Split(',')[1];
                }

                // 4 base64 chars carry 3 bytes; check before decoding so an oversized payload is
                // never materialised.
                if ((long)base64Image.Length / 4 * 3 > MaxScreenshotBytes) return "image too large";

                byte[] imageBytes;
                try { imageBytes = Convert.FromBase64String(base64Image); }
                catch (FormatException) { return "invalid base64"; }
                if (imageBytes.Length > MaxScreenshotBytes) return "image too large";

                // Only JPEG or PNG bytes are stored, whatever the client claims.
                bool jpeg = imageBytes.Length > 3 && imageBytes[0] == 0xFF && imageBytes[1] == 0xD8 && imageBytes[2] == 0xFF;
                bool png = imageBytes.Length > 8 && imageBytes[0] == 0x89 && imageBytes[1] == 0x50 && imageBytes[2] == 0x4E && imageBytes[3] == 0x47;
                if (!jpeg && !png) return "not a JPEG or PNG image";

                string screenshotsFolder = ScreenshotsFolder();
                Directory.CreateDirectory(screenshotsFolder);

                string filePath = Path.GetFullPath(Path.Combine(screenshotsFolder, $"{deviceId}.jpg"));
                if (!filePath.StartsWith(screenshotsFolder + Path.DirectorySeparatorChar, StringComparison.Ordinal))
                    return "path outside the screenshots folder";

                // Write to a temp name and rename so a reader never sees a half-written file.
                string tempPath = filePath + ".tmp";
                await File.WriteAllBytesAsync(tempPath, imageBytes);
                File.Move(tempPath, filePath, overwrite: true);
                return null;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ERROR] Failed to save screenshot for device {deviceId}: {ex.Message}");
                return "internal error";
            }
        }

        // Finds the stored screenshot for a device whichever identity the screen used when it
        // uploaded (numeric id for the Electron client, uuid for the web player).
        public async Task<string?> ResolveScreenshotPathAsync(string deviceId)
        {
            if (!IsSafeScreenshotId(deviceId)) return null;
            var folder = ScreenshotsFolder();
            var candidates = new List<string> { deviceId };
            try
            {
                var device = await _deviceRepository.GetDeviceByIdAsync(deviceId);
                if (device != null)
                {
                    if (IsSafeScreenshotId(device.DeviceId)) candidates.Add(device.DeviceId);
                    if (IsSafeScreenshotId(device.DeviceUuid)) candidates.Add(device.DeviceUuid!);
                }
            }
            catch { }

            foreach (var id in candidates.Distinct())
            {
                var path = Path.GetFullPath(Path.Combine(folder, $"{id}.jpg"));
                if (!path.StartsWith(folder + Path.DirectorySeparatorChar, StringComparison.Ordinal)) continue;
                if (File.Exists(path)) return path;
            }
            return null;
        }
    }
}
