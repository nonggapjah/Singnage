using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Models.Domain;
using SignageUnicorn.Api.Services;

namespace SignageUnicorn.Api.Repositories.Interfaces
{
    public interface IDeviceRepository
    {
        Task<RepositoryResult<DeviceDto>> RegisterOrLoginAsync(DeviceRegisterRequest request);
        Task<IEnumerable<DeviceCommandDto>> HeartbeatAsync(HeartbeatRequest request);
        Task<IEnumerable<DeviceDto>> GetAllDevicesAsync();
        Task<DeviceDto?> GetDeviceByIdAsync(string deviceId);
        Task<RepositoryResult> AddCommandAsync(string deviceId, string commandType);
        Task<RepositoryResult> AcknowledgeCommandAsync(string deviceId, string commandId, string status, long? userId = null, string? message = null);
        Task<RepositoryResult> DeactivateDeviceAsync(string deviceId, long? userId = null);
        Task<RepositoryResult> CleanupOfflineDevicesAsync(int days = 14);
        Task<RepositoryResult<int>> GetOfflineDeviceCountAsync(int days = 14);
        Task<IEnumerable<DeviceDto>> GetDevicesByMediaIdAsync(string mediaId);
        Task<IEnumerable<DeviceDto>> GetDevicesByPlaylistIdAsync(string playlistId);
        // The "where is this playlist playing" view: every screen playing this playlist now
        // (current_playlist_id) or with it explicitly assigned, with status + heartbeat age + flags.
        Task<IEnumerable<PlaylistDeviceDto>> GetDevicesForPlaylistViewAsync(string playlistId);
        Task<IEnumerable<DevicePlaylistDto>> GetAssignedPlaylistsAsync(string deviceId);
        Task<string?> GetSiblingDeviceIdWithAssignmentsAsync(string deviceId);
        Task UpdateAssignedPlaylistsAsync(string deviceId, List<DevicePlaylistDto> playlists);

        // Device token (contract item 1)
        Task<DeviceAuthInfo?> GetDeviceAuthInfoAsync(string deviceId, string? deviceUuid);
        Task SetDeviceTokenHashAsync(long deviceId, string? tokenHash);
        // Round 3 (R3): conditional write. Succeeds only when the row still holds expectedHash (or none
        // when expectedHash is null); clears the reset marker. Returns false when another write won.
        Task<bool> TrySetDeviceTokenHashAsync(long deviceId, string? expectedHash, string newHash);
        // Round 3 (R2): operator reset -- clears the hash and stamps device_token_reset_at.
        Task ResetDeviceTokenAsync(long deviceId);
        // Round 3 (#1): the ONE live row carrying this MAC whose uuid differs from excludeUuid (the same
        // rule sp_device_std uses before adopting it); null when none or more than one.
        Task<DeviceAuthInfo?> GetDeviceAuthInfoByMacAsync(string macAddress, string? excludeUuid);

        // Schedules (contract item 6 / T8)
        Task SetScheduleModeAsync(string deviceId, string mode);
        // T8: drops the device's own assignments and sets inherit mode in one transaction.
        Task ResetScheduleToInheritAsync(string deviceId);
        Task<IEnumerable<string>> GetDevicesWithScheduleTransitionsAsync(DateTime fromUtc, DateTime toUtc);
        // Round 3 (#11): screens whose EFFECTIVE schedule inherits from this device (and have no
        // SYNC_SCHEDULE waiting already); the device itself is not included.
        Task<IEnumerable<string>> GetScheduleInheritorsAsync(string deviceId);

        // Raw SQL helpers used by maintenance and the schema applier
        Task ExecuteSqlAsync(string sql);
        Task ExecuteSqlAsync(string sql, object? parameters);
        Task<T?> QueryScalarAsync<T>(string sql, object? parameters = null);
        Task<IEnumerable<T>> QueryListAsync<T>(string sql, object? parameters = null);

        // Round 4 (#2): one connection + exclusive application lock for the whole schema apply.
        Task<ISchemaSession> OpenSchemaSessionAsync();
    }
}
