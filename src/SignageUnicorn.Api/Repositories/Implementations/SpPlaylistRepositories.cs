using Dapper;
using Microsoft.Data.SqlClient;
using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Models.Domain; // For PlaylistDto, PlaylistItemDto
using SignageUnicorn.Api.Repositories.Interfaces;
using System.Data;

namespace SignageUnicorn.Api.Repositories.Implementations
{
    public class SpPlaylistRepository : IPlaylistRepository
    {
        private readonly string _connectionString;

        public SpPlaylistRepository(IConfiguration configuration)
        {
            _connectionString = configuration.GetConnectionString("DefaultConnection") 
                                ?? throw new InvalidOperationException("Connection string 'DefaultConnection' not found.");
            // Ensure Dapper matches underscore names
            Dapper.DefaultTypeMap.MatchNamesWithUnderscores = true;
        }

        private IDbConnection CreateConnection() => new SqlConnection(_connectionString);

        private class SpStdResult
        {
            public int err_code { get; set; }
            public bool err_flag { get; set; }
            public string msg { get; set; }
        }

        public async Task<IEnumerable<PlaylistDto>> GetAllPlaylistsAsync(bool activeOnly = false, string searchTerm = null)
        {
            using var db = CreateConnection();
            var p = new DynamicParameters();
            p.Add("p_action", "GET_ALL");
            p.Add("p_active_only", activeOnly ? 1 : 0);
            p.Add("p_playlist_name", searchTerm);

            // 1. Status, 2. Data
            using var multi = await db.QueryMultipleAsync("sp_playlist_std", p, commandType: CommandType.StoredProcedure);
            var status = await multi.ReadFirstOrDefaultAsync<SpStdResult>();
            
            if (status != null && status.err_flag) return Enumerable.Empty<PlaylistDto>();

            return await multi.ReadAsync<PlaylistDto>();
        }

        public async Task<PlaylistDto?> GetPlaylistByIdAsync(string playlistId)
        {
            using var db = CreateConnection();
            var p = new DynamicParameters();
            p.Add("p_action", "GET_BY_ID");
            
            if (long.TryParse(playlistId, out var pId)) p.Add("p_playlist_id", pId);
            else p.Add("p_playlist_uuid", playlistId);

            // 1. Status, 2. Data
            using var multi = await db.QueryMultipleAsync("sp_playlist_std", p, commandType: CommandType.StoredProcedure);
            var status = await multi.ReadFirstOrDefaultAsync<SpStdResult>();
            
            if (status != null && status.err_flag) return null;

            return await multi.ReadFirstOrDefaultAsync<PlaylistDto>();
        }

        public async Task<RepositoryResult> CreatePlaylistAsync(string playlistId, string playlistName, string description, string createdBy, string active)
        {
            using var db = CreateConnection();
            
            long? userId = null;
            if (long.TryParse(createdBy, out var uId)) userId = uId;

            var parameters = new
            {
                p_action = "CREATE",
                p_playlist_uuid = playlistId,
                p_playlist_name = playlistName,
                p_description = description,
                p_active_only = (active?.Trim().ToUpper() == "Y" || active == "1" || active?.ToLower() == "true") ? 1 : 0,
                p_userid = userId
            };

            var status = await db.QueryFirstOrDefaultAsync<SpStdResult>("sp_playlist_std", parameters, commandType: CommandType.StoredProcedure);
            return status != null && !status.err_flag 
                ? RepositoryResult.Ok(status.msg) 
                : RepositoryResult.Fail(status?.err_code ?? -1, status?.msg ?? "DB Error");
        }

        public async Task<RepositoryResult> UpdatePlaylistAsync(string playlistId, string playlistName, string description, string active, long? userId = null)
        {
            using var db = CreateConnection();
            long? pId = null;
            string? pUuid = null;
            if (long.TryParse(playlistId, out var idVal)) pId = idVal;
            else pUuid = playlistId;

            var parameters = new 
            {
                p_action = "UPDATE",
                p_playlist_name = playlistName,
                p_description = description,
                p_active_only = (active?.Trim().ToUpper() == "Y" || active == "1" || active?.ToLower() == "true") ? 1 : 0,
                p_playlist_id = pId,
                p_playlist_uuid = pUuid,
                p_userid = userId
            };

            var status = await db.QueryFirstOrDefaultAsync<SpStdResult>("sp_playlist_std", parameters, commandType: CommandType.StoredProcedure);
            return status != null && !status.err_flag 
                ? RepositoryResult.Ok(status.msg) 
                : RepositoryResult.Fail(status?.err_code ?? -1, status?.msg ?? "DB Error");
        }

        public async Task<RepositoryResult> DeletePlaylistAsync(string playlistId, long? userId = null)
        {
            using var db = CreateConnection();
            
            long? pId = null; 
            string? pUuid = null;
            if (long.TryParse(playlistId, out var idVal)) pId = idVal;
            else pUuid = playlistId;

            var parameters = new
            {
                p_action = "DELETE_PLAYLIST",
                p_playlist_id = pId,
                p_playlist_uuid = pUuid,
                p_userid = userId
            };

            var status = await db.QueryFirstOrDefaultAsync<SpStdResult>("sp_playlist_std", parameters, commandType: CommandType.StoredProcedure);
            return status != null && !status.err_flag 
                ? RepositoryResult.Ok(status.msg) 
                : RepositoryResult.Fail(status?.err_code ?? -1, status?.msg ?? "DB Error");
        }

        public async Task<IEnumerable<PlaylistItemDto>> GetPlaylistItemsAsync(string playlistId)
        {
            using var db = CreateConnection();
            var p = new DynamicParameters();
            p.Add("p_action", "GET_ITEMS");
            
            if (long.TryParse(playlistId, out var pId)) p.Add("p_playlist_id", pId);
            else p.Add("p_playlist_uuid", playlistId);

            // 1. Status, 2. Data
            using var multi = await db.QueryMultipleAsync("sp_playlist_std", p, commandType: CommandType.StoredProcedure);
            var status = await multi.ReadFirstOrDefaultAsync<SpStdResult>();
            
            if (status != null && status.err_flag) return Enumerable.Empty<PlaylistItemDto>();

            return await multi.ReadAsync<PlaylistItemDto>();
        }

        public async Task<RepositoryResult> AddPlaylistItemAsync(string playlistItemId, string playlistId, string mediaId, int positionOrder, int? durationOverride, long? userId = null)
        {
            using var db = CreateConnection();
            
            long? pId = null; string? pUuid = null;
            if (long.TryParse(playlistId, out var pIdVal)) pId = pIdVal; else pUuid = playlistId;

            long? mId = null; string? mUuid = null;
            if (long.TryParse(mediaId, out var mIdVal)) mId = mIdVal; else mUuid = mediaId;

            var parameters = new 
            {
                p_action = "ADD_ITEM",
                p_playlist_item_uuid = playlistItemId,
                p_position_order = positionOrder,
                p_duration_override = durationOverride,
                p_playlist_id = pId,
                p_playlist_uuid = pUuid,
                p_media_id = mId,
                p_media_uuid = mUuid,
                p_userid = userId
            };

            using var multi = await db.QueryMultipleAsync("sp_playlist_std", parameters, commandType: CommandType.StoredProcedure);
            var status = await multi.ReadFirstOrDefaultAsync<SpStdResult>();
            return status != null && !status.err_flag 
                ? RepositoryResult.Ok(status.msg) 
                : RepositoryResult.Fail(status?.err_code ?? -1, status?.msg ?? "DB Error");
        }

        public async Task<RepositoryResult> RemovePlaylistItemAsync(string playlistItemId, long? userId = null)
        {
            using var db = CreateConnection();
            var p = new DynamicParameters();
            p.Add("p_action", "REMOVE_ITEM");
            p.Add("p_playlist_item_uuid", playlistItemId);
            p.Add("p_userid", userId);

            var status = await db.QueryFirstOrDefaultAsync<SpStdResult>("sp_playlist_std", p, commandType: CommandType.StoredProcedure);
            return status != null && !status.err_flag 
                ? RepositoryResult.Ok(status.msg) 
                : RepositoryResult.Fail(status?.err_code ?? -1, status?.msg ?? "DB Error");
        }

        public async Task<RepositoryResult> ClearPlaylistItemsAsync(string playlistId, long? userId = null)
        {
            using var db = CreateConnection();
            
            long? pId = null; string? pUuid = null;
            if (long.TryParse(playlistId, out var pIdVal)) pId = pIdVal; else pUuid = playlistId;

            var parameters = new 
            {
                p_action = "CLEAR_ITEMS",
                p_playlist_id = pId,
                p_playlist_uuid = pUuid,
                p_userid = userId
            };

            var status = await db.QueryFirstOrDefaultAsync<SpStdResult>("sp_playlist_std", parameters, commandType: CommandType.StoredProcedure);
            return status != null && !status.err_flag 
                ? RepositoryResult.Ok(status.msg) 
                : RepositoryResult.Fail(status?.err_code ?? -1, status?.msg ?? "DB Error");
        }

        public async Task<RepositoryResult> ReorderPlaylistItemAsync(string playlistItemId, int positionOrder, long? userId = null)
        {
            using var db = CreateConnection();
            var p = new DynamicParameters();
            p.Add("p_action", "REORDER_ITEMS");
            p.Add("p_playlist_item_uuid", playlistItemId);
            p.Add("p_position_order", positionOrder);
            p.Add("p_userid", userId);

            var status = await db.QueryFirstOrDefaultAsync<SpStdResult>("sp_playlist_std", p, commandType: CommandType.StoredProcedure);
            return status != null && !status.err_flag 
                ? RepositoryResult.Ok(status.msg) 
                : RepositoryResult.Fail(status?.err_code ?? -1, status?.msg ?? "DB Error");
        }

        public async Task<RepositoryResult> DeleteAllItemsByMediaIdAsync(string mediaId, long? userId = null)
        {
            using var db = CreateConnection();
            var p = new DynamicParameters();
            p.Add("p_action", "DELETE_BY_MEDIA");
            p.Add("p_userid", userId);
            
            if (long.TryParse(mediaId, out var mId)) p.Add("p_media_id", mId);
            else p.Add("p_media_uuid", mediaId);
            
            var status = await db.QueryFirstOrDefaultAsync<SpStdResult>("sp_playlist_std", p, commandType: CommandType.StoredProcedure);
            return status != null && !status.err_flag 
                ? RepositoryResult.Ok(status.msg) 
                : RepositoryResult.Fail(status?.err_code ?? -1, status?.msg ?? "DB Error");
        }
    }
}
