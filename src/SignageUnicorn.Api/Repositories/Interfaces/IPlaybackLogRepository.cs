using SignageUnicorn.Api.Models; // DTOs

namespace SignageUnicorn.Api.Repositories.Interfaces
{
    public interface IPlaybackLogRepository
    {
        Task LogPlaybackAsync(CreatePlaybackLogRequest log);
        Task LogPlaybackBatchAsync(IEnumerable<CreatePlaybackLogRequest> logs);
        Task<IEnumerable<PlaybackLogDto>> GetLatestLogsAsync(int top);
        Task<IEnumerable<PlaybackLogDto>> GetLogsByDeviceAsync(string deviceId, int top);
        Task<IEnumerable<PlaybackSummaryDto>> GetSummaryAsync(DateTime? startDate = null, DateTime? endDate = null);
        Task<IEnumerable<BranchSummaryDto>> GetBranchSummaryAsync(DateTime? startDate = null, DateTime? endDate = null);
        Task<IEnumerable<PlaybackExportDto>> GetExportDataAsync(DateTime? startDate, DateTime? endDate);
        Task ClearOldPlaybackLogsAsync(int retentionDays = 14);
    }
}
