using System.Linq;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SignageUnicorn.Api.Models.Responses;
using SignageUnicorn.Api.Services;

namespace SignageUnicorn.Api.Controllers
{
    // Round 3 (R1). The kiosk, the web player and the admin console all have to work against BOTH the
    // deployed 2.7.x API and this one during the staged rollout. Instead of guessing from error
    // codes, a client asks once what this API can do; the deployed API answers 404 to this route,
    // which the clients treat as "legacy".
    [ApiController]
    [Route("api/v1/system")]
    public class SystemController : ControllerBase
    {
        public sealed class CapabilitiesDto
        {
            public string ApiVersion { get; init; } = SignageUnicorn.Api.Services.ApiVersion.Current;
            // Highest device protocol this API speaks (X-Client-Protocol).
            public int Protocol { get; init; } = 2;
            // Per-device tokens: register with tokenCapable, POST /devices/{id}/token/claim, X-Device-Token.
            public bool DeviceToken { get; init; } = true;
            // Query-string date filters are UTC (ISO-8601 with Z); offset-less values are read as UTC.
            public bool UtcFilters { get; init; } = true;
            // Screenshots are read through GET /devices/{id}/screenshot (operator auth), not static files.
            public bool ScreenshotRoute { get; init; } = true;
            // Login sets the httpOnly su_session cookie and answers authMode "cookie"; non-GET
            // cookie-authenticated requests need X-Requested-With: SignageUnicorn.
            public bool CookieSession { get; init; } = true;
            // POST /logs/playback/batch answers {accepted, rejected} per event and 503 RETRY_LATER.
            public bool PlaybackBatchV2 { get; init; } = true;
            // Heartbeat may carry the RECLAIM_TOKEN pseudo-command after an operator reset.
            public bool ReclaimCommand { get; init; } = true;
            // Audio player (2.8.6): devices carry playbackMode/volume, register accepts playbackMode,
            // audio uploads are transcoded, schedules are filtered per mode, SET_VOLUME:<n> exists.
            public bool AudioDevices { get; init; } = true;
            // Dayparts (2.8.7): assignments carry startTime/endTime/daysOfWeek/repeatEveryMinutes;
            // schedules may carry interjections for audio players.
            public bool Dayparts { get; init; } = true;
            // Media egress gate (2.8.12): /media and /setup downloads may answer 503 + Retry-After under load.
            public bool EgressGate { get; init; } = true;
            // Branch-by-branch rollout (2.8.14): batch-add-playlist accepts `rollout`, /rollouts lists and steers them.
            public bool PlaylistRollout { get; init; } = true;
            // Media integrity (2.8.15): files are checked against their stored hash; bad ones are held back; /system/media-integrity.
            public bool MediaIntegrity { get; init; } = true;
        }

        // Media integrity (2.8.15): what the checker found, and the admin actions.
        [HttpGet("media-integrity")]
        [Authorize]
        public async Task<IActionResult> MediaIntegrity([FromServices] SignageUnicorn.Api.Services.Media.MediaIntegrityService svc,
                                                        [FromServices] SignageUnicorn.Api.Services.Media.MediaIntegrityState state,
                                                        [FromQuery] bool all = false)
        {
            var items = await svc.ListAsync(onlyProblems: !all);
            return Ok(ApiResponse<object>.SuccessResponse(new
            {
                lastRunUtc = state.LastRunUtc,
                lastRunSummary = state.LastRunSummary,
                quarantined = items.Count(i => SignageUnicorn.Api.Services.Media.MediaIntegrityService.IsQuarantineStatus(i.Status)),
                items,
            }));
        }

        [HttpPost("media-integrity/run")]
        [Authorize(Roles = SignageUnicorn.Api.Constants.UserRoles.Admin)]
        public async Task<IActionResult> MediaIntegrityRun([FromServices] SignageUnicorn.Api.Services.Media.MediaIntegrityService svc)
        {
            var (ok, bad, errors) = await svc.RunAsync(HttpContext.RequestAborted);
            return Ok(ApiResponse<object>.SuccessResponse(new { ok, quarantined = bad, errors }, $"{ok + bad} media checked: {ok} ok, {bad} held back" + (errors > 0 ? $", {errors} could not be checked" : "")));
        }

        // The admin looked at the file and wants it served as it is: hash and size are taken from the disk file.
        [HttpPost("media-integrity/{id}/accept-disk")]
        [Authorize(Roles = SignageUnicorn.Api.Constants.UserRoles.Admin)]
        public async Task<IActionResult> MediaIntegrityAcceptDisk(string id, [FromServices] SignageUnicorn.Api.Services.Media.MediaIntegrityService svc)
        {
            long? userId = long.TryParse(User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value, out var uid) ? uid : null;
            var (okay, message) = await svc.AcceptDiskAsync(id, userId);
            return okay ? Ok(ApiResponse<object>.SuccessResponse(null, message)) : BadRequest(ApiResponse<object>.ErrorResponse(400, message));
        }

        // Media egress gate (2.8.12): what the server is pushing out right now and the limits in force.
        // Operators watch this while a campaign spreads; the bundle's egress.ps1 adjusts the limits.
        [HttpGet("egress")]
        [Authorize]
        public IActionResult Egress([FromServices] SignageUnicorn.Api.Services.MediaEgressGate gate)
        {
            var s = gate.Snapshot();
            return Ok(ApiResponse<object>.SuccessResponse(new
            {
                inFlight = s.InFlight,
                waiting = s.Waiting,
                admitted = s.Admitted,
                rejected = s.Rejected,
                throttleWaits = s.ThrottleWaits,
                bytesSent = s.BytesSent,
                sentMB = Math.Round(s.BytesSent / 1048576.0, 1),
                maxConcurrentDownloads = s.Settings.MaxConcurrentDownloads,
                queueWaitSeconds = s.Settings.QueueWaitSeconds,
                maxEgressMbps = s.Settings.MaxEgressMbps,
                settingsSource = s.SettingsSource,
                settingsAppliedUtc = s.SettingsAppliedUtc,
                overrideKeys = new[] { SignageUnicorn.Api.Middleware.MediaEgressMiddleware.SlotsKey, SignageUnicorn.Api.Middleware.MediaEgressMiddleware.MbpsKey, SignageUnicorn.Api.Middleware.MediaEgressMiddleware.WaitKey },
            }));
        }

        [HttpGet("capabilities")]
        [AllowAnonymous]
        [ResponseCache(Duration = 60, Location = ResponseCacheLocation.Any, NoStore = false)]
        public IActionResult Capabilities()
        {
            Response.Headers["Cache-Control"] = "public, max-age=60";
            return Ok(ApiResponse<CapabilitiesDto>.SuccessResponse(new CapabilitiesDto()));
        }
    }
}
