using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading.Tasks;
using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Models.Domain;
using SignageUnicorn.Api.Repositories.Interfaces;

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
            if (assignments == null || !assignments.Any())
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
            return schedule;
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

        public async Task AcknowledgeCommandAsync(string deviceId, string commandId, string status, long? userId = null)
        {
            var result = await _deviceRepository.AcknowledgeCommandAsync(deviceId, commandId, status, userId);
            if (result.Success)
            {
                await _logRepo.LogAsync(deviceId, "INFO", $"[DeviceService] COMMAND_ACKNOWLEDGED | CommandID: {commandId} | Status: {status}", "API", userId);
            }
            else
            {
                await _logRepo.LogAsync(deviceId, "ERROR", $"[DeviceService] COMMAND_ACK_FAILED | CommandID: {commandId} | Code: {result.ErrorCode} | Msg: {result.Message}", "API", userId);
            }
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
             var report = new SchemaApplyResult();

             string docsPath = Path.GetFullPath(Path.Combine(_env.ContentRootPath, "../../docs/db_template"));
             if (!Directory.Exists(docsPath))
             {
                 // Try alternative for published/docker scenario (e.g. copied to root)
                 docsPath = Path.Combine(_env.ContentRootPath, "docs/db_template");
             }

             if (!Directory.Exists(docsPath))
             {
                 report.Skipped = $"db_template not found at {docsPath} (Root: {_env.ContentRootPath})";
                 Console.WriteLine($"WARNING: {report.Skipped}. Skipping DB Auto-Fix.");
                 await _logRepo.LogAsync(null, "WARNING", $"[DeviceService] SCHEMA_APPLY_SKIPPED | {report.Skipped}", "API");
                 return report;
             }

             report.SourcePath = docsPath;
             Console.WriteLine($"[DeviceService] Applying Database Schema from: {docsPath}");

             // 1. Tables (Execute first)
             string tablePath = Path.Combine(docsPath, "table");
             if (Directory.Exists(tablePath))
             {
                 foreach (var file in Directory.GetFiles(tablePath, "*.sql").OrderBy(f => f))
                 {
                     var error = await ExecuteSqlFile(file);
                     if (error == null) report.Applied.Add(Path.GetFileName(file));
                     else report.Failed.Add($"{Path.GetFileName(file)}: {error}");
                 }
             }

             // 2. Procedures
             string procPath = Path.Combine(docsPath, "procedure");
             if (Directory.Exists(procPath))
             {
                 foreach (var file in Directory.GetFiles(procPath, "*.sql").OrderBy(f => f))
                 {
                     var error = await ExecuteSqlFile(file);
                     if (error == null) report.Applied.Add(Path.GetFileName(file));
                     else report.Failed.Add($"{Path.GetFileName(file)}: {error}");
                 }
             }

             try
             {
                 Console.WriteLine("[DeviceService] Checking/Seeding Admin & Roles...");
                 // Direct SQL Execution because we might not have a Repository ready or want to bypass it
                 await _deviceRepository.ExecuteSqlAsync("EXEC sp_auth_user_std @p_action = 'INIT_ADMIN'");
             }
             catch (Exception ex)
             {
                 report.Failed.Add($"INIT_ADMIN: {ex.Message}");
                 Console.WriteLine($"[WARN] Admin Seeding skipped/failed: {ex.Message}");
             }

             // Leave a trail. This operation rewrites production stored procedures; who ran it and
             // what it touched needs to be answerable later without reading PM2 console scrollback.
             await _logRepo.LogAsync(null, report.Failed.Count == 0 ? "INFO" : "ERROR",
                 $"[DeviceService] SCHEMA_APPLY | source={docsPath} | applied={report.Applied.Count} | failed={report.Failed.Count}"
                 + (report.Failed.Count > 0 ? " | " + string.Join(" ; ", report.Failed) : ""), "API");

             return report;
        }
        // Maximum accepted screenshot payload. The endpoint is [AllowAnonymous] and reachable from
        // the public tunnel, so an unbounded body is a disk-fill and memory-pressure primitive.
        private const int MaxScreenshotBytes = 8 * 1024 * 1024;

        public async Task SaveScreenshotAsync(string deviceId, string base64Image)
        {
            try
            {
                if (string.IsNullOrEmpty(base64Image)) return;

                // The device id arrives straight from the route and used to be interpolated into a
                // file path. ASP.NET routing keeps '/' out of a {id} segment, but NOT '\' -- so on
                // Windows an id like "..\..\wwwroot\something" escaped the screenshots folder, and
                // this endpoint is anonymous. Accept only the shapes a real device id has (digits,
                // or a uuid/WIN- identity), then confirm the resolved path really is inside the
                // folder before writing. Two checks, because the first is a guess about what ids
                // look like and the second is a fact about where the file lands.
                if (deviceId.Length is 0 or > 64 ||
                    !deviceId.All(ch => char.IsLetterOrDigit(ch) || ch == '-' || ch == '_'))
                {
                    Console.WriteLine($"[WARN] Rejected screenshot for malformed device id: {deviceId}");
                    return;
                }

                // Remove header if present (e.g. data:image/jpeg;base64,)
                if (base64Image.Contains(","))
                {
                    base64Image = base64Image.Split(',')[1];
                }

                // 4 base64 chars carry 3 bytes; check before decoding so an oversized payload is
                // never materialised.
                if ((long)base64Image.Length / 4 * 3 > MaxScreenshotBytes)
                {
                    Console.WriteLine($"[WARN] Rejected oversized screenshot for device {deviceId}");
                    return;
                }

                byte[] imageBytes = Convert.FromBase64String(base64Image);
                if (imageBytes.Length > MaxScreenshotBytes)
                {
                    Console.WriteLine($"[WARN] Rejected oversized screenshot for device {deviceId}");
                    return;
                }

                string screenshotsFolder = Path.GetFullPath(
                    Path.Combine(_env.WebRootPath ?? Path.Combine(_env.ContentRootPath, "wwwroot"), "screenshots"));
                if (!Directory.Exists(screenshotsFolder))
                {
                    Directory.CreateDirectory(screenshotsFolder);
                }

                string filePath = Path.GetFullPath(Path.Combine(screenshotsFolder, $"{deviceId}.jpg"));
                if (!filePath.StartsWith(screenshotsFolder + Path.DirectorySeparatorChar, StringComparison.Ordinal))
                {
                    Console.WriteLine($"[WARN] Rejected screenshot path outside the screenshots folder: {filePath}");
                    return;
                }

                await File.WriteAllBytesAsync(filePath, imageBytes);
                Console.WriteLine($"[DeviceService] Saved screenshot for device {deviceId} to {filePath}");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ERROR] Failed to save screenshot for device {deviceId}: {ex.Message}");
            }
        }
        // Returns null on success, or the failure message. Callers record it; nothing here is
        // swallowed. The one exception kept from the original is "already exists", which a table
        // script legitimately hits on every run after the first and is not a failure.
        private async Task<string?> ExecuteSqlFile(string filePath)
        {
            try
            {
                string content = await File.ReadAllTextAsync(filePath);

                // Split by 'GO' (case insensitive, separate lines)
                // Using Regex to find GO on its own line
                var batches = System.Text.RegularExpressions.Regex.Split(content, @"^\s*GO\s*$", System.Text.RegularExpressions.RegexOptions.Multiline | System.Text.RegularExpressions.RegexOptions.IgnoreCase);

                foreach (var batch in batches)
                {
                    if (string.IsNullOrWhiteSpace(batch)) continue;

                    // Basic cleanup
                    string sql = batch.Trim();
                    if (sql.Length > 0)
                    {
                       await _deviceRepository.ExecuteSqlAsync(sql);
                    }
                }
                Console.WriteLine($" -> Executed: {Path.GetFileName(filePath)}");
                return null;
            }
            catch (Exception ex)
            {
                if (ex.Message.Contains("There is already an object named", StringComparison.OrdinalIgnoreCase) ||
                    ex.Message.Contains("already exists", StringComparison.OrdinalIgnoreCase))
                {
                    return null;
                }
                Console.WriteLine($"[ERROR] Failed to execute {Path.GetFileName(filePath)}: {ex.Message}");
                return ex.Message;
            }
        }
    }

    // Outcome of re-applying docs/db_template. Exists so the caller can tell an operator what
    // actually happened instead of reporting success unconditionally.
    public class SchemaApplyResult
    {
        public List<string> Applied { get; set; } = new();
        public List<string> Failed { get; set; } = new();
        public string? Skipped { get; set; }
        public string? SourcePath { get; set; }
        public bool Success => Skipped == null && Failed.Count == 0;
    }
}
