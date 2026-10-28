using Microsoft.AspNetCore.Mvc;
using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Models.Responses;
using SignageUnicorn.Api.Repositories;
using SignageUnicorn.Api.Repositories.Interfaces;
using SignageUnicorn.Api.Services;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Data.SqlClient;
using SignageUnicorn.Api.Constants;

namespace SignageUnicorn.Api.Controllers
{
    [ApiController]
    [Route("api/v1/logs/playback")]
    [Authorize]
    public class PlaybackLogController : ControllerBase
    {
        private readonly IPlaybackLogRepository _playbackRepo;
        private readonly DeviceAuthService _deviceAuth;

        public PlaybackLogController(IPlaybackLogRepository playbackRepo, DeviceAuthService deviceAuth)
        {
            _playbackRepo = playbackRepo;
            _deviceAuth = deviceAuth;
        }

        private string? PresentedToken => Request.Headers.TryGetValue(DeviceAuthService.HeaderName, out var v) ? v.ToString() : null;
        private string? RemoteIp => HttpContext.Connection.RemoteIpAddress?.ToString();

        private static IActionResult RetryLater(RetryableStoreException ex)
        {
            // Contract T6: the client keeps its events and re-sends them later.
            Console.WriteLine($"[PlaybackLog] RETRY_LATER | {ex.Message}");
            return new ObjectResult(ApiResponse<object>.ErrorResponse(503, "RETRY_LATER")) { StatusCode = 503 };
        }

        // Contract items 1 and 4. The single and batch endpoints stay anonymous for HTTP auth, but the
        // device token rule applies: a device that holds a token must present it.
        [AllowAnonymous]
        [HttpPost]
        [RequestSizeLimit(256 * 1024)]
        public async Task<IActionResult> Create([FromBody] CreatePlaybackLogRequest request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.DeviceId) || string.IsNullOrWhiteSpace(request.MediaId))
                return BadRequest(ApiResponse<object>.ErrorResponse(400, "deviceId and mediaId are required"));

            var auth = await _deviceAuth.ResolveAsync(request.DeviceId, null, PresentedToken, RemoteIp);
            if (!auth.Ok) return Unauthorized(ApiResponse<object>.ErrorResponse(401, auth.Message));
            // Contract T3: a token-protected screen is stored under the row it authenticated as.
            if (auth.Resolved && auth.HasToken) request.DeviceId = auth.DeviceId!.Value.ToString();

            try
            {
                var result = await _playbackRepo.LogPlaybackAsync(request);
                if (!result.Accepted)
                    return BadRequest(ApiResponse<object>.ErrorResponse(400, result.Error ?? "Playback log rejected"));

                return Ok(new { success = true, message = result.Duplicate ? "Duplicate skipped" : "Playback log recorded", duplicate = result.Duplicate });
            }
            catch (RetryableStoreException ex)
            {
                return RetryLater(ex);
            }
            catch (SqlException ex) when (SqlTransientErrors.IsDataError(ex))
            {
                return BadRequest(ApiResponse<object>.ErrorResponse(400, $"Playback log rejected: SQL {ex.Number}"));
            }
            catch (SqlException ex)
            {
                // F28 / R4: a database failure must NOT look like success or a rejection, or the client
                // deletes its only copy. Retry later.
                return RetryLater(new RetryableStoreException($"Database error: {ex.Message}", ex));
            }
        }

        [AllowAnonymous]
        [HttpPost("batch")]
        [RequestSizeLimit(4 * 1024 * 1024)]
        public async Task<IActionResult> CreateBatch([FromBody] List<CreatePlaybackLogRequest> requests)
        {
            if (requests == null || requests.Count == 0)
                return Ok(new { success = true, message = "Nothing to record", count = 0, data = new { accepted = Array.Empty<string>(), rejected = Array.Empty<object>(), acceptedCount = 0, rejectedCount = 0 } });

            if (requests.Count > 500)
                return BadRequest(ApiResponse<object>.ErrorResponse(400, "Batch too large (max 500 events)"));

            // One batch normally comes from one screen, but validate every distinct device it names so a
            // token for screen A cannot be used to forge plays for screen B. Contract T3: events of a
            // token-protected screen are stored under the row it authenticated as.
            var canonical = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var deviceId in requests.Select(r => r.DeviceId).Where(d => !string.IsNullOrWhiteSpace(d)).Distinct(StringComparer.OrdinalIgnoreCase))
            {
                var auth = await _deviceAuth.ResolveAsync(deviceId, null, PresentedToken, RemoteIp);
                if (!auth.Ok) return Unauthorized(ApiResponse<object>.ErrorResponse(401, auth.Message));
                if (auth.Resolved && auth.HasToken) canonical[deviceId] = auth.DeviceId!.Value.ToString();
            }
            if (canonical.Count > 0)
            {
                foreach (var r in requests)
                    if (!string.IsNullOrWhiteSpace(r.DeviceId) && canonical.TryGetValue(r.DeviceId, out var id)) r.DeviceId = id;
            }

            try
            {
                var result = await _playbackRepo.LogPlaybackBatchAsync(requests);
                // "count" is kept for clients that still read it; the contract payload lives in "data".
                return Ok(new
                {
                    success = true,
                    message = $"Batch processed: {result.AcceptedCount} accepted, {result.RejectedCount} rejected",
                    count = result.AcceptedCount,
                    data = new
                    {
                        accepted = result.Accepted,
                        rejected = result.Rejected.Select(r => new { eventId = r.EventId, reason = r.Reason }),
                        acceptedCount = result.AcceptedCount,
                        rejectedCount = result.RejectedCount
                    }
                });
            }
            catch (RetryableStoreException ex)
            {
                return RetryLater(ex);
            }
            catch (PlaybackBatchValidationException ex)
            {
                // Contract T6: a legacy batch is all-or-nothing; nothing was stored.
                return BadRequest(ApiResponse<object>.ErrorResponse(400, ex.Message));
            }
            catch (SqlException ex)
            {
                return StatusCode(500, ApiResponse<object>.ErrorResponse(500, $"Database error: {ex.Message}"));
            }
        }

        [HttpGet]
        public async Task<IActionResult> GetLatest([FromQuery] int top = 100)
        {
            var logs = await _playbackRepo.GetLatestLogsAsync(top);
            return Ok(new { success = true, data = logs });
        }

        [HttpGet("device/{deviceId}")]
        public async Task<IActionResult> GetByDevice(string deviceId, [FromQuery] int top = 100)
        {
            var logs = await _playbackRepo.GetLogsByDeviceAsync(deviceId, top);
            return Ok(new { success = true, data = logs });
        }

        [HttpGet("summary")]
        public async Task<IActionResult> GetSummary([FromQuery] DateTime? start, [FromQuery] DateTime? end)
        {
            var summary = await _playbackRepo.GetSummaryAsync(start, end);
            return Ok(new { success = true, data = summary });
        }

        [HttpGet("summary/branch")]
        public async Task<IActionResult> GetBranchSummary([FromQuery] DateTime? start, [FromQuery] DateTime? end)
        {
            var summary = await _playbackRepo.GetBranchSummaryAsync(start, end);
            return Ok(new { success = true, data = summary });
        }

        [HttpGet("export")]
        [Authorize(Roles = UserRoles.Admin)]
        public async Task<IActionResult> GetExportData([FromQuery] DateTime? start, [FromQuery] DateTime? end)
        {
            var logs = await _playbackRepo.GetExportDataAsync(start, end);
            return Ok(new { success = true, data = logs });
        }
    }
}
