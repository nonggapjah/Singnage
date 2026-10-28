using SignageUnicorn.Api.Models; // DTOs

namespace SignageUnicorn.Api.Repositories.Interfaces
{
    public interface IPlaybackLogRepository
    {
        // F28: ingestion reports what actually happened per event instead of swallowing the
        // procedure's error flag, so a client only deletes local records the server kept.
        Task<PlaybackIngestResult> LogPlaybackAsync(CreatePlaybackLogRequest log);
        Task<PlaybackBatchResult> LogPlaybackBatchAsync(IEnumerable<CreatePlaybackLogRequest> logs);
        Task<IEnumerable<PlaybackLogDto>> GetLatestLogsAsync(int top);
        Task<IEnumerable<PlaybackLogDto>> GetLogsByDeviceAsync(string deviceId, int top);
        Task<IEnumerable<PlaybackSummaryDto>> GetSummaryAsync(DateTime? startDate = null, DateTime? endDate = null);
        Task<IEnumerable<BranchSummaryDto>> GetBranchSummaryAsync(DateTime? startDate = null, DateTime? endDate = null);
        Task<IEnumerable<PlaybackExportDto>> GetExportDataAsync(DateTime? startDate, DateTime? endDate);
        Task ClearOldPlaybackLogsAsync(int retentionDays = 14);
    }
}
