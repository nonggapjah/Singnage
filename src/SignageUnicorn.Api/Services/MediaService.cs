using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Repositories.Interfaces;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using System.IO;
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

        public MediaService(IMediaRepository repository, IWebHostEnvironment environment, IHttpContextAccessor httpContextAccessor, IConfiguration configuration, ISystemLogRepository systemLog)
        {
            _repository = repository;
            _environment = environment;
            _httpContextAccessor = httpContextAccessor;
            _configuration = configuration;
            _systemLog = systemLog;
        }

        public async Task<IEnumerable<MediaFile>> GetAllMediaAsync(string? searchTerm = null, string? supplierCode = null, string? remark1 = null, string? remark2 = null, string? status = null, string? mediaType = null)
        {
            return await _repository.GetAllAsync(searchTerm, supplierCode, remark1, remark2, status, mediaType);
        }

        public async Task<MediaFile?> GetMediaByIdAsync(string id)
        {
            return await _repository.GetByIdAsync(id);
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

                // Construct absolute URL
                var baseUrl = _configuration["ServerSettings:BaseUrl"];
                if (string.IsNullOrEmpty(baseUrl))
                {
                     // Fallback to request host if configuration missing
                     var httpRequest = _httpContextAccessor.HttpContext?.Request;
                     if (httpRequest != null)
                     {
                         baseUrl = $"{httpRequest.Scheme}://{httpRequest.Host}";
                     }
                }
                
                finalUrl = $"{baseUrl}/media/{uniqueFileName}";
                
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
                FileHash = fileHash
            };

            var result = await _repository.CreateAsync(media, userId);
            if (result.Success)
            {
                await _systemLog.LogAsync(null, "INFO", $"[MediaService] UPLOADED | FileName: {media.FileName} | MediaID: {media.MediaId}", "API", userId);
                return media;
            }
            return null;
        }

        public async Task<bool> UpdateMediaAsync(string id, MediaFile updateData, long? userId = null)
        {
            var existing = await _repository.GetByIdAsync(id);
            if (existing == null) 
            {
                return false;
            }

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

            // 4. Handle Old Media (Archive vs Delete)
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
    }
}
