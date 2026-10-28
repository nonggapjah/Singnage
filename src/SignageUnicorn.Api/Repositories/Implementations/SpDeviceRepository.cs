using System;
using System.Collections.Generic;
using System.Data;
using System.Threading.Tasks;
using Dapper;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Models.Domain;
using SignageUnicorn.Api.Repositories.Interfaces;
using SignageUnicorn.Api.Services;

namespace SignageUnicorn.Api.Repositories.Implementations
{
    public class SpDeviceRepository : IDeviceRepository
    {
        private readonly string _connectionString;

        public SpDeviceRepository(IConfiguration configuration)
        {
            _connectionString = configuration.GetConnectionString("DefaultConnection") ?? throw new InvalidOperationException("Connection string 'DefaultConnection' not found.");
        }

        private class SpStdResult
        {
            public int err_code { get; set; }
            public bool err_flag { get; set; }
            public string msg { get; set; }
        }

        public async Task<RepositoryResult<DeviceDto>> RegisterOrLoginAsync(DeviceRegisterRequest request)
        {
            using (var connection = new SqlConnection(_connectionString))
            {
                var p = new DynamicParameters();
                p.Add("@p_action", "REGISTER_OR_LOGIN");
                p.Add("@p_device_uuid", Guid.NewGuid().ToString()); // Generated if new. NOTE: Logic in SP uses this if not found.
                // If request.DeviceKey corresponds to UUID, use it. Usually DeviceKey = UUID in this context?
                // Assuming request.DeviceKey IS the UUID for identification.
                if (!string.IsNullOrEmpty(request.DeviceKey)) p.Add("@p_device_uuid", request.DeviceKey);

                p.Add("@p_device_name", request.DeviceName);
                p.Add("@p_branch_code", request.BranchCode);
                p.Add("@p_ip_address", request.IpAddress);
                p.Add("@p_location", request.Location);

                // 1. Status (ALWAYS First)
                using var multi = await connection.QueryMultipleAsync("sp_device_std", p, commandType: CommandType.StoredProcedure);
                var status = await multi.ReadFirstOrDefaultAsync<SpStdResult>();

                if (status != null && status.err_flag) 
                    return RepositoryResult<DeviceDto>.Fail(status.err_code, status.msg);

                // 2. Data
                var device = await multi.ReadFirstOrDefaultAsync<DeviceDto>();
                return RepositoryResult<DeviceDto>.Ok(device, status?.msg ?? "Success");
            }
        }

        public async Task<IEnumerable<DeviceCommandDto>> HeartbeatAsync(HeartbeatRequest request)
        {
            using (var connection = new SqlConnection(_connectionString))
            {
                // 1. Update Heartbeat Status
                var p = new DynamicParameters();
                p.Add("@p_action", "HEARTBEAT");

                if (request.CanonicalDeviceId.HasValue)
                {
                    // Contract T3: the controller authenticated exactly this row. The raw request pair
                    // is never handed to the procedure for a token-protected screen, so its identity
                    // reconciliation can no longer re-point the beat at a row the caller did not prove.
                    p.Add("@p_device_id", request.CanonicalDeviceId.Value);
                    if (!string.IsNullOrEmpty(request.CanonicalDeviceUuid))
                    {
                        p.Add("@p_device_uuid", request.CanonicalDeviceUuid);
                    }
                }
                else if (long.TryParse(request.DeviceId, out var devId))
                {
                    p.Add("@p_device_id", devId);
                    if (!string.IsNullOrEmpty(request.DeviceKey))
                    {
                        p.Add("@p_device_uuid", request.DeviceKey);
                    }
                }
                else
                {
                    p.Add("@p_device_uuid", request.DeviceId);
                }

                // Contract T5: which protocol this client speaks (1 = legacy delivery semantics).
                p.Add("@p_protocol", request.ResolvedProtocol < 1 ? 1 : request.ResolvedProtocol);
                // Round 3 (#1): the controller decided whether the procedure may adopt a MAC-matching
                // row for an unknown hardware key (never a token-protected row it did not prove).
                p.Add("@p_allow_mac_adopt", request.AllowMacAdoption);

                p.Add("@p_device_name", request.DeviceName);
                p.Add("@p_branch_code", request.BranchCode);

                if (long.TryParse(request.CurrentPlaylistId, out var plId))
                {
                    p.Add("@p_current_playlist_id", plId);
                    p.Add("@p_current_playlist_uuid", null);
                }
                else
                {
                    p.Add("@p_current_playlist_id", null);
                    p.Add("@p_current_playlist_uuid", request.CurrentPlaylistId);
                }

                if (long.TryParse(request.CurrentPlaylistItemId, out var pliId))
                {
                    p.Add("@p_current_item_id", pliId);
                    p.Add("@p_current_item_uuid", null);
                }
                else
                {
                    p.Add("@p_current_item_id", null);
                    p.Add("@p_current_item_uuid", request.CurrentPlaylistItemId);
                }

                if (long.TryParse(request.CurrentMediaId, out var mediaId))
                {
                    p.Add("@p_current_media_id", mediaId);
                    p.Add("@p_current_media_uuid", null);
                }
                else
                {
                    p.Add("@p_current_media_id", null);
                    p.Add("@p_current_media_uuid", request.CurrentMediaId);
                }

                p.Add("@p_position_sec", request.CurrentPositionSec);
                p.Add("@p_cache_progress", request.CacheProgress);
                p.Add("@p_status", request.Status);

                // Boot Report fields (sent once on startup, NULL on regular heartbeats)
                p.Add("@p_app_version", request.AppVersion);
                p.Add("@p_ip_address", request.IpAddress);
                p.Add("@p_location", request.Location);
                p.Add("@p_ratio", request.Ratio);
                p.Add("@p_mac_address", request.MacAddress);

                // Polling now returns Status (1) then Data (2) OUT OF sp_device_std directly!
                using var multi = await connection.QueryMultipleAsync("sp_device_std", p, commandType: CommandType.StoredProcedure);
                var status = await multi.ReadFirstOrDefaultAsync<SpStdResult>();

                if (status != null && status.err_flag) return Enumerable.Empty<DeviceCommandDto>();

                return await multi.ReadAsync<DeviceCommandDto>();
            }
        }

        public async Task<IEnumerable<DeviceDto>> GetAllDevicesAsync()
        {
            using (var connection = new SqlConnection(_connectionString))
            {
                var p = new DynamicParameters();
                p.Add("@p_action", "GET_ALL");
                // 1. Status, 2. Data
                using var multi = await connection.QueryMultipleAsync("sp_device_std", p, commandType: CommandType.StoredProcedure);
                var status = await multi.ReadFirstOrDefaultAsync<SpStdResult>();

                if (status != null && status.err_flag) return Enumerable.Empty<DeviceDto>();

                return await multi.ReadAsync<DeviceDto>();
            }
        }

        public async Task<DeviceDto?> GetDeviceByIdAsync(string deviceId)
        {
            using (var connection = new SqlConnection(_connectionString))
            {
                var p = new DynamicParameters();
                p.Add("@p_action", "GET_BY_UUID"); // Action name is just a flag, usually 'GET_BY_ID' or 'GET_BY_UUID' map to same logic in SP

                if (long.TryParse(deviceId, out var devId)) p.Add("@p_device_id", devId);
                else p.Add("@p_device_uuid", deviceId);

                // 1. Status, 2. Data
                using var multi = await connection.QueryMultipleAsync("sp_device_std", p, commandType: CommandType.StoredProcedure);
                var status = await multi.ReadFirstOrDefaultAsync<SpStdResult>();

                if (status != null && status.err_flag) return null;

                return await multi.ReadFirstOrDefaultAsync<DeviceDto>();
            }
        }

        public async Task<RepositoryResult> AddCommandAsync(string deviceId, string commandType)
        {
            using (var connection = new SqlConnection(_connectionString))
            {
                long? devId = null;
                string? devUuid = null;

                if (long.TryParse(deviceId, out var id)) devId = id;
                else devUuid = deviceId;

                // Use Anonymous Object to avoid DynamicParameter string keys issues
                var p = new 
                {
                    p_action = "CREATE",
                    p_device_id = devId,
                    p_device_uuid = devUuid,
                    p_command_type = commandType,
                    p_command_uuid = Guid.NewGuid().ToString()
                };

                try 
                {
                    var status = await connection.QueryFirstOrDefaultAsync<SpStdResult>("sp_device_command_std", p, commandType: CommandType.StoredProcedure);
                     return status != null && !status.err_flag 
                        ? RepositoryResult.Ok(status.msg) 
                        : RepositoryResult.Fail(status?.err_code ?? -1, status?.msg ?? "DB Error");
                }
                catch (SqlException ex)
                {
                    return RepositoryResult.Fail(500, $"SQL Error: {ex.Message} (Check if 'sp_device_command_std' exists by clicking INIT DB)");
                }
                catch (Exception ex)
                {
                    return RepositoryResult.Fail(500, $"Unexpected Error: {ex.Message}");
                }
            }
        }

        public async Task<RepositoryResult> AcknowledgeCommandAsync(string deviceId, string commandId, string status, long? userId = null, string? message = null)
        {
            using (var connection = new SqlConnection(_connectionString))
            {
                long? devId = null;
                string? devUuid = null;

                if (long.TryParse(deviceId, out var id)) devId = id;
                else devUuid = deviceId;

                long? cmdId = null;
                string? cmdUuid = null;

                if (long.TryParse(commandId, out var cid)) cmdId = cid;
                else cmdUuid = commandId;

                var p = new 
                {
                    p_action = "ACKNOWLEDGE",
                    p_device_id = devId,
                    p_device_uuid = devUuid,
                    p_command_id = cmdId,
                    p_command_uuid = cmdUuid,
                    p_status = status,
                    // Contract item 2: the procedure stores @p_payload as fail_reason when FAILED.
                    p_payload = message,
                    p_userid = userId
                };

                try 
                {
                    var result = await connection.QueryFirstOrDefaultAsync<SpStdResult>("sp_device_command_std", p, commandType: CommandType.StoredProcedure);
                    return result != null && !result.err_flag 
                        ? RepositoryResult.Ok(result.msg) 
                        : RepositoryResult.Fail(result?.err_code ?? -1, result?.msg ?? "DB Error");
                }
                catch (SqlException ex)
                {
                    return RepositoryResult.Fail(500, $"SQL Error: {ex.Message}");
                }
                catch (Exception ex)
                {
                    return RepositoryResult.Fail(500, $"Unexpected Error: {ex.Message}");
                }
            }
        }

        public async Task<RepositoryResult> DeactivateDeviceAsync(string deviceId, long? userId = null)
        {
            using (var connection = new SqlConnection(_connectionString))
            {
                var p = new 
                {
                    p_action = "DEACTIVATE",
                    p_device_id = long.TryParse(deviceId, out var id) ? (long?)id : null,
                    p_device_uuid = !long.TryParse(deviceId, out _) ? deviceId : null,
                    p_userid = userId
                };

                try 
                {
                    using var multi = await connection.QueryMultipleAsync("sp_device_std", p, commandType: CommandType.StoredProcedure);
                    var status = await multi.ReadFirstOrDefaultAsync<SpStdResult>();
                    return status != null && !status.err_flag 
                        ? RepositoryResult.Ok(status.msg) 
                        : RepositoryResult.Fail(status?.err_code ?? -1, status?.msg ?? "DB Error");
                }
                catch (SqlException ex)
                {
                    return RepositoryResult.Fail(500, $"SQL Error: {ex.Message}");
                }
                catch (Exception ex)
                {
                    return RepositoryResult.Fail(500, $"Internal Error: {ex.Message}");
                }
            }
        }

        public async Task<RepositoryResult> CleanupOfflineDevicesAsync(int days = 14)
        {
            using (var connection = new SqlConnection(_connectionString))
            {
                var p = new DynamicParameters();
                p.Add("@p_action", "CLEANUP_OFFLINE");
                p.Add("@p_cleanup_days", days);

                using var multi = await connection.QueryMultipleAsync("sp_device_std", p, commandType: CommandType.StoredProcedure);
                var status = await multi.ReadFirstOrDefaultAsync<SpStdResult>();

                return status != null && !status.err_flag 
                    ? RepositoryResult.Ok(status.msg) 
                    : RepositoryResult.Fail(status?.err_code ?? -1, status?.msg ?? "DB Error");
            }
        }

        public async Task<RepositoryResult<int>> GetOfflineDeviceCountAsync(int days = 14)
        {
            using (var connection = new SqlConnection(_connectionString))
            {
                var p = new DynamicParameters();
                p.Add("@p_action", "COUNT_OFFLINE_ZOMBIES");
                p.Add("@p_cleanup_days", days);

                using var multi = await connection.QueryMultipleAsync("sp_device_std", p, commandType: CommandType.StoredProcedure);
                var status = await multi.ReadFirstOrDefaultAsync<SpStdResult>();

                if (status != null && status.err_flag) 
                    return RepositoryResult<int>.Fail(status.err_code, status.msg);

                var data = await multi.ReadFirstOrDefaultAsync<dynamic>();
                int count = data != null ? (int)data.Count : 0;

                return RepositoryResult<int>.Ok(count, status?.msg ?? "Count Calculated");
            }
        }

        // F20: the old queries compared one string parameter against BIGINT id columns AND uuid
        // columns in the same expression; a UUID argument raised an implicit-conversion error that
        // the callers swallowed, so an edit "succeeded" without any screen being told. Ids are now
        // parsed here and only the matching column is compared. Screens are matched through BOTH
        // what they currently play and what is assigned to them (sn_device_playlists).
        public async Task<IEnumerable<DeviceDto>> GetDevicesByMediaIdAsync(string mediaId)
        {
             using var connection = new SqlConnection(_connectionString);
             long? mid = null; string? muuid = null;
             if (long.TryParse(mediaId, out var parsed)) mid = parsed; else muuid = mediaId;

             string sql = @"
                DECLARE @mid BIGINT = @mediaId;
                IF @mid IS NULL AND @mediaUuid IS NOT NULL
                    SELECT @mid = media_id FROM sn_media_files WHERE media_uuid = @mediaUuid;
" + InheritorCtes(@"
                SELECT d.device_id
                FROM sn_devices d
                WHERE d.is_deleted = 0
                  AND @mid IS NOT NULL
                  AND EXISTS (
                      SELECT 1 FROM sn_playlist_items pi
                      WHERE pi.is_deleted = 0 AND pi.media_id = @mid
                        AND (pi.playlist_id = d.current_playlist_id
                             OR pi.playlist_id IN (SELECT dp.playlist_id FROM sn_device_playlists dp
                                                   WHERE dp.device_id = d.device_id AND dp.is_active = 1)))") + @"
                SELECT DISTINCT
                    CAST(d.device_id AS NVARCHAR(36)) AS DeviceId,
                    d.device_uuid AS DeviceUuid,
                    d.device_name AS DeviceName,
                    d.branch_code AS BranchCode
                FROM sn_devices d
                JOIN targets t ON t.device_id = d.device_id
                WHERE d.is_deleted = 0";
             return await connection.QueryAsync<DeviceDto>(sql, new { mediaId = mid, mediaUuid = muuid });
        }

        public async Task<IEnumerable<DeviceDto>> GetDevicesByPlaylistIdAsync(string playlistId)
        {
             using var connection = new SqlConnection(_connectionString);
             long? pid = null; string? puuid = null;
             if (long.TryParse(playlistId, out var parsed)) pid = parsed; else puuid = playlistId;

             string sql = @"
                DECLARE @pid BIGINT = @playlistId;
                IF @pid IS NULL AND @playlistUuid IS NOT NULL
                    SELECT @pid = playlist_id FROM sn_playlists WHERE playlist_uuid = @playlistUuid;
" + InheritorCtes(@"
                SELECT d.device_id
                FROM sn_devices d
                WHERE d.is_deleted = 0
                  AND @pid IS NOT NULL
                  AND (d.current_playlist_id = @pid
                       OR EXISTS (SELECT 1 FROM sn_device_playlists dp
                                  WHERE dp.device_id = d.device_id AND dp.is_active = 1 AND dp.playlist_id = @pid))") + @"
                SELECT DISTINCT
                    CAST(d.device_id AS NVARCHAR(36)) AS DeviceId,
                    d.device_uuid AS DeviceUuid,
                    d.device_name AS DeviceName,
                    d.branch_code AS BranchCode
                FROM sn_devices d
                JOIN targets t ON t.device_id = d.device_id
                WHERE d.is_deleted = 0";
             return await connection.QueryAsync<DeviceDto>(sql, new { playlistId = pid, playlistUuid = puuid });
        }

        public async Task<IEnumerable<DevicePlaylistDto>> GetAssignedPlaylistsAsync(string deviceId)
        {
            using var connection = new SqlConnection(_connectionString);

            long? devId = null;
            string? devUuid = null;
            if (long.TryParse(deviceId, out var parsed)) devId = parsed;
            else devUuid = deviceId;

            string sql = @"
                SELECT dp.id as Id, dp.device_id as DeviceId, p.playlist_uuid as PlaylistId, p.playlist_name as PlaylistName,
                       dp.start_date as StartDate, dp.end_date as EndDate, dp.is_active as IsActive
                FROM sn_device_playlists dp
                JOIN sn_playlists p ON dp.playlist_id = p.playlist_id
                WHERE dp.device_id = (SELECT top 1 device_id FROM sn_devices WHERE device_id = @devId OR device_uuid = @devUuid)
                  AND dp.is_active = 1
                  AND p.is_deleted = 0
                ORDER BY dp.id ASC";
            return await connection.QueryAsync<DevicePlaylistDto>(sql, new { devId, devUuid });
        }

        // Finds another device at the SAME branch with the SAME device name that already has
        // active playlist assignments. Used so a freshly installed / re-registered screen (which
        // comes up with a brand-new device identity and no assignments of its own) can inherit the
        // content its peers already play, instead of sitting idle waiting for a manual selection.
        public async Task<string?> GetSiblingDeviceIdWithAssignmentsAsync(string deviceId)
        {
            using var connection = new SqlConnection(_connectionString);

            long? devId = null;
            string? devUuid = null;
            if (long.TryParse(deviceId, out var parsed)) devId = parsed;
            else devUuid = deviceId;

            // BUG-02: sibling matching used exact equality on branch_code + device_name, so a
            // single stray character silently removed a screen from its peer group and it came
            // up idle with no error anywhere -- a Silent Failure. Production carried a leading
            // space ("[space]homepro cherngtalay All") and a double space ("KAMALA  ALL").
            // Both halves are needed: the data is corrected separately, and matching is
            // hardened here so the next typo does not repeat the outage.
            //
            // NormaliseName collapses runs of spaces to one and trims the ends; the explicit
            // CI_AS collation makes case differences ("Kamala ALL") match regardless of the
            // column's own collation. Non-sargable, but sn_devices is a few hundred rows.
            //
            // @self also had the same non-deterministic TOP 1 as sp_device_std (see BUG-01
            // defect B): with an OR over id and uuid it could resolve to the wrong row and
            // then inherit from the wrong branch entirely. Same deterministic ordering applied.
            const string NormaliseName =
                "LTRIM(RTRIM(REPLACE(REPLACE(REPLACE({0}, ' ', CHAR(1)+CHAR(2)), CHAR(2)+CHAR(1), ''), CHAR(1)+CHAR(2), ' ')))";

            string sql = $@"
                DECLARE @self BIGINT = (
                    SELECT TOP 1 device_id FROM sn_devices
                    WHERE is_deleted = 0 AND (device_id = @devId OR device_uuid = @devUuid)
                    ORDER BY CASE WHEN device_uuid = @devUuid THEN 0 ELSE 1 END,
                             CASE WHEN device_id  = @devId  THEN 0 ELSE 1 END,
                             device_id DESC);

                DECLARE @branch NVARCHAR(50), @name NVARCHAR(255);
                SELECT @branch = LTRIM(RTRIM(branch_code)),
                       @name   = {string.Format(NormaliseName, "device_name")}
                FROM sn_devices WHERE device_id = @self;

                SELECT TOP 1 sib.device_id
                FROM sn_devices sib
                JOIN sn_device_playlists dp ON dp.device_id = sib.device_id AND dp.is_active = 1
                WHERE sib.is_deleted = 0
                  AND sib.device_id <> @self
                  AND LTRIM(RTRIM(sib.branch_code)) = @branch
                  AND {string.Format(NormaliseName, "sib.device_name")}
                      COLLATE SQL_Latin1_General_CP1_CI_AS = @name COLLATE SQL_Latin1_General_CP1_CI_AS
                ORDER BY dp.id DESC";
            var sibling = await connection.ExecuteScalarAsync<long?>(sql, new { devId, devUuid });
            return sibling?.ToString();
        }

        public async Task UpdateAssignedPlaylistsAsync(string deviceId, List<DevicePlaylistDto> playlists)
        {
            using var connection = new SqlConnection(_connectionString);
            await connection.OpenAsync();
            using var transaction = connection.BeginTransaction();
            try
            {
                long? parsedId = null;
                string? parsedUuid = null;
                if (long.TryParse(deviceId, out var parsedVal)) parsedId = parsedVal;
                else parsedUuid = deviceId;

                long devId = await connection.ExecuteScalarAsync<long>(
                    "SELECT top 1 device_id FROM sn_devices WHERE device_id = @parsedId OR device_uuid = @parsedUuid", 
                    new { parsedId, parsedUuid }, transaction);

                // Contract item 6 / F18: any admin assignment (including clearing to an empty list) is
                // an explicit decision. Schedule resolution must then never fall back to a sibling
                // screen's content -- "clear this screen" used to make it resume the neighbour's playlist.
                await connection.ExecuteAsync("UPDATE sn_devices SET schedule_mode = 'explicit' WHERE device_id = @devId", new { devId }, transaction);

                // Clear existing mappings for device. We DELETE rather than just flipping is_active=0
                // so the table does not accumulate dead rows on every reassignment (it previously grew
                // unbounded — ~94% of rows were inactive leftovers).
                await connection.ExecuteAsync("DELETE FROM sn_device_playlists WHERE device_id = @devId", new { devId }, transaction);

                // Insert new mappings
                if (playlists != null && playlists.Count > 0)
                {
                    string insertSql = @"
                        DECLARE @actual_playlist_id bigint;
                        SELECT TOP 1 @actual_playlist_id = playlist_id 
                        FROM sn_playlists 
                        WHERE playlist_uuid = @playlistId OR CAST(playlist_id AS nvarchar(50)) = @playlistId;

                        IF @actual_playlist_id IS NOT NULL
                        BEGIN
                            INSERT INTO sn_device_playlists (device_id, playlist_id, start_date, end_date, is_active)
                            VALUES (@devId, @actual_playlist_id, @startDate, @endDate, 1)
                        END";

                    foreach (var p in playlists)
                    {
                        await connection.ExecuteAsync(insertSql, new { 
                            devId = devId, 
                            playlistId = p.PlaylistId, 
                            startDate = p.StartDate, 
                            endDate = p.EndDate 
                        }, transaction);
                    }
                }

                transaction.Commit();
            }
            catch
            {
                transaction.Rollback();
                throw;
            }
        }

        // Contract item 1. Resolves the row the same way sp_device_std does: the hardware uuid wins,
        // the numeric id is the weaker hint (a stale local config can carry another row's id).
        public async Task<DeviceAuthInfo?> GetDeviceAuthInfoAsync(string deviceId, string? deviceUuid)
        {
            using var connection = new SqlConnection(_connectionString);
            long? devId = null;
            string? idAsUuid = null;
            if (long.TryParse(deviceId, out var parsed)) devId = parsed;
            else if (!string.IsNullOrWhiteSpace(deviceId)) idAsUuid = deviceId;

            string sql = @"
                SELECT TOP 1 device_id AS DeviceId, device_uuid AS DeviceUuid, device_token_hash AS TokenHash,
                       mac_address AS MacAddress, device_token_issued_at AS TokenIssuedAt,
                       device_token_reset_at AS TokenResetAt
                FROM sn_devices WITH (NOLOCK)
                WHERE is_deleted = 0
                  AND (device_id = @devId OR device_uuid = @devUuid OR device_uuid = @idAsUuid)
                ORDER BY CASE WHEN device_uuid = @devUuid THEN 0 ELSE 1 END,
                         CASE WHEN device_uuid = @idAsUuid THEN 0 ELSE 1 END,
                         CASE WHEN device_id = @devId THEN 0 ELSE 1 END,
                         device_id DESC";
            return await connection.QueryFirstOrDefaultAsync<DeviceAuthInfo>(sql, new { devId, devUuid = deviceUuid, idAsUuid });
        }

        public async Task SetDeviceTokenHashAsync(long deviceId, string? tokenHash)
        {
            using var connection = new SqlConnection(_connectionString);
            await connection.ExecuteAsync(
                @"UPDATE sn_devices
                  SET device_token_hash = @tokenHash,
                      device_token_issued_at = CASE WHEN @tokenHash IS NULL THEN NULL ELSE SYSUTCDATETIME() END
                  WHERE device_id = @deviceId",
                new { deviceId, tokenHash });
        }

        // Round 3 (R3 / Codex round-3 finding 3). Two claims for the same row could both read "no
        // token", both write, and the screen that received the losing token was locked out on its
        // next heartbeat. The write is now conditional on the hash that was read; the caller treats
        // 0 affected rows as a lost race and never hands out the token it generated.
        public async Task<bool> TrySetDeviceTokenHashAsync(long deviceId, string? expectedHash, string newHash)
        {
            using var connection = new SqlConnection(_connectionString);
            var rows = await connection.ExecuteAsync(
                @"UPDATE sn_devices
                  SET device_token_hash = @newHash,
                      device_token_issued_at = SYSUTCDATETIME(),
                      device_token_reset_at = NULL
                  WHERE device_id = @deviceId AND is_deleted = 0
                    AND ((@expectedHash IS NULL AND device_token_hash IS NULL) OR device_token_hash = @expectedHash)",
                new { deviceId, expectedHash, newHash });
            return rows == 1;
        }

        // Round 3 (R2). The marker is what turns the next heartbeat into a RECLAIM_TOKEN instruction.
        public async Task ResetDeviceTokenAsync(long deviceId)
        {
            using var connection = new SqlConnection(_connectionString);
            await connection.ExecuteAsync(
                @"UPDATE sn_devices
                  SET device_token_hash = NULL,
                      device_token_issued_at = NULL,
                      device_token_reset_at = SYSUTCDATETIME()
                  WHERE device_id = @deviceId",
                new { deviceId });
        }

        // Round 3 (#1). Mirrors the adoption rule in sp_device_std HEARTBEAT: exactly ONE live row with
        // this MAC and a different uuid. Ambiguous MACs (cloned images) yield null, as there.
        public async Task<DeviceAuthInfo?> GetDeviceAuthInfoByMacAsync(string macAddress, string? excludeUuid)
        {
            using var connection = new SqlConnection(_connectionString);
            var rows = (await connection.QueryAsync<DeviceAuthInfo>(@"
                SELECT TOP 2 device_id AS DeviceId, device_uuid AS DeviceUuid, device_token_hash AS TokenHash,
                       mac_address AS MacAddress, device_token_issued_at AS TokenIssuedAt,
                       device_token_reset_at AS TokenResetAt
                FROM sn_devices WITH (NOLOCK)
                WHERE is_deleted = 0
                  AND LTRIM(RTRIM(mac_address)) = LTRIM(RTRIM(@mac))
                  AND (@excludeUuid IS NULL OR device_uuid <> @excludeUuid)",
                new { mac = macAddress, excludeUuid })).ToList();
            return rows.Count == 1 ? rows[0] : null;
        }

        public async Task SetScheduleModeAsync(string deviceId, string mode)
        {
            using var connection = new SqlConnection(_connectionString);
            long? devId = null; string? devUuid = null;
            if (long.TryParse(deviceId, out var parsed)) devId = parsed; else devUuid = deviceId;
            await connection.ExecuteAsync(
                @"UPDATE sn_devices SET schedule_mode = @mode
                  WHERE is_deleted = 0 AND (device_id = @devId OR device_uuid = @devUuid)",
                new { mode, devId, devUuid });
        }

        // Contract T8 / Codex round-2 finding 19: "reset to inherit" promised to drop the screen's own
        // assignments and follow a sibling, but only flipped the mode while schedule resolution still
        // preferred the existing assignments. Both halves now happen in one transaction.
        public async Task ResetScheduleToInheritAsync(string deviceId)
        {
            using var connection = new SqlConnection(_connectionString);
            await connection.OpenAsync();
            using var transaction = connection.BeginTransaction();
            try
            {
                long? devId = null; string? devUuid = null;
                if (long.TryParse(deviceId, out var parsed)) devId = parsed; else devUuid = deviceId;

                var id = await connection.ExecuteScalarAsync<long?>(@"
                    SELECT TOP 1 device_id FROM sn_devices
                    WHERE is_deleted = 0 AND (device_id = @devId OR device_uuid = @devUuid)
                    ORDER BY CASE WHEN device_uuid = @devUuid THEN 0 ELSE 1 END,
                             CASE WHEN device_id  = @devId  THEN 0 ELSE 1 END,
                             device_id DESC", new { devId, devUuid }, transaction);
                if (id == null) throw new KeyNotFoundException("Device not found");

                await connection.ExecuteAsync("DELETE FROM sn_device_playlists WHERE device_id = @id", new { id }, transaction);
                await connection.ExecuteAsync("UPDATE sn_devices SET schedule_mode = 'inherit' WHERE device_id = @id", new { id }, transaction);
                transaction.Commit();
            }
            catch
            {
                transaction.Rollback();
                throw;
            }
        }

        // Contract T8. Given a SELECT that yields the owner device ids, builds the CTEs
        //   owners      - those devices,
        //   inheritors  - live devices in 'inherit' mode with no assignments of their own whose
        //                 branch + (normalised, case-insensitive) name equals an owner's, i.e. the
        //                 screens whose EFFECTIVE schedule is that owner's (see GetDeviceScheduleAsync),
        //   targets     - the union.
        // Codex round-2 finding 18: a campaign boundary or playlist edit used to notify only the owner,
        // so a sibling that inherits the schedule kept playing expired content until something else
        // poked it.
        private const string InheritorNameNorm =
            "LTRIM(RTRIM(REPLACE(REPLACE(REPLACE({0}, ' ', CHAR(1)+CHAR(2)), CHAR(2)+CHAR(1), ''), CHAR(1)+CHAR(2), ' ')))";

        private static string InheritorCtes(string ownersSelect) => $@"
                ;WITH owners AS ({ownersSelect}
                ),
                inheritors AS (
                    SELECT i.device_id
                    FROM sn_devices i
                    JOIN sn_devices o ON o.device_id IN (SELECT device_id FROM owners)
                    WHERE i.is_deleted = 0 AND o.is_deleted = 0
                      AND i.device_id <> o.device_id
                      AND ISNULL(i.schedule_mode, 'inherit') = 'inherit'
                      AND LTRIM(RTRIM(i.branch_code)) = LTRIM(RTRIM(o.branch_code))
                      AND {string.Format(InheritorNameNorm, "i.device_name")} COLLATE SQL_Latin1_General_CP1_CI_AS
                        = {string.Format(InheritorNameNorm, "o.device_name")} COLLATE SQL_Latin1_General_CP1_CI_AS
                      AND NOT EXISTS (SELECT 1 FROM sn_device_playlists dp WHERE dp.device_id = i.device_id AND dp.is_active = 1)
                ),
                targets AS (
                    SELECT device_id FROM owners
                    UNION
                    SELECT device_id FROM inheritors
                )";

        // Contract item 6 / T8: devices whose assignment start or end fell inside (fromUtc, toUtc],
        // plus the screens inheriting those assignments, minus those that already have a
        // SYNC_SCHEDULE waiting.
        public async Task<IEnumerable<string>> GetDevicesWithScheduleTransitionsAsync(DateTime fromUtc, DateTime toUtc)
        {
            using var connection = new SqlConnection(_connectionString);
            string sql = InheritorCtes(@"
                    SELECT DISTINCT dp.device_id
                    FROM sn_device_playlists dp
                    JOIN sn_devices d ON d.device_id = dp.device_id AND d.is_deleted = 0
                    WHERE dp.is_active = 1
                      AND ((dp.start_date > @fromUtc AND dp.start_date <= @toUtc)
                        OR (dp.end_date   > @fromUtc AND dp.end_date   <= @toUtc))") + @"
                SELECT DISTINCT CAST(t.device_id AS NVARCHAR(36))
                FROM targets t
                WHERE NOT EXISTS (SELECT 1 FROM sn_device_commands c
                                  WHERE c.device_id = t.device_id
                                    AND c.command_type = 'SYNC_SCHEDULE'
                                    AND c.status = 'PENDING') -- round 4 (#5): dedupe only against UNDELIVERED syncs; a POLLING one may already carry the old schedule";
            return await connection.QueryAsync<string>(sql, new { fromUtc, toUtc });
        }

        // Round 3 (#11): assignment changes used to notify only the edited screen; siblings that
        // inherit its schedule kept the previous content until a boundary or restart.
        public async Task<IEnumerable<string>> GetScheduleInheritorsAsync(string deviceId)
        {
            using var connection = new SqlConnection(_connectionString);
            long? devId = null; string? devUuid = null;
            if (long.TryParse(deviceId, out var parsed)) devId = parsed; else devUuid = deviceId;
            string sql = InheritorCtes(@"
                    SELECT device_id FROM sn_devices
                    WHERE is_deleted = 0 AND (device_id = @devId OR device_uuid = @devUuid)") + @"
                SELECT DISTINCT CAST(i.device_id AS NVARCHAR(36))
                FROM inheritors i
                WHERE NOT EXISTS (SELECT 1 FROM sn_device_commands c
                                  WHERE c.device_id = i.device_id
                                    AND c.command_type = 'SYNC_SCHEDULE'
                                    AND c.status = 'PENDING') -- round 4 (#5): dedupe only against UNDELIVERED syncs; a POLLING one may already carry the old schedule";
            return await connection.QueryAsync<string>(sql, new { devId, devUuid });
        }

        public async Task ExecuteSqlAsync(string sql)
        {
            using (var connection = new SqlConnection(_connectionString))
            {
                await connection.ExecuteAsync(sql, commandTimeout: 300);
            }
        }

        public async Task ExecuteSqlAsync(string sql, object? parameters)
        {
            using var connection = new SqlConnection(_connectionString);
            await connection.ExecuteAsync(sql, parameters, commandTimeout: 300);
        }

        public async Task<T?> QueryScalarAsync<T>(string sql, object? parameters = null)
        {
            using var connection = new SqlConnection(_connectionString);
            return await connection.ExecuteScalarAsync<T>(sql, parameters, commandTimeout: 300);
        }

        public async Task<IEnumerable<T>> QueryListAsync<T>(string sql, object? parameters = null)
        {
            using var connection = new SqlConnection(_connectionString);
            return await connection.QueryAsync<T>(sql, parameters, commandTimeout: 300);
        }

        // Round 4 (#2): see ISchemaSession / SqlSchemaSession.
        public async Task<ISchemaSession> OpenSchemaSessionAsync()
            => await SqlSchemaSession.OpenAsync(_connectionString);
    }
}
