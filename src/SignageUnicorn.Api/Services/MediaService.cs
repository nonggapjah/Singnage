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

            // Handle Local File Upload (allowlist + magic bytes + staging, see StoreUploadAsync)
            if (request.File != null && request.File.Length > 0)
            {
                var stored = await StoreUploadAsync(request.File);
                localFilePath = stored.FilePath;
                needsTranscoding = stored.NeedsTranscoding;
                fileHash = stored.Hash;

                // Save as relative path for portability, transform to absolute on output
                finalUrl = $"/media/{stored.UniqueFileName}";

                // Auto-fill metadata if missing
                if (string.IsNullOrEmpty(request.FileName)) request.FileName = request.File.FileName;
                if (request.FileSizeKb == null || request.FileSizeKb == 0) request.FileSizeKb = stored.SizeKb;
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

                // F22: transcode in the background and publish the result under a NEW file name
                // with blob_url + hash + size updated in one step (see PublishTranscodedAsync).
                if (needsTranscoding && !string.IsNullOrEmpty(localFilePath))
                {
                    var mediaId = result.Value.MediaId;
                    var sourcePath = localFilePath;
                    _ = Task.Run(() => PublishTranscodedAsync(mediaId, sourcePath, userId, "ASYNC_TRANSCODE"));
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

        public async Task<MediaSwapResult> ReplaceMediaAsync(string oldId, string newId, bool archiveOld, long? userId = null)
        {
            // 1. Validate Both Exist
            var oldMedia = await _repository.GetByIdAsync(oldId);
            var newMedia = await _repository.GetByIdAsync(newId);

            if (oldMedia == null || newMedia == null) return MediaSwapResult.Failed("Old or new media not found.");

            // 2. Perform Swap
            var swapResult = await _repository.SwapMediaAsync(oldId, newId, userId);
            if (!swapResult.Success) return MediaSwapResult.Failed(swapResult.Message ?? "Swap failed.");

            // Round 4 (#3) / Round 5 (Codex round-5 items 3 and 10): screens on the deployed v2.7.x client key
            // their cache by the LOGICAL file name and existence-check it without the hash, so when the new
            // row shares the old row's stem ("clip.mp4" vs "clip.v2.mp4") they would keep playing the old
            // bytes. The new row therefore gets a FRESH version (one above every version in use for that
            // stem) through a filename-ONLY conditional rename: blob_url / hash / size are never rewritten
            // from the snapshot read above, so a transcode that completes meanwhile cannot be overwritten
            // (its publish changes the blob name, the rename then fails with 409 and is retried against
            // the current row once).
            bool renameConflict = false;
            string? renamedTo = null;
            if (MediaFileNaming.SharesStem(oldMedia.FileName, newMedia.FileName))
            {
                var inUse = await ActiveFileNamesAsync();
                inUse.Add(oldMedia.FileName);
                inUse.Add(newMedia.FileName);
                var outcome = await RenameToFreshVersionAsync(newMedia, inUse, userId);
                renameConflict = outcome.Conflict;
                renamedTo = outcome.NewName;
            }

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

            var message = renamedTo != null
                ? $"Media swapped successfully; new file name '{renamedTo}'."
                : renameConflict
                    ? "Media swapped, but the new media's content changed concurrently (a conversion finished), so its file name was not versioned; screens re-sync on the next content change."
                    : "Media swapped successfully";
            return new MediaSwapResult { Success = true, Message = message, RenameConflict = renameConflict, NewFileName = renamedTo };
        }

        // Round 5 (item 10): versions `row`'s logical name without ever writing blob/hash/size. A 409 means
        // the stored blob changed between our read and the rename (a transcode published); the CURRENT
        // row is re-read and renamed once more. Two conflicts in a row are reported, not forced.
        private async Task<(bool Conflict, string? NewName)> RenameToFreshVersionAsync(MediaFile row, List<string?> inUse, long? userId)
        {
            var current = row;
            for (int attempt = 0; attempt < 2; attempt++)
            {
                var fresh = MediaFileNaming.NextVersion(current.FileName, inUse);
                if (fresh == null) return (false, null);

                var rename = await _repository.RenameFileAsync(current.MediaId, fresh, BlobName(current.BlobUrl), userId);
                if (rename.Success) return (false, fresh);
                if (rename.ErrorCode != 409)
                {
                    await _systemLog.LogAsync(null, "WARN", $"[MediaService] SWAP_RENAME_FAILED | MediaID: {current.MediaId} | {rename.Message}", "API", userId);
                    return (false, null);
                }

                var reread = await _repository.GetByIdAsync(current.MediaId);
                if (reread == null) return (true, null);
                inUse.Add(current.FileName);
                inUse.Add(reread.FileName);
                current = reread;
            }

            await _systemLog.LogAsync(null, "WARN", $"[MediaService] SWAP_RENAME_CONFLICT | MediaID: {current.MediaId} | content kept changing; logical name left as '{current.FileName}'", "API", userId);
            return (true, null);
        }

        // File part of a blob url ("/media/abc.mp4" or an absolute url) without any query string.
        private static string BlobName(string? blobUrl)
        {
            if (string.IsNullOrWhiteSpace(blobUrl)) return string.Empty;
            var path = blobUrl;
            var q = path.IndexOf('?');
            if (q >= 0) path = path[..q];
            var slash = path.LastIndexOf('/');
            return slash >= 0 ? path[(slash + 1)..] : path;
        }

        // Logical names of every media row, so a fresh version is above ANY row sharing the stem
        // (Round 5, item 3). A failed scan degrades to versioning against the row itself.
        private async Task<List<string?>> ActiveFileNamesAsync()
        {
            try
            {
                var all = await _repository.GetAllAsync();
                return all.Select(m => m.FileName).Where(n => !string.IsNullOrWhiteSpace(n)).ToList<string?>();
            }
            catch (Exception ex)
            {
                await _systemLog.LogAsync(null, "WARN", $"[MediaService] NAME_SCAN_FAILED | {ex.Message}", "API");
                return new List<string?>();
            }
        }

        public async Task<MediaFile?> ReplaceMediaContentAsync(string id, MediaUploadRequest request, long? userId = null)
        {
            var existing = await _repository.GetByIdAsync(id);
            if (existing == null) return null;

            string finalUrl = request.BlobUrl ?? existing.BlobUrl;
            string? fileHash = existing.FileHash;
            bool needsTranscoding = false;
            string? localFilePath = null;

            // Handle Local File Upload (same allowlist + staging path as CreateMediaAsync)
            if (request.File != null && request.File.Length > 0)
            {
                var stored = await StoreUploadAsync(request.File);
                localFilePath = stored.FilePath;
                needsTranscoding = stored.NeedsTranscoding;
                fileHash = stored.Hash;
                finalUrl = $"/media/{stored.UniqueFileName}";

                if (string.IsNullOrEmpty(request.FileName)) request.FileName = request.File.FileName;
                if (request.FileSizeKb == null || request.FileSizeKb == 0) request.FileSizeKb = stored.SizeKb;
            }

            // Round 4 (#3): new bytes under an unchanged logical name would be ignored by the
            // deployed v2.7.x cache (keyed by that name, existence-checked without the hash).
            bool bytesChanged = request.File != null
                || (!string.IsNullOrEmpty(request.BlobUrl) && !string.Equals(request.BlobUrl, existing.BlobUrl, StringComparison.OrdinalIgnoreCase));
            var logicalName = request.FileName ?? existing.FileName;
            if (bytesChanged)
            {
                // Round 5 (item 3): always a FRESH version above everything in use for the stem, so an
                // upload named "clip.mp4" over a row at "clip.v2.mp4" becomes "clip.v3.mp4" (never the
                // bare name again, never a number already used).
                var inUse = await ActiveFileNamesAsync();
                inUse.Add(existing.FileName);
                logicalName = MediaFileNaming.NextVersion(logicalName, inUse) ?? logicalName;
            }

            var media = new MediaFile
            {
                MediaId = id,
                FileName = logicalName,
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

                if (needsTranscoding && !string.IsNullOrEmpty(localFilePath))
                {
                    var sourcePath = localFilePath;
                    _ = Task.Run(() => PublishTranscodedAsync(id, sourcePath, userId, "ASYNC_REPLACE_TRANSCODE"));
                }
                else
                {
                    // Nothing to convert: screens can fetch the new bytes right away.
                    await NotifyDevicesForMediaAsync(id);
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

        // Converts into media/temp_conversion and returns the staged output path, or null when the
        // file needs no conversion or conversion failed. Never touches the published file itself;
        // PublishTranscodedAsync decides what becomes visible to clients.
        private async Task<string?> TranscodeToStagingAsync(string filePath)
        {
            try
            {
                var ext = Path.GetExtension(filePath)?.ToLowerInvariant();
                if (!MediaFileValidator.IsVideoExtension(ext)) return null;

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

                        // High profile, not Baseline: Baseline has no CABAC and no B-frames, so it
                        // costs 20-40% more bitrate for the same picture. Every screen downloads and
                        // stores every file, so that overhead is paid on the whole fleet.
                        //
                        // Level 4.0, not 3.0: level 3.0 tops out at 1280x720. A 1080p frame is five
                        // times the macroblocks that level allows, so the old parameters produced
                        // streams whose declared level contradicted their contents. Hardware decoders
                        // size their buffers from that declaration -- an Intel iGPU may then refuse
                        // the stream and fall back to software (hopeless on the fleet's 2-core
                        // Pentiums) or fail mid-decode. Both surface at the player as a decode error,
                        // and the client deletes the file on any decode error, so a mis-tagged file
                        // is downloaded and deleted forever. Level 4.0 covers 1080p30 honestly and
                        // HD 510 decodes High@4.0 in hardware.
                        var filters = new List<string>();

                        // Only ever downscale, and keep the aspect ratio (-2 keeps height even,
                        // which H.264 requires). Nothing is upscaled and files already within
                        // 1080p are left untouched.
                        if (videoStream.Width > 1920)
                            filters.Add("scale='min(1920,iw)':-2");

                        // Cap the framerate only when the source exceeds it. Forcing 30 on 24fps
                        // material would duplicate frames and add judder for no benefit.
                        if (videoStream.Framerate > 30)
                            filters.Add("fps=30");

                        if (filters.Count > 0)
                            conversion.AddParameter($"-vf \"{string.Join(",", filters)}\"");

                        conversion.AddParameter("-profile:v high -level 4.0 -pix_fmt yuv420p -movflags +faststart");
                    }

                    var audioStream = mediaInfo.AudioStreams.FirstOrDefault();
                    if (audioStream != null) {
                        conversion.AddStream(audioStream.SetCodec(Xabe.FFmpeg.AudioCodec.aac).SetBitrate(128000));
                    }

                    conversion.SetOutput(tempOutputPath);
                    Console.WriteLine($"[FFmpeg] Starting conversion for {Path.GetFileName(filePath)}");
                    await conversion.Start();

                    if (!File.Exists(tempOutputPath) || new FileInfo(tempOutputPath).Length == 0)
                    {
                        Console.WriteLine($"[FFmpeg] Conversion produced no output for {Path.GetFileName(filePath)}");
                        return null;
                    }

                    Console.WriteLine($"[FFmpeg] Conversion finished for {Path.GetFileName(filePath)} -> staging {Path.GetFileName(tempOutputPath)}");
                    return tempOutputPath;
                }
                catch (Exception ex)
                {
                    try { if (File.Exists(tempOutputPath)) File.Delete(tempOutputPath); } catch { }
                    Console.WriteLine($"[FFmpeg Error] {ex.Message}");
                    return null;
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[FFmpeg Error] {ex.Message}");
                return null; // caller keeps the original file
            }
        }

        private sealed class StoredUpload
        {
            public string UniqueFileName = string.Empty;
            public string FilePath = string.Empty;
            public string Hash = string.Empty;
            public int SizeKb;
            public bool NeedsTranscoding;
        }

        private string UploadsFolder()
        {
            string webRootPath = _environment.WebRootPath ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot");
            string uploadsFolder = Path.Combine(webRootPath, "media");
            Directory.CreateDirectory(uploadsFolder);
            return uploadsFolder;
        }

        // Contract item 9 / F07 / F23: the upload is written to media/_staging first, checked by
        // extension AND leading bytes, and only then moved into media/ under a new GUID name. The
        // orphan sweep never looks inside the staging folder, so a file cannot be collected while
        // its database row is still being written.
        private async Task<StoredUpload> StoreUploadAsync(IFormFile file)
        {
            var ext = (Path.GetExtension(file.FileName) ?? string.Empty).ToLowerInvariant();
            if (!MediaFileValidator.IsAllowedExtension(ext))
                throw new MediaValidationException($"File type '{ext}' is not allowed. Allowed: {string.Join(", ", MediaFileValidator.AllowedExtensions)}");

            var uploadsFolder = UploadsFolder();
            var stagingFolder = Path.Combine(uploadsFolder, "_staging");
            Directory.CreateDirectory(stagingFolder);

            var uniqueFileName = $"{Guid.NewGuid()}{ext}";
            var stagingPath = Path.Combine(stagingFolder, uniqueFileName);
            try
            {
                using (var fs = new FileStream(stagingPath, FileMode.Create))
                {
                    await file.CopyToAsync(fs);
                }

                var head = new byte[16];
                int read;
                using (var fs = File.OpenRead(stagingPath))
                {
                    read = fs.Read(head, 0, head.Length);
                }
                var problem = MediaFileValidator.CheckMagic(ext, head.AsSpan(0, read));
                if (problem != null) throw new MediaValidationException($"Upload rejected: {problem}.");

                var finalPath = Path.Combine(uploadsFolder, uniqueFileName);
                File.Move(stagingPath, finalPath);

                var info = new FileInfo(finalPath);
                return new StoredUpload
                {
                    UniqueFileName = uniqueFileName,
                    FilePath = finalPath,
                    Hash = ComputeMd5(finalPath),
                    SizeKb = (int)(info.Length / 1024),
                    NeedsTranscoding = MediaFileValidator.IsVideoExtension(ext)
                };
            }
            catch
            {
                try { if (File.Exists(stagingPath)) File.Delete(stagingPath); } catch { }
                throw;
            }
        }

        private static string ComputeMd5(string path)
        {
            using var md5 = System.Security.Cryptography.MD5.Create();
            using var stream = File.OpenRead(path);
            return BitConverter.ToString(md5.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
        }

        // F22 / contract item 3. The converted file is published under a NEW GUID name and the row's
        // blob_url, file_hash and file_size_kb change in ONE update; the previous file is deleted only
        // after that update succeeded. Clients key their cache by the url basename, so the new name is
        // what makes every screen fetch the converted bytes instead of trusting a stale copy. Before,
        // the file was swapped in place under the same name while the row still carried the old hash,
        // and when the original was locked the converted file went live under a name the row never
        // learned about.
        private async Task PublishTranscodedAsync(string mediaId, string sourcePath, long? userId, string logPrefix)
        {
            try
            {
                await _systemLog.LogAsync(null, "INFO", $"[MediaService] {logPrefix}_START | MediaID: {mediaId} | FilePath: {sourcePath}", "SYSTEM", userId);

                var stagedPath = await TranscodeToStagingAsync(sourcePath);
                if (stagedPath == null)
                {
                    await _systemLog.LogAsync(null, "WARNING", $"[MediaService] {logPrefix}_SKIPPED | MediaID: {mediaId} | original kept", "SYSTEM", userId);
                    await NotifyDevicesForMediaAsync(mediaId);
                    return;
                }

                var uploadsFolder = UploadsFolder();
                var newName = $"{Guid.NewGuid()}.mp4";
                var finalPath = Path.Combine(uploadsFolder, newName);
                File.Move(stagedPath, finalPath);

                var existing = await _repository.GetByIdAsync(mediaId);
                if (existing == null)
                {
                    try { File.Delete(finalPath); } catch { }
                    return;
                }

                var info = new FileInfo(finalPath);
                // Round 4 (#3) / Round 5 (item 3): the logical name is what v2.7.x screens key their cache
                // by; keeping it would leave them playing the unconverted bytes. Version it above every
                // version in use for the stem (clip.v2.mp4 -> clip.v3.mp4, never a reused number).
                var namesInUse = await ActiveFileNamesAsync();
                namesInUse.Add(existing.FileName);
                var update = new MediaFile
                {
                    MediaId = existing.MediaId,
                    FileName = MediaFileNaming.NextVersion(existing.FileName, namesInUse, ".mp4") ?? newName,
                    BlobUrl = $"/media/{newName}",
                    DurationSec = existing.DurationSec,
                    Ratio = existing.Ratio,
                    FileSizeKb = (int)(info.Length / 1024),
                    FileHash = ComputeMd5(finalPath),
                    EndDate = null // REPLACE_FILE keeps the stored end_date when null
                };
                // Contract T10 / Codex round-2 finding 13: publish only if the row still points at the
                // file this conversion started from. A replacement that landed meanwhile wins; the
                // stale conversion output is discarded instead of silently restoring older content.
                var expectedName = Path.GetFileName(sourcePath);
                var result = await _repository.ReplaceAsync(update, userId, expectedName);
                if (!result.Success)
                {
                    try { File.Delete(finalPath); } catch { }
                    if (result.ErrorCode == 409)
                    {
                        await _systemLog.LogAsync(null, "WARNING", $"[MediaService] {logPrefix}_SUPERSEDED | MediaID: {mediaId} | source {expectedName} is no longer the stored file; converted output dropped", "SYSTEM", userId);
                        return;
                    }
                    await _systemLog.LogAsync(null, "ERROR", $"[MediaService] {logPrefix}_DB_FAILED | MediaID: {mediaId} | {result.Message}", "SYSTEM", userId);
                    return;
                }

                // Only now is the unconverted upload unreachable through the database.
                try { if (File.Exists(sourcePath)) File.Delete(sourcePath); } catch { }

                await _systemLog.LogAsync(null, "INFO", $"[MediaService] {logPrefix}_SUCCESS | MediaID: {mediaId} | {newName}", "SYSTEM", userId);
                await NotifyDevicesForMediaAsync(mediaId);
            }
            catch (Exception ex)
            {
                await _systemLog.LogAsync(null, "ERROR", $"[MediaService] {logPrefix}_FAILED | MediaID: {mediaId} | Error: {ex.Message}", "SYSTEM", userId);
            }
        }

        private async Task NotifyDevicesForMediaAsync(string mediaId)
        {
            try
            {
                var affectedDevices = await _deviceRepository.GetDevicesByMediaIdAsync(mediaId);
                foreach (var dev in affectedDevices)
                {
                    await _deviceRepository.AddCommandAsync(dev.DeviceId, "FORCE_SYNC");
                }
            }
            catch (Exception ex)
            {
                await _systemLog.LogAsync(null, "WARN", $"[MediaService] NOTIFY_FAILED | MediaID: {mediaId} | {ex.Message}", "API");
            }
        }
    }
}
