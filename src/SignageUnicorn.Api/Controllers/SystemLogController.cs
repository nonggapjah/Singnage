using Microsoft.AspNetCore.Mvc;
using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Models.Responses;
using SignageUnicorn.Api.Repositories.Interfaces;
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
        private readonly ISystemLogRepository _repo;

        public SystemLogController(ISystemLogRepository repo)
        {
            _repo = repo;
        }

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
                // Logic to extract DeviceID if embedded in message, although Repository might map it to 'DeviceId' property if it parsed it.
                // Assuming SystemLogEntry has DeviceId property if relevant, OR we parse it here if SystemLogEntry.Message contains it.
                // But SystemLogEntry in DashboardModels.cs HAS DeviceId. 
                // Repository creates SystemLogEntry from DB. 
                // DB 'message' might contain "[Device: ...]".
                // BUT SpSystemLogRepository maps DB columns to SystemLogEntry. 
                // Use Dapper's matching. DB columns: log_id, log_level, ..., message.
                // SP result set has columns matching SystemLogEntry properties? 
                // SystemLogEntry: LogId, DeviceId, LogType, Message, Source, CreatedAt.
                // SP Result: LogId, LogLevel(map to LogType?), SourceSystem(map to Source?), Category(map to LogType?), Message, UserId, IpAddress, CreatedAt.
                // Mismatches:
                // LogLevel -> map to ? 
                // Category -> map to LogType
                // SourceSystem -> map to Source
                // DeviceId -> Missing in SP result.
                
                // We should probably rely on parsing Message for DeviceId in the Controller for now, just like before, OR fix the DTO mapping.
                // Let's re-implement the parsing logic on the objects.
                
                string deviceId = entry.DeviceId; // Might be null from DB
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
                    LogType = entry.LogType ?? "INFO", // Check mapping
                    Message = msg,
                    Source = entry.Source ?? "API",
                    CreatedAt = entry.CreatedAt
                };
            }).ToList();

            return Ok(new { success = true, data = logs });
        }
 
        [AllowAnonymous]
        [HttpPost]
        public async Task<IActionResult> CreateLog([FromBody] SystemLogDto log)
        {
            if (log == null || string.IsNullOrEmpty(log.Message))
                return BadRequest(ApiResponse<bool>.ErrorResponse(400, "Log message is required"));

            await _repo.LogAsync(log.DeviceId, log.LogType, log.Message, log.Source ?? "Player");
            return Ok(ApiResponse<bool>.SuccessResponse(true, "Log captured"));
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
