using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Models.Domain;

namespace SignageUnicorn.Api.Repositories.Interfaces
{
    public interface IDeviceRepository
    {
        Task<RepositoryResult<DeviceDto>> RegisterOrLoginAsync(DeviceRegisterRequest request);
        Task<IEnumerable<DeviceCommandDto>> HeartbeatAsync(HeartbeatRequest request);
        Task<IEnumerable<DeviceDto>> GetAllDevicesAsync();
        Task<DeviceDto?> GetDeviceByIdAsync(string deviceId);
        Task<RepositoryResult> AddCommandAsync(string deviceId, string commandType);
        Task<RepositoryResult> DeactivateDeviceAsync(string deviceId, long? userId = null);
        Task<RepositoryResult> CleanupOfflineDevicesAsync(int days = 14);
        Task<RepositoryResult<int>> GetOfflineDeviceCountAsync(int days = 14);
        Task<IEnumerable<DeviceDto>> GetDevicesByMediaIdAsync(string mediaId);
        Task<IEnumerable<DeviceDto>> GetDevicesByPlaylistIdAsync(string playlistId);
        Task<IEnumerable<DevicePlaylistDto>> GetAssignedPlaylistsAsync(string deviceId);
        Task UpdateAssignedPlaylistsAsync(string deviceId, List<DevicePlaylistDto> playlists);
        Task ExecuteSqlAsync(string sql);
    }
}
