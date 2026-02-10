using System;
using System.Collections.Generic;
using System.Data;
using System.Threading.Tasks;
using Dapper;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Repositories.Interfaces;

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
                
                if (long.TryParse(request.DeviceId, out var devId))
                {
                    p.Add("@p_device_id", devId);
                }
                else
                {
                    p.Add("@p_device_uuid", request.DeviceId);
                }

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

                await connection.ExecuteAsync("sp_device_std", p, commandType: CommandType.StoredProcedure);

                // 2. Poll Pending Commands
                var pPoll = new DynamicParameters();
                pPoll.Add("@p_action", "POLL_PENDING");
                if (long.TryParse(request.DeviceId, out var devIdPoll))
                {
                    pPoll.Add("@p_device_id", devIdPoll);
                }
                else
                {
                    pPoll.Add("@p_device_uuid", request.DeviceId);
                }

                // Polling now returns Status (1) then Data (2)
                using var multi = await connection.QueryMultipleAsync("sp_device_command_std", pPoll, commandType: CommandType.StoredProcedure);
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

        public async Task<IEnumerable<DeviceDto>> GetDevicesByMediaIdAsync(string mediaId)
        {
             using var connection = new SqlConnection(_connectionString);
             string sql = @"
                SELECT d.* 
                FROM sn_devices d
                WHERE d.is_deleted = 0 
                  AND d.current_playlist_id IN (
                      SELECT DISTINCT playlist_id 
                      FROM sn_playlist_items 
                      WHERE is_deleted = 0 AND media_id = (SELECT media_id FROM sn_media_files WHERE media_id = @id OR media_uuid = @id)
                  )";
             return await connection.QueryAsync<DeviceDto>(sql, new { id = mediaId });
        }

        public async Task<IEnumerable<DeviceDto>> GetDevicesByPlaylistIdAsync(string playlistId)
        {
             using var connection = new SqlConnection(_connectionString);
             string sql = @"SELECT * FROM sn_devices WHERE is_deleted = 0 AND (current_playlist_id = @id OR current_playlist_id = (SELECT playlist_id FROM sn_playlists WHERE playlist_uuid = @id))";
             return await connection.QueryAsync<DeviceDto>(sql, new { id = playlistId });
        }

        public async Task ExecuteSqlAsync(string sql)
        {
            using (var connection = new SqlConnection(_connectionString))
            {
                await connection.ExecuteAsync(sql);
            }
        }
    }
}
