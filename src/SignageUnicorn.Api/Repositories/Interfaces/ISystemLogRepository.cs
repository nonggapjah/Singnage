using SignageUnicorn.Api.Models; // For SystemLogEntry

namespace SignageUnicorn.Api.Repositories.Interfaces
{
    public interface ISystemLogRepository
    {
        Task LogAsync(string? deviceId, string logType, string message, string source = "API", long? userId = null, DateTime? createdAt = null);
        // Contract item 5: device-submitted logs are written on one connection per batch.
        Task<int> LogBatchAsync(IEnumerable<SystemLogWrite> entries);
        Task<IEnumerable<SystemLogEntry>> GetLatestLogsAsync(int top = 100);
        Task<IEnumerable<SystemLogEntry>> GetFilteredLogsAsync(DateTime? startDate, DateTime? endDate, string? logType, int page, int pageSize);
        Task ClearOldLogsAsync(int retentionDays = 30);
    }
}
