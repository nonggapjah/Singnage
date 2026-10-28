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
