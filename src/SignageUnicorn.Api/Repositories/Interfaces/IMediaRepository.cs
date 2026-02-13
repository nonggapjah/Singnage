using SignageUnicorn.Api.Models;

namespace SignageUnicorn.Api.Repositories.Interfaces
{
    public interface IMediaRepository
    {
        Task<IEnumerable<MediaFile>> GetAllAsync(string? searchTerm = null, string? supplierCode = null, string? remark1 = null, string? remark2 = null, string? status = null, string? mediaType = null);
        Task<MediaFile?> GetByIdAsync(string id);
        Task<RepositoryResult<MediaFile>> CreateAsync(MediaFile media, long? userId = null);
        Task<RepositoryResult<MediaFile>> UpdateAsync(MediaFile media, long? userId = null);
        Task<RepositoryResult> DeleteAsync(string id, long? userId = null, bool force = false);
        Task<IEnumerable<MediaUsageDto>> GetMediaUsageAsync(string mediaId);
        Task<RepositoryResult<MediaFile>> SwapMediaAsync(string oldId, string newId, long? userId = null);
        Task<RepositoryResult<MediaFile>> ReplaceAsync(MediaFile media, long? userId = null);
        Task<RepositoryResult> RestoreAsync(string id, long? userId = null);
        Task<bool> SyncMediaUrls(string targetUrl, string newUrl);
    }
}
