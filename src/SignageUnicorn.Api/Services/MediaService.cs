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

            var baseUrl = _configuration["ServerSettings:BaseUrl"];
            if (string.IsNullOrEmpty(baseUrl))
            {
                var httpRequest = _httpContextAccessor.HttpContext?.Request;
                if (httpRequest != null) baseUrl = $"{httpRequest.Scheme}://{httpRequest.Host}";
            }

            // Case 1: Relative Path - Always transform
            if (!m.BlobUrl.StartsWith("http", StringComparison.OrdinalIgnoreCase))
            {
                if (!string.IsNullOrEmpty(baseUrl))
                {
                    m.BlobUrl = $"{baseUrl.TrimEnd('/')}/{m.BlobUrl.TrimStart('/')}";
                }
                return m;
            }

            // Case 2: Absolute Path containing localhost or 127.0.0.1 - Fix it to match current access point
            if (m.BlobUrl.Contains("localhost", StringComparison.OrdinalIgnoreCase) || m.BlobUrl.Contains("127.0.0.1"))
            {
                if (!string.IsNullOrEmpty(baseUrl))
                {
                     // Replace the host part (e.g. http://localhost:8862) with the current baseUrl
                     // Finding the 3rd slash (after proto://host:port)
                     int protoEnd = m.BlobUrl.IndexOf("://");
                     if (protoEnd > 0)
                     {
                         int firstSlashAfterProto = m.BlobUrl.IndexOf('/', protoEnd + 3);
                         if (firstSlashAfterProto > 0)
                         {
                             var path = m.BlobUrl.Substring(firstSlashAfterProto);
                             m.BlobUrl = $"{baseUrl.TrimEnd('/')}/{path.TrimStart('/')}";
                         }
                     }
                }
            }

            return m;
        }

        public async Task<MediaFile?> CreateMediaAsync(MediaUploadRequest request, long? userId = null)
        {
            string finalUrl = request.BlobUrl ?? "";
            string? fileHash = null;

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

                // Save file stream
                using (var fileStream = new FileStream(filePath, FileMode.Create))
                {
                    await request.File.CopyToAsync(fileStream);
                }

                // Save as relative path for portability, transform to absolute on output
                finalUrl = $"/media/{uniqueFileName}";
                
                // Auto-fill metadata if missing
                if (string.IsNullOrEmpty(request.FileName)) request.FileName = request.File.FileName;
                if (request.FileSizeKb == null || request.FileSizeKb == 0) request.FileSizeKb = (int)(request.File.Length / 1024);

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

            // Handle Local File Upload (logic duplicated from CreateMediaAsync for now, could be refactored)
            if (request.File != null && request.File.Length > 0)
            {
                string webRootPath = _environment.WebRootPath ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot");
                string uploadsFolder = Path.Combine(webRootPath, "media");
                if (!Directory.Exists(uploadsFolder)) Directory.CreateDirectory(uploadsFolder);

                string fileExtension = Path.GetExtension(request.File.FileName);
                string uniqueFileName = $"{Guid.NewGuid()}{fileExtension}";
                string filePath = Path.Combine(uploadsFolder, uniqueFileName);

                using (var fileStream = new FileStream(filePath, FileMode.Create))
                {
                    await request.File.CopyToAsync(fileStream);
                }

                finalUrl = $"/media/{uniqueFileName}";

                if (string.IsNullOrEmpty(request.FileName)) request.FileName = request.File.FileName;
                if (request.FileSizeKb == null || request.FileSizeKb == 0) request.FileSizeKb = (int)(request.File.Length / 1024);

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
                
                // Trigger Sync
                try
                {
                    var affectedDevices = await _deviceRepository.GetDevicesByMediaIdAsync(id);
                    foreach (var dev in affectedDevices)
                    {
                        await _deviceRepository.AddCommandAsync(dev.DeviceId, "FORCE_SYNC");
                    }
                } catch { }

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

                foreach (var media in expiredMediaList)
                {
                    if (cancellationToken.IsCancellationRequested) break;

                    try
                    {
                        long mediaId = (long)media.media_id;
                        string fileName = (string)media.file_name;

                        // 2. Execute Force Delete via Stored Procedure
                        var p = new Dapper.DynamicParameters();
                        p.Add("@p_action", "DELETE");
                        p.Add("@p_media_id", mediaId);
                        p.Add("@p_force_delete", 1); // Force delete even if in playlist
                        p.Add("@p_userid", 1); // System User

                        await Dapper.SqlMapper.ExecuteAsync(connection, "sp_media_std", p, commandType: System.Data.CommandType.StoredProcedure);
                        
                        count++;
                        await _systemLog.LogAsync(null, "INFO", $"[MediaService] EXPIRED_AUTO_DELETE | MediaID: {mediaId} | Name: {fileName}", "SYSTEM", 1);
                    }
                    catch (Exception ex)
                    {
                        await _systemLog.LogAsync(null, "ERROR", $"[MediaService] EXPIRY_FAILED | MediaID: {media.media_id} | Error: {ex.Message}", "SYSTEM", 1);
                    }
                }
            }

            return count;
        }
    }
}
