using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Repositories.Interfaces;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using Microsoft.Extensions.Configuration;

namespace SignageUnicorn.Api.Services
{
    public class MediaService
    {
        private readonly IMediaRepository _repository;
        private readonly IWebHostEnvironment _environment;
        private readonly ISystemLogRepository _systemLog;
        private readonly IHttpContextAccessor _httpContextAccessor;
        private readonly IConfiguration _configuration;
        private readonly IDeviceRepository _deviceRepository;

        public MediaService(IMediaRepository repository, 
                            IWebHostEnvironment environment, 
                            IHttpContextAccessor httpContextAccessor, 
                            IConfiguration configuration, 
                            ISystemLogRepository systemLog,
                            IDeviceRepository deviceRepository)
        {
            _repository = repository;
            _environment = environment;
            _httpContextAccessor = httpContextAccessor;
            _configuration = configuration;
            _systemLog = systemLog;
            _deviceRepository = deviceRepository;
        }

        public async Task<IEnumerable<MediaFile>> GetAllMediaAsync(string? searchTerm = null, string? supplierCode = null, string? remark1 = null, string? remark2 = null, string? status = null, string? mediaType = null)
        {
            var media = await _repository.GetAllAsync(searchTerm, supplierCode, remark1, remark2, status, mediaType);
            return media.Select(m => TransformToAbsoluteUrl(m));
        }

        public async Task<MediaFile?> GetMediaByIdAsync(string id)
        {
            var media = await _repository.GetByIdAsync(id);
            return media != null ? TransformToAbsoluteUrl(media) : null;
        }

        private MediaFile TransformToAbsoluteUrl(MediaFile m)
        {
            if (string.IsNullOrEmpty(m.BlobUrl)) return m;

            // Case 1: Already a relative path (e.g. /media/file.mp4)
            // Return as-is — Next.js proxy handles /media/ routes,
            // so the browser will resolve it relative to the current page (HTTP or HTTPS)
            // This prevents Mixed Content errors on HTTPS pages.
            if (!m.BlobUrl.StartsWith("http", StringComparison.OrdinalIgnoreCase))
            {
                return m;
            }

            // Case 2: Absolute URL pointing to localhost/127.0.0.1 — strip host, make relative
            if (m.BlobUrl.Contains("localhost", StringComparison.OrdinalIgnoreCase) ||
                m.BlobUrl.Contains("127.0.0.1"))
            {
                int protoEnd = m.BlobUrl.IndexOf("://");
                if (protoEnd > 0)
                {
                    int firstSlashAfterProto = m.BlobUrl.IndexOf('/', protoEnd + 3);
                    if (firstSlashAfterProto > 0)
                    {
                        m.BlobUrl = m.BlobUrl.Substring(firstSlashAfterProto); // e.g. /media/file.mp4
                    }
                }
                return m;
            }

            // Case 3: Absolute URL with any IP address — strip host, make relative
            if (m.BlobUrl.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
            {
                // Check if it's a local IP (not a real domain)
                var uri = new System.Uri(m.BlobUrl);
                if (System.Net.IPAddress.TryParse(uri.Host, out _))
                {
                    m.BlobUrl = uri.PathAndQuery; // e.g. /media/file.mp4
                    return m;
                }
            }

            // Case 4: External absolute URL (signage.aith123.com, CDN, etc.) — keep as-is
            return m;
        }

        public async Task<MediaFile?> CreateMediaAsync(MediaUploadRequest request, long? userId = null)
        {
            string finalUrl = request.BlobUrl ?? "";
            string? fileHash = null;
            bool needsTranscoding = false;
            string? localFilePath = null;

            // Handle Local File Upload
            if (request.File != null && request.File.Length > 0)
            {
                // Ensure wwwroot/media exists
                string webRootPath = _environment.WebRootPath ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot");
                string uploadsFolder = Path.Combine(webRootPath, "media");
                
                if (!Directory.Exists(uploadsFolder))
                {
                     Directory.CreateDirectory(uploadsFolder);
                }

                // Generate unique filename to prevent overwrites
                string fileExtension = Path.GetExtension(request.File.FileName);
                string uniqueFileName = $"{Guid.NewGuid()}{fileExtension}";
                string filePath = Path.Combine(uploadsFolder, uniqueFileName);
                localFilePath = filePath;

                // Save file stream
                using (var fileStream = new FileStream(filePath, FileMode.Create))
                {
                    await request.File.CopyToAsync(fileStream);
                }

                var ext = fileExtension?.ToLowerInvariant();
                if (ext == ".mp4" || ext == ".mov" || ext == ".avi" || ext == ".webm")
                {
                    needsTranscoding = true;
                }

                var fileInfo = new FileInfo(filePath);

                // Save as relative path for portability, transform to absolute on output
                finalUrl = $"/media/{uniqueFileName}";
                
                // Auto-fill metadata if missing
                if (string.IsNullOrEmpty(request.FileName)) request.FileName = request.File.FileName;
                if (request.FileSizeKb == null || request.FileSizeKb == 0) request.FileSizeKb = (int)(fileInfo.Length / 1024);

                // Compute MD5 Hash for integrity check
                using (var md5 = System.Security.Cryptography.MD5.Create())
                using (var stream = File.OpenRead(filePath))
                {
                    var hashBytes = md5.ComputeHash(stream);
                    fileHash = BitConverter.ToString(hashBytes).Replace("-", "").ToLowerInvariant();
                }
            }

            var media = new MediaFile
            {
                FileName = request.FileName,
                DisplayName = request.DisplayName ?? request.FileName,
                BlobUrl = finalUrl,
                DurationSec = request.DurationSec,
                Ratio = request.Ratio,
                FileSizeKb = request.FileSizeKb,
                Supplier_Code = request.Supplier_Code,
                Remark1 = request.Remark1,
                Remark2 = request.Remark2,
                UploadedBy = "admin", // Legacy, now tracked by userId in DB
                Active = "Y",
                FileHash = fileHash,
                EndDate = request.EndDate
            };

            var result = await _repository.CreateAsync(media, userId);
            if (result.Success && result.Value != null)
            {
                var createdMedia = TransformToAbsoluteUrl(result.Value);
                await _systemLog.LogAsync(null, "INFO", $"[MediaService] UPLOAD_SUCCESS | FileName: {createdMedia.FileName} | MediaID: {createdMedia.MediaId}", "API", userId);

                // Start background transcoding if needed, to prevent request timeouts (500)
                if (needsTranscoding && !string.IsNullOrEmpty(localFilePath))
                {
                    var mediaId = result.Value.MediaId;
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            await _systemLog.LogAsync(null, "INFO", $"[MediaService] ASYNC_TRANSCODE_START | MediaID: {mediaId} | FilePath: {localFilePath}", "SYSTEM", userId);
                            
                            var convertedPath = await ConvertToBaselineFormatAsync(localFilePath);
                            var fileInfo = new FileInfo(convertedPath);
                            
                            string? finalHash = null;
                            using (var md5 = System.Security.Cryptography.MD5.Create())
                            using (var stream = File.OpenRead(convertedPath))
                            {
                                var hashBytes = md5.ComputeHash(stream);
                                finalHash = BitConverter.ToString(hashBytes).Replace("-", "").ToLowerInvariant();
                            }

                            // Update database record with converted file details
                            var existingMedia = await _repository.GetByIdAsync(mediaId);
                            if (existingMedia != null)
                            {
                                existingMedia.FileSizeKb = (int)(fileInfo.Length / 1024);
                                existingMedia.FileHash = finalHash;
                                await _repository.ReplaceAsync(existingMedia, userId);
                                await _systemLog.LogAsync(null, "INFO", $"[MediaService] ASYNC_TRANSCODE_SUCCESS | MediaID: {mediaId}", "SYSTEM", userId);

                                // Trigger Sync in case it was assigned to a playlist/device in the meantime
                                try
                                {
                                    var affectedDevices = await _deviceRepository.GetDevicesByMediaIdAsync(mediaId);
                                    foreach (var dev in affectedDevices)
                                    {
                                        await _deviceRepository.AddCommandAsync(dev.DeviceId, "FORCE_SYNC");
                                    }
                                }
                                catch { }
                            }
                        }
                        catch (Exception ex)
                        {
                            await _systemLog.LogAsync(null, "ERROR", $"[MediaService] ASYNC_TRANSCODE_FAILED | MediaID: {mediaId} | Error: {ex.Message}", "SYSTEM", userId);
                        }
                    });
                }

                return createdMedia;
            }
            return null;
        }

        public async Task<bool> UpdateMediaAsync(string id, MediaFile updateData, long? userId = null)
        {
            var existing = await _repository.GetByIdAsync(id);
            if (existing == null) return false;

            updateData.MediaId = id;
            var result = await _repository.UpdateAsync(updateData, userId);
            if (result.Success)
            {
                await _systemLog.LogAsync(null, "INFO", $"[MediaService] UPDATED | FileName: {existing.FileName} | MediaID: {id}", "API", userId);
            }
            return result.Success;
        }

        public async Task<string> DeleteMediaAsync(string id, bool force = false, long? userId = null)
        {
            // Case 2: Delete Protection (M05)
            if (!force)
            {
                var usage = await _repository.GetMediaUsageAsync(id);
                if (usage != null && usage.Any(u => u.UsageCount > 0))
                {
                    var playlistNames = string.Join(", ", usage.Where(u => u.UsageCount > 0).Select(u => u.PlaylistName));
                    return $"CANNOT_DELETE_USED: {playlistNames}";
                }
            }
            
            var result = await _repository.DeleteAsync(id, userId, force: force);
            if (result.Success)
            {
                await _systemLog.LogAsync(null, "INFO", $"[MediaService] DELETED | MediaID: {id}", "API", userId);
            }
            return result.Success ? "SUCCESS" : "NOT_FOUND";
        }

        public async Task<string> RestoreMediaAsync(string id, long? userId = null)
        {
            var result = await _repository.RestoreAsync(id, userId);
            if (result.Success)
            {
                 await _systemLog.LogAsync(null, "INFO", $"[MediaService] RESTORED | MediaID: {id}", "API", userId);
            }
            return result.Success ? "SUCCESS" : "ERROR";
        }

        public async Task<IEnumerable<MediaUsageDto>> GetMediaUsageAsync(string id)
        {
            return await _repository.GetMediaUsageAsync(id);
        }

        public async Task<bool> ReplaceMediaAsync(string oldId, string newId, bool archiveOld, long? userId = null)
        {
            // 1. Validate Both Exist
            var oldMedia = await _repository.GetByIdAsync(oldId);
            var newMedia = await _repository.GetByIdAsync(newId);

            if (oldMedia == null || newMedia == null) return false;

            // 2. Perform Swap
            var swapResult = await _repository.SwapMediaAsync(oldId, newId, userId);
            if (!swapResult.Success) return false;

            // 3. Log Swap
            await _systemLog.LogAsync(null, "INFO", $"[MediaService] REPLACE_USAGE | OldID: {oldId} | NewID: {newId} | Result: Success", "API", userId);

            // 4. Notify affected devices to Sync
            try 
            {
                var affectedDevices = await _deviceRepository.GetDevicesByMediaIdAsync(newId);
                foreach (var dev in affectedDevices)
                {
                    await _deviceRepository.AddCommandAsync(dev.DeviceId, "FORCE_SYNC");
                }
            } catch (Exception ex) {
                await _systemLog.LogAsync(null, "WARN", $"[MediaService] NOTIFY_FAILED | {ex.Message}", "API");
            }

            // 5. Handle Old Media (Archive vs Delete)
            if (!archiveOld)
            {
                // User chose DELETE (Not Archive) -> Soft Delete the old media
                // Note: It's safe to delete now because usage has been moved to newId
                await DeleteMediaAsync(oldId, force: true, userId: userId);
            }
            else
            {
                 // User chose ARCHIVE -> Keep it but set to Inactive to prevent usage in new playlists
                 oldMedia.Active = "N";
                 oldMedia.Remark2 = (oldMedia.Remark2 ?? "") + " [Archived]"; // Optional: Add note
                 await _repository.UpdateAsync(oldMedia, userId);
                 await _systemLog.LogAsync(null, "INFO", $"[MediaService] ARCHIVED (SOFT-RETIRED) | MediaID: {oldId}", "API", userId);
            }

            return true;
        }

        public async Task<MediaFile?> ReplaceMediaContentAsync(string id, MediaUploadRequest request, long? userId = null)
        {
            var existing = await _repository.GetByIdAsync(id);
            if (existing == null) return null;

            string finalUrl = request.BlobUrl ?? existing.BlobUrl;
            string? fileHash = existing.FileHash;
            bool needsTranscoding = false;
            string? localFilePath = null;

            // Handle Local File Upload (logic duplicated from CreateMediaAsync for now, could be refactored)
            if (request.File != null && request.File.Length > 0)
            {
                string webRootPath = _environment.WebRootPath ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot");
                string uploadsFolder = Path.Combine(webRootPath, "media");
                if (!Directory.Exists(uploadsFolder)) Directory.CreateDirectory(uploadsFolder);

                string fileExtension = Path.GetExtension(request.File.FileName);
                string uniqueFileName = $"{Guid.NewGuid()}{fileExtension}";
                string filePath = Path.Combine(uploadsFolder, uniqueFileName);
                localFilePath = filePath;

                using (var fileStream = new FileStream(filePath, FileMode.Create))
                {
                    await request.File.CopyToAsync(fileStream);
                }

                var ext = fileExtension?.ToLowerInvariant();
                if (ext == ".mp4" || ext == ".mov" || ext == ".avi" || ext == ".webm")
                {
                    needsTranscoding = true;
                }

                var fileInfo = new FileInfo(filePath);

                finalUrl = $"/media/{uniqueFileName}";

                if (string.IsNullOrEmpty(request.FileName)) request.FileName = request.File.FileName;
                if (request.FileSizeKb == null || request.FileSizeKb == 0) request.FileSizeKb = (int)(fileInfo.Length / 1024);

                using (var md5 = System.Security.Cryptography.MD5.Create())
                using (var stream = File.OpenRead(filePath))
                {
                    var hashBytes = md5.ComputeHash(stream);
                    fileHash = BitConverter.ToString(hashBytes).Replace("-", "").ToLowerInvariant();
                }
            }

            var media = new MediaFile
            {
                MediaId = id,
                FileName = request.FileName ?? existing.FileName,
                BlobUrl = finalUrl,
                DurationSec = request.DurationSec != 0 ? request.DurationSec : existing.DurationSec,
                Ratio = request.Ratio ?? existing.Ratio,
                FileSizeKb = request.FileSizeKb ?? existing.FileSizeKb,
                FileHash = fileHash,
                EndDate = request.EndDate ?? existing.EndDate 
            };

            var result = await _repository.ReplaceAsync(media, userId);
            if (result.Success)
            {
                await _systemLog.LogAsync(null, "INFO", $"[MediaService] CONTENT_REPLACED | FileName: {media.FileName} | MediaID: {id}", "API", userId);

                // Start background transcoding if needed, to prevent request timeouts (500)
                if (needsTranscoding && !string.IsNullOrEmpty(localFilePath))
                {
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            await _systemLog.LogAsync(null, "INFO", $"[MediaService] ASYNC_REPLACE_TRANSCODE_START | MediaID: {id} | FilePath: {localFilePath}", "SYSTEM", userId);
                            
                            var convertedPath = await ConvertToBaselineFormatAsync(localFilePath);
                            var fileInfo = new FileInfo(convertedPath);
                            
                            string? finalHash = null;
                            using (var md5 = System.Security.Cryptography.MD5.Create())
                            using (var stream = File.OpenRead(convertedPath))
                            {
                                var hashBytes = md5.ComputeHash(stream);
                                finalHash = BitConverter.ToString(hashBytes).Replace("-", "").ToLowerInvariant();
                            }

                            var existingMedia = await _repository.GetByIdAsync(id);
                            if (existingMedia != null)
                            {
                                existingMedia.FileSizeKb = (int)(fileInfo.Length / 1024);
                                existingMedia.FileHash = finalHash;
                                await _repository.ReplaceAsync(existingMedia, userId);
                                await _systemLog.LogAsync(null, "INFO", $"[MediaService] ASYNC_REPLACE_TRANSCODE_SUCCESS | MediaID: {id}", "SYSTEM", userId);

                                // Trigger Sync now that the database has the transcoded file hash
                                try
                                {
                                    var affectedDevices = await _deviceRepository.GetDevicesByMediaIdAsync(id);
                                    foreach (var dev in affectedDevices)
                                    {
                                        await _deviceRepository.AddCommandAsync(dev.DeviceId, "FORCE_SYNC");
                                    }
                                }
                                catch { }
                            }
                        }
                        catch (Exception ex)
                        {
                            await _systemLog.LogAsync(null, "ERROR", $"[MediaService] ASYNC_REPLACE_TRANSCODE_FAILED | MediaID: {id} | Error: {ex.Message}", "SYSTEM", userId);
                        }
                    });
                }

                // Trigger Sync immediately only if no transcoding is needed.
                // Otherwise, the background transcoding task will trigger it once it finishes.
                if (!needsTranscoding)
                {
                    try
                    {
                        var affectedDevices = await _deviceRepository.GetDevicesByMediaIdAsync(id);
                        foreach (var dev in affectedDevices)
                        {
                            await _deviceRepository.AddCommandAsync(dev.DeviceId, "FORCE_SYNC");
                        }
                    } catch { }
                }

                return TransformToAbsoluteUrl(result.Value);
            }
            return null;
        }
        public async Task<int> ProcessExpiredMediaAsync(CancellationToken cancellationToken)
        {
            var connectionString = _configuration.GetConnectionString("DefaultConnection");
            int count = 0;

            using (var connection = new Microsoft.Data.SqlClient.SqlConnection(connectionString))
            {
                await connection.OpenAsync(cancellationToken);

                // 1. Find Expired Media
                var expiredMediaSql = @"
                    SELECT media_id, file_name, display_name 
                    FROM sn_media_files WITH (NOLOCK)
                    WHERE is_deleted = 0 
                      AND end_date IS NOT NULL 
                      AND end_date <= SYSUTCDATETIME()";

                var expiredMediaList = await Dapper.SqlMapper.QueryAsync<dynamic>(connection, expiredMediaSql);

                var affectedDeviceIds = new HashSet<string>();

                foreach (var media in expiredMediaList)
                {
                    if (cancellationToken.IsCancellationRequested) break;

                    try
                    {
                        string mediaIdStr = media.media_id.ToString();
                        
                        // 1. Find affected devices BEFORE deleting (to ensure we notify them)
                        try 
                        {
                            var devices = await _deviceRepository.GetDevicesByMediaIdAsync(mediaIdStr);
                            foreach (var d in devices) affectedDeviceIds.Add(d.DeviceId);
                        }
                        catch (Exception devEx)
                        {
                            // Logger not available, fallback to System Log
                            Console.WriteLine($"[WARN] Failed to resolve devices for expired media: {devEx.Message}");
                        }

                        // 2. Execute Force Delete via Stored Procedure
                        var p = new Dapper.DynamicParameters();
                        p.Add("@p_action", "DELETE");
                        p.Add("@p_media_id", media.media_id);
                        p.Add("@p_force_delete", 1); // Force delete even if in playlist
                        p.Add("@p_userid", 1); // System User

                        await Dapper.SqlMapper.ExecuteAsync(connection, "sp_media_std", p, commandType: System.Data.CommandType.StoredProcedure);
                        
                        count++;
                        await _systemLog.LogAsync(null, "INFO", $"[MediaService] EXPIRED_AUTO_DELETE | MediaID: {media.media_id} | Name: {media.file_name}", "SYSTEM", 1);
                    }
                    catch (Exception ex)
                    {
                        await _systemLog.LogAsync(null, "ERROR", $"[MediaService] EXPIRY_FAILED | MediaID: {media.media_id} | Error: {ex.Message}", "SYSTEM", 1);
                    }
                }

                // 3. Notify all affected devices to Sync immediately
                if (affectedDeviceIds.Count > 0)
                {
                    foreach (var devId in affectedDeviceIds)
                    {
                        try 
                        {
                            await _deviceRepository.AddCommandAsync(devId, "FORCE_SYNC");
                        }
                        catch (Exception cmdEx) 
                        {
                             Console.WriteLine($"[ERROR] Failed to send FORCE_SYNC to device {devId}: {cmdEx.Message}");
                        }
                    }
                    await _systemLog.LogAsync(null, "INFO", $"[MediaService] EXPIRY_SYNC_SENT | Devices: {affectedDeviceIds.Count}", "SYSTEM", 1);
                }
            }

            return count;
        }

        private async Task<string> ConvertToBaselineFormatAsync(string filePath)
        {
            try
            {
                var ext = Path.GetExtension(filePath)?.ToLowerInvariant();
                if (ext != ".mp4" && ext != ".mov" && ext != ".avi" && ext != ".webm") return filePath;

                string ffmpegPath = Path.Combine(Directory.GetCurrentDirectory(), "ffmpeg");
                if (!Directory.Exists(ffmpegPath)) Directory.CreateDirectory(ffmpegPath);
                
                Xabe.FFmpeg.FFmpeg.SetExecutablesPath(ffmpegPath);
                
                if (!File.Exists(Path.Combine(ffmpegPath, "ffmpeg.exe")))
                {
                    Console.WriteLine("[FFmpeg] Downloading FFmpeg executables...");
                    await Xabe.FFmpeg.Downloader.FFmpegDownloader.GetLatestVersion(Xabe.FFmpeg.Downloader.FFmpegVersion.Official, ffmpegPath);
                }

                string uploadsFolder = Path.GetDirectoryName(filePath) ?? "";
                string tempFolder = Path.Combine(uploadsFolder, "temp_conversion");
                if (!Directory.Exists(tempFolder)) Directory.CreateDirectory(tempFolder);

                string tempOutputPath = Path.Combine(tempFolder, $"{Guid.NewGuid()}.mp4");
                
                try 
                {
                    var mediaInfo = await Xabe.FFmpeg.FFmpeg.GetMediaInfo(filePath);
                    var conversion = Xabe.FFmpeg.FFmpeg.Conversions.New();

                    var videoStream = mediaInfo.VideoStreams.FirstOrDefault();
                    if (videoStream != null) {
                        conversion.AddStream(videoStream.SetCodec(Xabe.FFmpeg.VideoCodec.h264));
                        // Baseline profile + FastStart for better streaming
                        conversion.AddParameter("-profile:v baseline -level 3.0 -pix_fmt yuv420p -movflags +faststart");
                    }

                    var audioStream = mediaInfo.AudioStreams.FirstOrDefault();
                    if (audioStream != null) {
                        conversion.AddStream(audioStream.SetCodec(Xabe.FFmpeg.AudioCodec.aac).SetBitrate(128000));
                    }

                    conversion.SetOutput(tempOutputPath);
                    Console.WriteLine($"[FFmpeg] Starting conversion for {Path.GetFileName(filePath)}");
                    await conversion.Start();

                    // Robust swap with retry logic
                    bool swapped = false;
                    for (int i = 0; i < 3; i++)
                    {
                        try
                        {
                            if (File.Exists(filePath)) File.Delete(filePath);
                            File.Move(tempOutputPath, filePath);
                            swapped = true;
                            break;
                        }
                        catch (IOException)
                        {
                            if (i < 2) await Task.Delay(1000);
                        }
                    }

                    if (swapped)
                    {
                        Console.WriteLine($"[FFmpeg] Conversion successful for {Path.GetFileName(filePath)}");
                        return filePath;
                    }
                    else
                    {
                         // Fallback: If original is locked, use the new file with its unique name
                         string safeName = Path.Combine(uploadsFolder, Path.GetFileName(tempOutputPath));
                         File.Move(tempOutputPath, safeName);
                         Console.WriteLine($"[FFmpeg] Warning: Original file locked. Using fallback path: {Path.GetFileName(safeName)}");
                         return safeName;
                    }
                }
                finally
                {
                    if (File.Exists(tempOutputPath)) File.Delete(tempOutputPath);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[FFmpeg Error] {ex.Message}");
                return filePath; // Return original on absolute failure
            }
        }
    }
}
