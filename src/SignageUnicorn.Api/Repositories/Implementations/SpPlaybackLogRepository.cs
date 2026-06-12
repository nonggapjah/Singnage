using Dapper;
using Microsoft.Data.SqlClient;
using SignageUnicorn.Api.Models; // For DTOs
using SignageUnicorn.Api.Repositories.Interfaces;
using System.Data;

namespace SignageUnicorn.Api.Repositories.Implementations
{
    public class SpPlaybackLogRepository : IPlaybackLogRepository
    {
        private readonly string _connectionString;

        public SpPlaybackLogRepository(IConfiguration configuration)
        {
            _connectionString = configuration.GetConnectionString("DefaultConnection") 
                                ?? throw new InvalidOperationException("Connection string 'DefaultConnection' not found.");
            Dapper.DefaultTypeMap.MatchNamesWithUnderscores = true;
        }

        private IDbConnection CreateConnection() => new SqlConnection(_connectionString);

        private class SpStdResult
        {
            public int err_code { get; set; }
            public bool err_flag { get; set; }
            public string msg { get; set; }
        }

        public async Task LogPlaybackAsync(CreatePlaybackLogRequest log)
        {
            using var db = CreateConnection();
            var p = new DynamicParameters();
            p.Add("@p_action", "INSERT");
            p.Add("@p_duration_sec", log.Duration);
            p.Add("@p_status", log.Result ?? "success");
            p.Add("@p_error_message", log.ErrorMessage);

            if (long.TryParse(log.DeviceId, out var devId)) p.Add("@p_device_id", devId);
            else p.Add("@p_device_uuid", log.DeviceId);

            if (long.TryParse(log.MediaId, out var mediaId)) p.Add("@p_media_id", mediaId);
            else p.Add("@p_media_uuid", log.MediaId);

            if (long.TryParse(log.PlaylistId, out var plId)) p.Add("@p_playlist_id", plId);
            else p.Add("@p_playlist_uuid", log.PlaylistId);

            p.Add("@p_start_time", log.PlayedAt);

            // Just fire and check status
            var status = await db.QueryFirstOrDefaultAsync<SpStdResult>("sp_playback_log_std", p, commandType: CommandType.StoredProcedure);
        }

        public async Task LogPlaybackBatchAsync(IEnumerable<CreatePlaybackLogRequest> logs)
        {
            if (logs == null || !logs.Any()) return;

            using var db = CreateConnection();
            if (db.State != ConnectionState.Open)
            {
                if (db is SqlConnection sqlConn)
                {
                    await sqlConn.OpenAsync();
                }
                else
                {
                    db.Open();
                }
            }

            foreach (var log in logs)
            {
                var p = new DynamicParameters();
                p.Add("@p_action", "INSERT");
                p.Add("@p_duration_sec", log.Duration);
                p.Add("@p_status", log.Result ?? "success");
                p.Add("@p_error_message", log.ErrorMessage);

                if (long.TryParse(log.DeviceId, out var devId)) p.Add("@p_device_id", devId);
                else p.Add("@p_device_uuid", log.DeviceId);

                if (long.TryParse(log.MediaId, out var mediaId)) p.Add("@p_media_id", mediaId);
                else p.Add("@p_media_uuid", log.MediaId);

                if (long.TryParse(log.PlaylistId, out var plId)) p.Add("@p_playlist_id", plId);
                else p.Add("@p_playlist_uuid", log.PlaylistId);

                p.Add("@p_start_time", log.PlayedAt);

                await db.QueryFirstOrDefaultAsync<SpStdResult>("sp_playback_log_std", p, commandType: CommandType.StoredProcedure);
            }
        }

        public async Task<IEnumerable<PlaybackLogDto>> GetLatestLogsAsync(int top)
        {
            using var db = CreateConnection();
            var p = new DynamicParameters();
            p.Add("@p_action", "GET_LATEST");
            p.Add("@p_top", top);

            // 1. Status 2. Data
            using var multi = await db.QueryMultipleAsync("sp_playback_log_std", p, commandType: CommandType.StoredProcedure);
            var status = await multi.ReadFirstOrDefaultAsync<SpStdResult>();
            if (status != null && status.err_flag) return Enumerable.Empty<PlaybackLogDto>();

            return await multi.ReadAsync<PlaybackLogDto>();
        }

        public async Task<IEnumerable<PlaybackLogDto>> GetLogsByDeviceAsync(string deviceId, int top)
        {
            using var db = CreateConnection();
            var p = new DynamicParameters();
            p.Add("@p_action", "GET_BY_DEVICE");
            p.Add("@p_top", top);

            if (long.TryParse(deviceId, out var devId)) p.Add("@p_device_id", devId);
            else p.Add("@p_device_uuid", deviceId);

            using var multi = await db.QueryMultipleAsync("sp_playback_log_std", p, commandType: CommandType.StoredProcedure);
            var status = await multi.ReadFirstOrDefaultAsync<SpStdResult>();
            if (status != null && status.err_flag) return Enumerable.Empty<PlaybackLogDto>();

            return await multi.ReadAsync<PlaybackLogDto>();
        }

        public async Task<IEnumerable<PlaybackSummaryDto>> GetSummaryAsync(DateTime? startDate = null, DateTime? endDate = null)
        {
            using var db = CreateConnection();
            var p = new DynamicParameters();
            p.Add("@p_action", "GET_SUMMARY");
            p.Add("@p_start_time", startDate);
            p.Add("@p_end_time", endDate);

            using var multi = await db.QueryMultipleAsync("sp_playback_log_std", p, commandType: CommandType.StoredProcedure);
            var status = await multi.ReadFirstOrDefaultAsync<SpStdResult>();
            if (status != null && status.err_flag) return Enumerable.Empty<PlaybackSummaryDto>();

            return await multi.ReadAsync<PlaybackSummaryDto>();
        }

        public async Task<IEnumerable<BranchSummaryDto>> GetBranchSummaryAsync(DateTime? startDate = null, DateTime? endDate = null)
        {
            using var db = CreateConnection();
            var p = new DynamicParameters();
            p.Add("@p_action", "GET_BRANCH_SUMMARY");
            p.Add("@p_start_time", startDate);
            p.Add("@p_end_time", endDate);

            using var multi = await db.QueryMultipleAsync("sp_playback_log_std", p, commandType: CommandType.StoredProcedure);
            var status = await multi.ReadFirstOrDefaultAsync<SpStdResult>();
            if (status != null && status.err_flag) return Enumerable.Empty<BranchSummaryDto>();

            return await multi.ReadAsync<BranchSummaryDto>();
        }

        public async Task<IEnumerable<PlaybackExportDto>> GetExportDataAsync(DateTime? startDate, DateTime? endDate)
        {
            using var db = CreateConnection();
            var p = new DynamicParameters();
            p.Add("@p_action", "GET_EXPORT_DATA");
            p.Add("@p_start_time", startDate);
            p.Add("@p_end_time", endDate);

            using var multi = await db.QueryMultipleAsync("sp_playback_log_std", p, commandType: CommandType.StoredProcedure);
            var status = await multi.ReadFirstOrDefaultAsync<SpStdResult>();
            if (status != null && status.err_flag) return Enumerable.Empty<PlaybackExportDto>();

            return await multi.ReadAsync<PlaybackExportDto>();
        }

        public async Task ClearOldPlaybackLogsAsync(int retentionDays = 14)
        {
            using var db = CreateConnection();
            var p = new DynamicParameters();
            p.Add("@p_action", "CLEANUP");
            p.Add("@p_duration_sec", retentionDays); // We use duration_sec parameter in SP to pass retention days

            var status = await db.QueryFirstOrDefaultAsync<SpStdResult>("sp_playback_log_std", p, commandType: CommandType.StoredProcedure);
        }
    }
}
