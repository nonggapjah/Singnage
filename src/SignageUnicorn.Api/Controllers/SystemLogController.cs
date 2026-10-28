using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Models.Responses;
using SignageUnicorn.Api.Repositories.Interfaces;
using SignageUnicorn.Api.Services;
using System.Data;
using Microsoft.AspNetCore.Authorization;
using System.Threading.Tasks;
using SignageUnicorn.Api.Constants;

namespace SignageUnicorn.Api.Controllers
{
    public class SystemLogDto
    {
        public string LogId { get; set; } = string.Empty;
        public string? DeviceId { get; set; }
        public string LogType { get; set; } = string.Empty;
        public string Message { get; set; } = string.Empty;
        public string Source { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; }
    }

    [ApiController]
    [Route("api/v1/logs")]
    [Authorize]
    public class SystemLogController : ControllerBase
    {
        private const int MaxBatch = 100;
        private readonly ISystemLogRepository _repo;
        private readonly DeviceAuthService _deviceAuth;

        public SystemLogController(ISystemLogRepository repo, DeviceAuthService deviceAuth)
        {
            _repo = repo;
            _deviceAuth = deviceAuth;
        }

        private string? PresentedToken => Request.Headers.TryGetValue(DeviceAuthService.HeaderName, out var v) ? v.ToString() : null;
        private string? RemoteIp => HttpContext.Connection.RemoteIpAddress?.ToString();

        [HttpGet]
        public async Task<IActionResult> GetLogs(
            [FromQuery] DateTime? startDate,
            [FromQuery] DateTime? endDate,
            [FromQuery] string? logType,
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 50,
            [FromQuery] int? top = null)
        {
            IEnumerable<SystemLogEntry> logEntries;
            if (top.HasValue && startDate == null)
            {
                 logEntries = await _repo.GetLatestLogsAsync(top.Value);
            }
            else
            {
                 logEntries = await _repo.GetFilteredLogsAsync(startDate, endDate, logType, page, pageSize);
            }

            var logs = logEntries.Select(entry =>
            {
                // The repository embeds the device id in the message ("[Device: 123] ...") because the
                // table has no device column; recover it here for the console.
                string deviceId = entry.DeviceId;
                string msg = entry.Message ?? "";

                if (string.IsNullOrEmpty(deviceId) && msg.StartsWith("[Device: "))
                {
                    var endIdx = msg.IndexOf(']');
                    if (endIdx > 9) deviceId = msg.Substring(9, endIdx - 9);
                }

                return new SystemLogDto
                {
                    LogId = entry.LogId.ToString(),
                    DeviceId = deviceId,
                    LogType = entry.LogType ?? "INFO",
                    Message = msg,
                    Source = entry.Source ?? "API",
                    CreatedAt = entry.CreatedAt
                };
            }).ToList();

            return Ok(new { success = true, data = logs });
        }

        // Contract item 5 / F28. These endpoints used to answer "captured" while discarding every
        // entry, so screens deleted the only copy of their diagnostics. WARN/ERROR entries are now
        // persisted (INFO is acknowledged but dropped by design: it was the volume that exhausted the
        // pool before), batches are bounded, rate-limited per IP, and the device token rule applies
        // when a device id is present.
        [AllowAnonymous]
        [EnableRateLimiting("logs")]
        [HttpPost]
        [RequestSizeLimit(64 * 1024)]
        public async Task<IActionResult> CreateLog([FromBody] SystemLogDto log)
        {
            if (log == null) return BadRequest(ApiResponse<object>.ErrorResponse(400, "Body required"));
            return await StoreAsync(new List<SystemLogDto> { log });
        }

        [AllowAnonymous]
        [EnableRateLimiting("logs")]
        [HttpPost("batch")]
        [RequestSizeLimit(512 * 1024)]
        public async Task<IActionResult> CreateBatch([FromBody] List<SystemLogDto> logs)
        {
            if (logs == null || logs.Count == 0)
                return Ok(ApiResponse<object>.SuccessResponse(new { stored = 0, dropped = 0 }, "Nothing to store"));
            if (logs.Count > MaxBatch)
                return BadRequest(ApiResponse<object>.ErrorResponse(400, $"Batch too large (max {MaxBatch} entries)"));
            return await StoreAsync(logs);
        }

        private static bool IsKeptLevel(string? level)
        {
            var l = (level ?? string.Empty).Trim().ToUpperInvariant();
            return l is "WARN" or "WARNING" or "ERROR" or "CRITICAL" or "FATAL";
        }

        private async Task<IActionResult> StoreAsync(List<SystemLogDto> logs)
        {
            // Contract T3: entries of a token-protected screen are stored under the row it authenticated as.
            var canonical = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var deviceId in logs.Select(l => l.DeviceId).Where(d => !string.IsNullOrWhiteSpace(d)).Distinct(StringComparer.OrdinalIgnoreCase))
            {
                var auth = await _deviceAuth.ResolveAsync(deviceId, null, PresentedToken, RemoteIp);
                if (!auth.Ok) return Unauthorized(ApiResponse<object>.ErrorResponse(401, auth.Message));
                if (auth.Resolved && auth.HasToken) canonical[deviceId!] = auth.DeviceId!.Value.ToString();
            }
            if (canonical.Count > 0)
            {
                foreach (var l in logs)
                    if (!string.IsNullOrWhiteSpace(l.DeviceId) && canonical.TryGetValue(l.DeviceId, out var id)) l.DeviceId = id;
            }

            var kept = logs.Where(l => IsKeptLevel(l.LogType)).Select(l =>
            {
                var type = l.LogType.Trim().ToUpperInvariant();
                var isError = type is "ERROR" or "CRITICAL" or "FATAL";
                var message = (l.Message ?? string.Empty);
                if (message.Length > 4000) message = message.Substring(0, 4000);
                return new SystemLogWrite
                {
                    DeviceId = string.IsNullOrWhiteSpace(l.DeviceId) ? null : l.DeviceId.Trim(),
                    Level = isError ? "Error" : "Warning",
                    Category = isError ? "ERROR" : "WARNING",
                    Message = message,
                    Source = string.IsNullOrWhiteSpace(l.Source) ? "Device" : l.Source.Trim(),
                    CreatedAt = l.CreatedAt == default ? null : l.CreatedAt
                };
            }).ToList();

            int stored = 0;
            if (kept.Count > 0)
            {
                try
                {
                    stored = await _repo.LogBatchAsync(kept);
                }
                catch (Exception ex) when (SignageUnicorn.Api.Repositories.SqlTransientErrors.IsDataError(ex))
                {
                    return StatusCode(400, ApiResponse<object>.ErrorResponse(400, $"Log entries rejected: {ex.Message}"));
                }
                catch (Exception ex)
                {
                    // Contract T6 / R4: any store failure that is not about the data (transient, schema
                    // mismatch, missing procedure) -> the screen keeps its queue and retries later.
                    Console.WriteLine($"[SystemLog] RETRY_LATER | {ex.Message}");
                    return StatusCode(503, ApiResponse<object>.ErrorResponse(503, "RETRY_LATER"));
                }
            }

            return Ok(ApiResponse<object>.SuccessResponse(new { stored, dropped = logs.Count - stored }, $"Stored {stored}, dropped {logs.Count - stored}"));
        }

        [HttpDelete]
        [Authorize(Roles = UserRoles.Admin)]
        public async Task<IActionResult> ClearLogs()
        {
            await _repo.ClearOldLogsAsync();
            return Ok(ApiResponse<bool>.SuccessResponse(true, "Old logs cleared successfully."));
        }
    }
}
