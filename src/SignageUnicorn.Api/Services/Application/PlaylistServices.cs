using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Models.Domain;
using SignageUnicorn.Api.Repositories.Interfaces;
using SignageUnicorn.Api.DBManager;

namespace SignageUnicorn.Api.Services.Application
{
    public class PlaylistService
    {
        private readonly IPlaylistRepository _playlistRepo;
        private readonly ISystemLogRepository _logRepo;
        private readonly IDeviceRepository _deviceRepo;
        private readonly IConfiguration _configuration;
        private readonly IHttpContextAccessor _httpContextAccessor;

        public PlaylistService(IPlaylistRepository playlistRepo, ISystemLogRepository logRepo, IDeviceRepository deviceRepo, IConfiguration configuration, IHttpContextAccessor httpContextAccessor) 
        {
            _playlistRepo = playlistRepo;
            _logRepo = logRepo;
            _deviceRepo = deviceRepo;
            _configuration = configuration;
            _httpContextAccessor = httpContextAccessor;
        }

        // Helper to ensure media URLs are absolute and correct for the current network context
        private string TransformUrl(string blobUrl)
        {
            if (string.IsNullOrEmpty(blobUrl)) return blobUrl;

            var baseUrl = _configuration["ServerSettings:BaseUrl"];
            if (string.IsNullOrEmpty(baseUrl))
            {
                var httpRequest = _httpContextAccessor.HttpContext?.Request;
                if (httpRequest != null) baseUrl = $"{httpRequest.Scheme}://{httpRequest.Host}";
            }

            // Case 1: Relative Path - Always transform
            if (!blobUrl.StartsWith("http", StringComparison.OrdinalIgnoreCase))
            {
                if (!string.IsNullOrEmpty(baseUrl))
                {
                    return $"{baseUrl.TrimEnd('/')}/{blobUrl.TrimStart('/')}";
                }
                return blobUrl;
            }

            // Case 2: Absolute Path containing localhost or 127.0.0.1
            if (blobUrl.Contains("localhost", StringComparison.OrdinalIgnoreCase) || blobUrl.Contains("127.0.0.1"))
            {
                if (!string.IsNullOrEmpty(baseUrl))
                {
                     int protoEnd = blobUrl.IndexOf("://");
                     if (protoEnd > 0)
                     {
                         int firstSlashAfterProto = blobUrl.IndexOf('/', protoEnd + 3);
                         if (firstSlashAfterProto > 0)
                         {
                             var path = blobUrl.Substring(firstSlashAfterProto);
                             return $"{baseUrl.TrimEnd('/')}/{path.TrimStart('/')}";
                         }
                     }
                }
            }
            return blobUrl;
        }

        // ... (GetAllPlaylistsAsync and GetPlaylistByIdAsync remain same) ...

        private async Task NotifyAffectedDevices(string playlistId)
        {
            try
            {
                var affectedDevices = await _deviceRepo.GetDevicesByPlaylistIdAsync(playlistId);
                foreach (var dev in affectedDevices)
                {
                    await _deviceRepo.AddCommandAsync(dev.DeviceId, "FORCE_SYNC");
                }
            }
            catch (Exception ex)
            {
                await _logRepo.LogAsync(null, "WARN", $"[PlaylistService] NOTIFY_FAILED | {ex.Message}", "API");
            }
        }

        public async Task<List<PlaylistDto>> GetAllPlaylistsAsync(bool onlyActive = false, string searchTerm = null)
        {
            var playlists = await _playlistRepo.GetAllPlaylistsAsync(onlyActive, searchTerm);
            return playlists.ToList();
        }

        public async Task<PlaylistDto?> GetPlaylistByIdAsync(string playlistId)
        {
            var playlist = await _playlistRepo.GetPlaylistByIdAsync(playlistId);
            
            if (playlist != null)
            {
                var items = (await _playlistRepo.GetPlaylistItemsAsync(playlistId)).ToList();

                // Polyfill nested Media object for client compatibility & Transform URLs
                foreach (var item in items)
                {
                    item.PlaylistId = playlist.PlaylistId;
                    
                    // 1. Transform the item's direct URL
                    item.BlobUrl = TransformUrl(item.BlobUrl);
                    
                    // 2. Ensure Duration is valid (Fallback to 10s)
                    if (!item.OriginalDuration.HasValue || item.OriginalDuration.Value <= 0)
                    {
                        item.OriginalDuration = 10;
                    }

                    // 3. Create the nested Media object with transformed URL
                    item.Media = new MediaFile 
                    {
                        MediaId = item.MediaId,
                        FileName = item.FileName ?? "",
                        DisplayName = item.DisplayName,
                        BlobUrl = item.BlobUrl ?? "", // Already transformed above
                        DurationSec = (item.OriginalDuration.HasValue && item.OriginalDuration.Value > 0) ? item.OriginalDuration.Value : 10,
                        Ratio = item.Ratio,
                        FileSizeKb = item.FileSizeKB,
                        FileHash = item.FileHash
                    };
                }

                playlist.Items = items;
            }
            
            return playlist;
        }

        public async Task<bool> CreatePlaylistAsync(PlaylistDto playlist, long? userId = null)
        {
            // Case 5: Validation (P06) - Prevent activating empty playlist
            if (playlist.Active == "Y" && (playlist.Items == null || !playlist.Items.Any()))
            {
                await _logRepo.LogAsync(null, "WARNING", $"[PlaylistService] VALIDATION_ERROR | Attempted to create empty ACTIVE playlist: {playlist.PlaylistName}", "API", userId);
                return false;
            }

            if (string.IsNullOrEmpty(playlist.PlaylistId)) playlist.PlaylistId = Guid.NewGuid().ToString();
            
            // 1. Create Header
            var result = await _playlistRepo.CreatePlaylistAsync(
                playlist.PlaylistId, playlist.PlaylistName, playlist.Description ?? string.Empty, userId?.ToString() ?? playlist.CreatedBy ?? "system", playlist.Active);
            
            if (!result.Success)
            {
                await _logRepo.LogAsync(null, "ERROR", $"[PlaylistService] CREATE_FAILED | Code: {result.ErrorCode} | Msg: {result.Message}", "API", userId);
                return false;
            }

            // 2. Add Items
            if (playlist.Items != null && playlist.Items.Any())
            {
                foreach (var item in playlist.Items)
                {
                    await _playlistRepo.AddPlaylistItemAsync(Guid.NewGuid().ToString(), playlist.PlaylistId, item.MediaId, item.PositionOrder, item.DurationOverride, userId);
                }
            }

            await _logRepo.LogAsync(null, "INFO", $"[PlaylistService] CREATED | Playlist: {playlist.PlaylistName} | ID: {playlist.PlaylistId}", "API", userId);
            
            // Note: Notify not needed for *New* playlist as no devices use it yet
            
            return true;
        }

        public async Task<bool> UpdatePlaylistAsync(string id, PlaylistDto playlist, long? userId = null)
        {
            // Case 5: Validation (P06) - Prevent activating empty playlist
            if (playlist.Active == "Y" && (playlist.Items == null || !playlist.Items.Any()))
            {
                await _logRepo.LogAsync(null, "WARNING", $"[PlaylistService] VALIDATION_ERROR | Attempted to set playlist {id} to ACTIVE without items", "API", userId);
                return false;
            }

            // Log Input for Debugging
            var itemCount = playlist.Items?.Count ?? 0;
            var itemMediaIds = playlist.Items?.Select(i => i.MediaId).ToList() ?? new List<string>();
            var itemsJson = System.Text.Json.JsonSerializer.Serialize(itemMediaIds);
            await _logRepo.LogAsync(null, "INFO", $"[PlaylistService] UPDATE | PlaylistID: {id} | Name: '{playlist.PlaylistName}' | Count: {itemCount} | MediaSeq: {itemsJson}", "API", userId);

            // 1. Update Header
            var headerResult = await _playlistRepo.UpdatePlaylistAsync(id, playlist.PlaylistName, playlist.Description ?? string.Empty, playlist.Active, userId);
            if (!headerResult.Success)
            {
                await _logRepo.LogAsync(null, "ERROR", $"[PlaylistService] UPDATE_HEADER_FAILED | Code: {headerResult.ErrorCode} | Msg: {headerResult.Message}", "API", userId);
                return false;
            }
            
            // 2. Sync Items (Strategy: Soft-delete all existing, then add new)
            await _playlistRepo.ClearPlaylistItemsAsync(id, userId);

            // 3. Add New Items
            if (playlist.Items != null && playlist.Items.Any())
            {
                int order = 1;
                foreach (var item in playlist.Items)
                {
                    if (!string.IsNullOrEmpty(item.MediaId))
                    {
                        await _playlistRepo.AddPlaylistItemAsync(Guid.NewGuid().ToString(), id, item.MediaId, order++, item.DurationOverride, userId);
                    }
                }
            }

            // 4. Notify affected devices
            await NotifyAffectedDevices(id);

            return true;
        }

        public async Task<bool> DeletePlaylistAsync(string id, long? userId = null)
        {
            var result = await _playlistRepo.DeletePlaylistAsync(id, userId);
            if (result.Success) 
            {
                await _logRepo.LogAsync(null, "INFO", $"[PlaylistService] DELETED | PlaylistID: {id}", "API", userId);
                
                // Trigger sync so devices know it's gone
                await NotifyAffectedDevices(id);
                
                return true;
            }
            
            await _logRepo.LogAsync(null, "ERROR", $"[PlaylistService] DELETE_FAILED | Code: {result.ErrorCode} | Msg: {result.Message}", "API", userId);
            return false;
        }

        public async Task<bool> AddPlaylistItemAsync(string playlistId, string mediaId, int positionOrder, int? durationOverride, long? userId = null)
        {
            var itemId = Guid.NewGuid().ToString();
            // Log intent
            // await _logRepo.LogAsync(null, "INFO", $"[PlaylistService] ADD_ITEM_START | ItemUUID: {itemId}", "API", userId);

            var result = await _playlistRepo.AddPlaylistItemAsync(itemId, playlistId, mediaId, positionOrder, durationOverride, userId);
            if (result.Success)
            {
                 await _logRepo.LogAsync(null, "INFO", $"[PlaylistService] ADD_ITEM | ItemUUID: {itemId} | PlaylistID: {playlistId} | MediaID: {mediaId} | Pos: {positionOrder}", "API", userId);
                 return true;
            }

            await _logRepo.LogAsync(null, "ERROR", $"[PlaylistService] ADD_ITEM_FAILED | Code: {result.ErrorCode} | Msg: {result.Message}", "API", userId);
            return false;
        }

        public async Task<bool> RemovePlaylistItemAsync(string playlistItemId, long? userId = null)
        {
            var result = await _playlistRepo.RemovePlaylistItemAsync(playlistItemId, userId);
            if (result.Success)
            {
                 await _logRepo.LogAsync(null, "INFO", $"[PlaylistService] REMOVE_ITEM | ItemUUID: {playlistItemId}", "API", userId);
                 return true;
            }
            
            await _logRepo.LogAsync(null, "ERROR", $"[PlaylistService] REMOVE_ITEM_FAILED | Code: {result.ErrorCode} | Msg: {result.Message}", "API", userId);
            return false;
        }

        public async Task<bool> ReorderPlaylistItemAsync(string playlistItemId, int newPosition, long? userId = null)
        {
            var result = await _playlistRepo.ReorderPlaylistItemAsync(playlistItemId, newPosition, userId);
            if (result.Success)
            {
                 await _logRepo.LogAsync(null, "INFO", $"[PlaylistService] REORDER_ITEM | ItemUUID: {playlistItemId} | NewPos: {newPosition}", "API", userId);
                 return true;
            }
            
            await _logRepo.LogAsync(null, "ERROR", $"[PlaylistService] REORDER_FAILED | Code: {result.ErrorCode} | Msg: {result.Message}", "API", userId);
            return false;
        }
    }
}
