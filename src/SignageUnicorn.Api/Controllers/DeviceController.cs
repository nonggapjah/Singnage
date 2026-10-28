using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using SignageUnicorn.Api.Constants;
using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Models.Domain;
using SignageUnicorn.Api.Models.Responses;
using SignageUnicorn.Api.Services;

namespace SignageUnicorn.Api.Controllers
{
    [ApiController]
    [Route("api/v1/devices")]
    [Authorize]
    public class DeviceController : ControllerBase
    {
        private readonly DeviceService _deviceService;
        private readonly DeviceAuthService _deviceAuth;

        public DeviceController(DeviceService deviceService, DeviceAuthService deviceAuth)
        {
            _deviceService = deviceService;
            _deviceAuth = deviceAuth;
        }

        private string? PresentedToken => Request.Headers.TryGetValue(DeviceAuthService.HeaderName, out var v) ? v.ToString() : null;
        private string? RemoteIp => HttpContext.Connection.RemoteIpAddress?.ToString();
        private IActionResult DeviceTokenRejected() => Unauthorized(ApiResponse<object>.ErrorResponse(401, DeviceAuthService.RejectMessage));
        private IActionResult DeviceAuthRejected(DeviceAuthResult auth) => Unauthorized(ApiResponse<object>.ErrorResponse(401, auth.Message));
        // Round 3 (R3): a token write lost against a concurrent issuance; the caller retries later.
        private IActionResult TokenRace() => StatusCode(409, ApiResponse<object>.ErrorResponse(409, DeviceAuthService.RaceMessage));

        // Contract T3: the identity the stored procedures are given. For a token-protected screen it is
        // the ONE row the request authenticated as; for a legacy (token-less) screen the raw id so
        // the procedure's own reconciliation keeps working.
        private static string CanonicalId(DeviceAuthResult auth, string rawId)
            => auth.Resolved && auth.HasToken ? auth.DeviceId!.Value.ToString() : rawId;

        private long? CurrentUserId()
        {
            var claim = User.Claims.FirstOrDefault(c => c.Type == "id" || c.Type == System.Security.Claims.ClaimTypes.NameIdentifier);
            return claim != null && long.TryParse(claim.Value, out var uid) ? uid : null;
        }

        // Contract item 1 / T1 / T4. Register is where a NEW screen obtains its token (rotated when the
        // current one is presented) -- but only when the client says it can store one
        // (tokenCapable / X-Device-Token-Capable), so a deployed v2.7.x screen that re-registers is
        // never handed a token it would discard and then be locked out by. A row that already holds a
        // token is authenticated BEFORE anything about it is changed. Rate-limited per IP because the
        // endpoint is anonymous and creates rows.
        [HttpPost("register")]
        [AllowAnonymous]
        [EnableRateLimiting("register")]
        public async Task<IActionResult> Register([FromBody] DeviceRegisterRequest request)
        {
            // Auto-detect IP
            var remoteIp = RemoteIp;
            if (!string.IsNullOrEmpty(remoteIp) && remoteIp != "::1")
            {
               request.IpAddress = remoteIp;
            }

            var tokenCapable = DeviceAuthService.IsTokenCapable(request.TokenCapable, Request.Headers[DeviceAuthService.CapabilityHeaderName]);

            try
            {
                await _deviceAuth.PreAuthorizeRegisterAsync(request.DeviceKey, PresentedToken, remoteIp);
            }
            catch (DeviceAuthRejectedException)
            {
                return DeviceTokenRejected();
            }

            var device = await _deviceService.RegisterDeviceAsync(request);
            if (device == null)
                return BadRequest(ApiResponse<object>.ErrorResponse(400, "Device registration failed"));

            try
            {
                var token = await _deviceAuth.IssueOrRotateAsync(device, PresentedToken, tokenCapable, remoteIp);
                if (token != null)
                {
                    device.DeviceToken = token;
                    device.HasDeviceToken = true;
                    device.DeviceTokenIssuedAt = DateTime.UtcNow;
                    device.TokenResetPending = false;
                }
            }
            catch (DeviceAuthRejectedException)
            {
                return DeviceTokenRejected();
            }
            catch (DeviceTokenRaceException)
            {
                return TokenRace();
            }

            return Ok(ApiResponse<DeviceDto>.SuccessResponse(device));
        }

        // Contract T2. How an EXISTING screen obtains its token after upgrading to a token-capable
        // client, or after an operator reset it. Resolves only the row named by {id}; never creates
        // or re-points a row (the register path did, which stranded screens whose stored identity had
        // drifted -- Codex round-2 finding 4).
        [HttpPost("{id}/token/claim")]
        [AllowAnonymous]
        [EnableRateLimiting("claim")]
        public async Task<IActionResult> ClaimToken(string id, [FromBody] DeviceTokenClaimRequest? request)
        {
            var outcome = await _deviceAuth.ClaimAsync(id, request?.DeviceKey, request?.MacAddress, PresentedToken, RemoteIp);
            switch (outcome.Status)
            {
                case ClaimStatus.Issued:
                case ClaimStatus.Rotated:
                    return Ok(ApiResponse<DeviceTokenClaimResponse>.SuccessResponse(new DeviceTokenClaimResponse
                    {
                        DeviceId = outcome.Info!.DeviceId.ToString(),
                        DeviceUuid = outcome.Info.DeviceUuid,
                        DeviceToken = outcome.Token!
                    }, outcome.Status == ClaimStatus.Rotated ? "Device token rotated" : "Device token issued"));
                case ClaimStatus.NotFound:
                    return NotFound(ApiResponse<object>.ErrorResponse(404, "Device not found"));
                case ClaimStatus.EvidenceMismatch:
                    return StatusCode(403, ApiResponse<object>.ErrorResponse(403, DeviceAuthService.ClaimMismatchMessage));
                case ClaimStatus.AlreadyIssued:
                    return StatusCode(409, ApiResponse<object>.ErrorResponse(409, DeviceAuthService.ClaimAlreadyIssuedMessage));
                case ClaimStatus.Race:
                    return TokenRace();
                default:
                    return StatusCode(503, ApiResponse<object>.ErrorResponse(503, "DEVICE_AUTH_UNAVAILABLE"));
            }
        }

        [HttpPost("heartbeat")]
        [AllowAnonymous]
        public async Task<IActionResult> Heartbeat([FromBody] HeartbeatRequest request)
        {
            // Contract T3: resolve the ONE row this beat is about before anything touches the database.
            var presented = PresentedToken ?? request.DeviceToken;
            var auth = await _deviceAuth.ResolveAsync(request.DeviceId, request.DeviceKey, presented, RemoteIp);
            if (!auth.Ok) return DeviceAuthRejected(auth);
            if (auth.Resolved && auth.HasToken)
            {
                request.CanonicalDeviceId = auth.DeviceId;
                request.CanonicalDeviceUuid = auth.DeviceUuid;
            }
            else if (!auth.KeyKnown && !string.IsNullOrWhiteSpace(request.MacAddress))
            {
                // Round 3 (#1 / Codex round-3 finding 1). The hardware key names no live row, so the
                // procedure would adopt the one row carrying this MAC -- re-point its uuid, update it
                // and hand over its commands. For a token-protected row that is a takeover by anyone
                // who knows a MAC, so it is authorised here first: proven token -> adopt; otherwise the
                // beat is treated as a brand-new screen (IfIssued) or refused (Required).
                var decision = await _deviceAuth.AuthorizeMacAdoptionAsync(request.DeviceKey, request.MacAddress, presented, RemoteIp);
                if (decision == MacAdoptionDecision.Reject) return DeviceTokenRejected();
                if (decision == MacAdoptionDecision.Block) request.AllowMacAdoption = false;
            }

            // Contract T5: which protocol the client speaks (header wins over the body field).
            request.ResolvedProtocol = DeviceAuthService.ParseProtocol(Request.Headers[DeviceAuthService.ProtocolHeaderName], request.ClientProtocol);

            // Auto-detect IP from request (same as Register)
            var remoteIp = RemoteIp;
            if (!string.IsNullOrEmpty(remoteIp) && remoteIp != "::1")
            {
                request.IpAddress = remoteIp;
            }

            var commands = await _deviceService.ProcessHeartbeatAsync(request);

            // The procedure used to inject UPDATE_DEVICE_ID when the id a screen sent was not the row it
            // resolved to. A canonical pair never differs, so do the same here for a token-protected
            // screen whose stored numeric id is stale (e.g. its old row was retired).
            if (request.CanonicalDeviceId.HasValue
                && long.TryParse(request.DeviceId, out var sentId)
                && sentId != request.CanonicalDeviceId.Value)
            {
                var canonical = request.CanonicalDeviceId.Value.ToString();
                var heal = new DeviceCommandDto
                {
                    CommandId = "0",
                    DeviceCommandId = DeviceAuthService.NewPseudoCommandId(),
                    DeviceId = canonical,
                    CommandType = "UPDATE_DEVICE_ID:" + canonical,
                    Status = "EXECUTED",
                    CreatedAt = DateTime.UtcNow
                };
                commands = new[] { heal }.Concat(commands ?? Enumerable.Empty<DeviceCommandDto>()).ToList();
            }

            // Round 3 (R2 / Codex round-3 finding 7). An operator reset clears the token; under IfIssued
            // the screen is then accepted token-less forever and, holding a token it believes valid,
            // never claims again. Tell a client that can act on it to re-claim now.
            if (DeviceAuthService.ShouldRequestReclaim(auth.TokenResetPending, presented, request.ResolvedProtocol))
            {
                var reclaim = new DeviceCommandDto
                {
                    CommandId = "0",
                    DeviceCommandId = DeviceAuthService.NewPseudoCommandId(),
                    DeviceId = (auth.DeviceId?.ToString()) ?? request.DeviceId,
                    CommandType = DeviceAuthService.ReclaimCommand,
                    Status = "EXECUTED",
                    CreatedAt = DateTime.UtcNow
                };
                commands = new[] { reclaim }.Concat(commands ?? Enumerable.Empty<DeviceCommandDto>()).ToList();
            }
            return Ok(ApiResponse<IEnumerable<DeviceCommandDto>>.SuccessResponse(commands));
        }

        [HttpGet]
        public async Task<IActionResult> GetAll()
        {
            var devices = await _deviceService.GetAllDevicesAsync();
            return Ok(ApiResponse<IEnumerable<DeviceDto>>.SuccessResponse(devices));
        }

        [HttpGet("{id}")]
        public async Task<IActionResult> GetById(string id)
        {
            var device = await _deviceService.GetDeviceByIdAsync(id);
            if (device == null) return NotFound(ApiResponse<DeviceDto>.ErrorResponse(404, "Device not found"));
            return Ok(ApiResponse<DeviceDto>.SuccessResponse(device));
        }

        // Admin-only: queues a PLAY_PLAYLIST command to a device. Was previously [AllowAnonymous],
        // which let anyone on the internet drive any screen. The admin UI uses the authenticated
        // /command and /playlists endpoints, and the player never calls this — so locking it down
        // closes the hole without affecting either.
        [HttpPost("{id}/assign-playlist")]
        [Authorize(Roles = UserRoles.Admin)]
        public async Task<IActionResult> AssignPlaylist(string id, [FromBody] dynamic payload)
        {
            string playlistId = payload.GetProperty("playlistId").GetString();
            // Directly queue the command as if sent by admin
            await _deviceService.SendCommandAsync(id, "PLAY_PLAYLIST:" + playlistId);
            return Ok(ApiResponse<object>.SuccessResponse(null, "Playlist assigned successfully"));
        }

        // Contract item 2: the acknowledging device must own the command, and FAILED carries a reason.
        [HttpPost("{id}/command/ack")]
        [AllowAnonymous]
        public async Task<IActionResult> AcknowledgeCommand(string id, [FromBody] CommandAckRequest request)
        {
            var auth = await _deviceAuth.ResolveAsync(id, null, PresentedToken, RemoteIp);
            if (!auth.Ok) return DeviceAuthRejected(auth);

            if (string.IsNullOrWhiteSpace(request?.CommandId))
                return BadRequest(ApiResponse<object>.ErrorResponse(400, "commandId is required"));

            // Round 3 (R2): acknowledgements of controller-injected pseudo-commands (RECLAIM_TOKEN,
            // UPDATE_DEVICE_ID) are not rows in sn_device_commands; answer 200 and ignore them.
            if (DeviceAuthService.IsPseudoCommandId(request.CommandId))
                return Ok(ApiResponse<object>.SuccessResponse(null, "Pseudo-command acknowledged"));

            var status = (request.Status ?? "EXECUTED").Trim().ToUpperInvariant();
            if (status != "EXECUTED" && status != "FAILED") status = "EXECUTED";

            var result = await _deviceService.AcknowledgeCommandAsync(CanonicalId(auth, id), request.CommandId, status, null, request.Message);
            if (!result.Success)
            {
                if (result.ErrorCode == 404)
                    return NotFound(ApiResponse<object>.ErrorResponse(404, result.Message));
                return BadRequest(ApiResponse<object>.ErrorResponse(result.ErrorCode, result.Message));
            }
            return Ok(ApiResponse<object>.SuccessResponse(null, "Command acknowledged successfully"));
        }

        // Contract item 8: token-gated upload, small body cap, JPEG/PNG only, stored outside wwwroot.
        [HttpPost("{id}/screenshot")]
        [AllowAnonymous]
        [RequestSizeLimit(4_000_000)]
        public async Task<IActionResult> UploadScreenshot(string id, [FromBody] ScreenshotUploadRequest request)
        {
            var auth = await _deviceAuth.ResolveAsync(id, null, PresentedToken, RemoteIp);
            if (!auth.Ok) return DeviceAuthRejected(auth);

            var problem = await _deviceService.SaveScreenshotAsync(CanonicalId(auth, id), request?.Base64Image ?? string.Empty);
            if (problem != null)
                return BadRequest(ApiResponse<object>.ErrorResponse(400, $"Screenshot rejected: {problem}"));
            return Ok(ApiResponse<object>.SuccessResponse(null, "Screenshot uploaded successfully"));
        }

        // Contract item 8: screenshots are read through the API with an operator token, never as a
        // public static file.
        [HttpGet("{id}/screenshot")]
        public async Task<IActionResult> GetScreenshot(string id)
        {
            var path = await _deviceService.ResolveScreenshotPathAsync(id);
            if (path == null) return NotFound(ApiResponse<object>.ErrorResponse(404, "No screenshot for this device"));

            Response.Headers["Cache-Control"] = "no-store";
            Response.Headers["X-Content-Type-Options"] = "nosniff";
            return PhysicalFile(path, "image/jpeg");
        }

        // Contract item 1 / T2: clears the device's token so the screen can obtain a fresh one through
        // POST {id}/token/claim (new clients retry the claim when they are rejected).
        [HttpPost("{id}/reset-token")]
        [Authorize(Roles = UserRoles.Admin)]
        public async Task<IActionResult> ResetToken(string id)
        {
            try
            {
                await _deviceAuth.ResetAsync(id, CurrentUserId());
                return Ok(ApiResponse<object>.SuccessResponse(null, "Device token cleared; the screen will receive a new one on its next claim."));
            }
            catch (KeyNotFoundException)
            {
                return NotFound(ApiResponse<object>.ErrorResponse(404, "Device not found"));
            }
        }

        [HttpPost("{id}/command")]
        [Authorize(Roles = UserRoles.Admin)]
        public async Task<IActionResult> SendCommand(string id, [FromBody] dynamic payload)
        {
            // Simple string wrapper for now
            string cmd = payload.GetProperty("command").GetString();
            await _deviceService.SendCommandAsync(id, cmd);
            return Ok(ApiResponse<object>.SuccessResponse(null));
        }

        [HttpPost("batch-command")]
        [Authorize(Roles = UserRoles.Admin)]
        public async Task<IActionResult> BatchCommand([FromBody] BatchCommandRequest request)
        {
            await _deviceService.BatchSendCommandAsync(request.DeviceIds, request.Command);
            return Ok(ApiResponse<object>.SuccessResponse(null, $"Command sent to {request.DeviceIds.Count} devices"));
        }

        [HttpDelete("{id}")]
        [Authorize(Roles = UserRoles.Admin)]
        public async Task<IActionResult> Deactivate(string id)
        {
            var result = await _deviceService.DeactivateDeviceAsync(id, CurrentUserId());
            if (result.Success)
            {
                return Ok(ApiResponse<object>.SuccessResponse(null, "Device deleted successfully"));
            }

            if (result.ErrorCode == 500)
            {
                return StatusCode(500, ApiResponse<object>.ErrorResponse(500, result.Message));
            }
            return BadRequest(ApiResponse<object>.ErrorResponse(result.ErrorCode, result.Message));
        }

        [HttpPost("cleanup-offline")]
        [Authorize(Roles = UserRoles.Admin)]
        public async Task<IActionResult> CleanupOffline([FromQuery] int days = 14)
        {
            var result = await _deviceService.CleanupOfflineDevicesAsync(days);
            if (result.Success)
            {
                return Ok(ApiResponse<object>.SuccessResponse(null, result.Message));
            }
            return BadRequest(ApiResponse<object>.ErrorResponse(result.ErrorCode, result.Message));
        }

        [HttpPost("cleanup-preview")]
        [Authorize(Roles = UserRoles.Admin)]
        public async Task<IActionResult> CleanupPreview([FromQuery] int days = 14)
        {
            var count = await _deviceService.GetOfflineCountAsync(days);
            return Ok(ApiResponse<int>.SuccessResponse(count, $"Found {count} devices offline for > {days} days."));
        }

        [HttpGet("{id}/schedule")]
        [AllowAnonymous]
        public async Task<IActionResult> GetDeviceSchedule(string id)
        {
            var schedule = await _deviceService.GetDeviceScheduleAsync(id);
            if (schedule == null) return NotFound(ApiResponse<PlaylistDto>.ErrorResponse(404, "No active schedule found"));
            return Ok(ApiResponse<PlaylistDto>.SuccessResponse(schedule));
        }

        // Contract item 6 / T8: puts a screen back into 'inherit' mode: its OWN assignments are removed
        // and it follows a sibling screen's assignments from now on (both in one transaction). Any
        // assignment or clear switches it back to 'explicit'.
        [HttpPost("{id}/schedule/inherit")]
        [Authorize(Roles = UserRoles.Admin)]
        public async Task<IActionResult> ResetScheduleToInherit(string id)
        {
            try
            {
                await _deviceService.ResetScheduleToInheritAsync(id);
            }
            catch (KeyNotFoundException)
            {
                return NotFound(ApiResponse<object>.ErrorResponse(404, "Device not found"));
            }
            await _deviceService.SendCommandAsync(id, "SYNC_SCHEDULE");
            return Ok(ApiResponse<object>.SuccessResponse(null, "Own assignments removed and schedule mode reset to inherit; sync command sent."));
        }

        [HttpGet("{id}/playlists")]
        [Authorize(Roles = UserRoles.Admin)]
        public async Task<IActionResult> GetAssignedPlaylists(string id)
        {
            var playlists = await _deviceService.GetAssignedPlaylistsAsync(id);
            return Ok(ApiResponse<IEnumerable<DevicePlaylistDto>>.SuccessResponse(playlists));
        }

        [HttpPost("{id}/playlists")]
        [Authorize(Roles = UserRoles.Admin)]
        public async Task<IActionResult> UpdateAssignedPlaylists(string id, [FromBody] List<DevicePlaylistDto> playlists)
        {
            await _deviceService.UpdateAssignedPlaylistsAsync(id, playlists);
            await _deviceService.SendCommandAsync(id, "SYNC_SCHEDULE");
            return Ok(ApiResponse<object>.SuccessResponse(null, "Playlists updated and sync command sent."));
        }

        [HttpPost("batch-add-playlist")]
        [Authorize(Roles = UserRoles.Admin)]
        public async Task<IActionResult> BatchAddPlaylistToSchedule([FromBody] BatchAddScheduleRequest request)
        {
            if (request.DeviceIds == null || request.DeviceIds.Count == 0)
            {
                return BadRequest(ApiResponse<object>.ErrorResponse(400, "No device IDs provided."));
            }

            try
            {
                var options = new ParallelOptions { MaxDegreeOfParallelism = 10 };
                await Parallel.ForEachAsync(request.DeviceIds, options, async (deviceId, ct) =>
                {
                    var current = await _deviceService.GetAssignedPlaylistsAsync(deviceId);
                    var updated = current.ToList();

                    // Remove existing mapping of the same playlist just in case
                    updated.RemoveAll(x => x.PlaylistId == request.PlaylistId);

                    updated.Add(new DevicePlaylistDto
                    {
                        DeviceId = deviceId,
                        PlaylistId = request.PlaylistId,
                        StartDate = request.StartDate,
                        EndDate = request.EndDate,
                        IsActive = true
                    });

                    await _deviceService.UpdateAssignedPlaylistsAsync(deviceId, updated);
                    await _deviceService.SendCommandAsync(deviceId, "SYNC_SCHEDULE");
                });

                return Ok(ApiResponse<object>.SuccessResponse(null, $"Added playlist to {request.DeviceIds.Count} devices."));
            }
            catch (Exception ex)
            {
                return StatusCode(500, ApiResponse<object>.ErrorResponse(500, $"Failed to batch assign schedule: {ex.Message}"));
            }
        }

        [HttpPost("batch-clear-schedule")]
        [Authorize(Roles = UserRoles.Admin)]
        public async Task<IActionResult> BatchClearSchedule([FromBody] BatchCommandRequest request)
        {
            if (request.DeviceIds == null || request.DeviceIds.Count == 0)
            {
                return BadRequest(ApiResponse<object>.ErrorResponse(400, "No device IDs provided."));
            }

            try
            {
                var options = new ParallelOptions { MaxDegreeOfParallelism = 10 };
                await Parallel.ForEachAsync(request.DeviceIds, options, async (deviceId, ct) =>
                {
                    if (request.PlaylistIds == null || request.PlaylistIds.Count == 0)
                    {
                        // Send empty list to clear all schedules. F18: this marks the screen 'explicit',
                        // so it plays nothing instead of inheriting a neighbour's content.
                        await _deviceService.UpdateAssignedPlaylistsAsync(deviceId, new List<DevicePlaylistDto>());
                    }
                    else
                    {
                        // Remove only selected playlists
                        var current = await _deviceService.GetAssignedPlaylistsAsync(deviceId);
                        var updated = current.Where(x => !request.PlaylistIds.Contains(x.PlaylistId)).ToList();
                        await _deviceService.UpdateAssignedPlaylistsAsync(deviceId, updated);
                    }
                    await _deviceService.SendCommandAsync(deviceId, "SYNC_SCHEDULE");
                });

                return Ok(ApiResponse<object>.SuccessResponse(null, $"Updated schedule for {request.DeviceIds.Count} devices."));
            }
            catch (Exception ex)
            {
                return StatusCode(500, ApiResponse<object>.ErrorResponse(500, $"Failed to batch clear schedule: {ex.Message}"));
            }
        }

        // Round 3 (#13 / R5): schema application mutates the database, and cookie authentication
        // treats GET as CSRF-safe, so the old GET could be triggered by any same-site page. It is a
        // POST now; the GET stays only to tell an old console what changed.
        [HttpGet("fix-devices-db")]
        [Authorize(Roles = UserRoles.Admin)]
        public IActionResult FixDbLegacyGet()
            => StatusCode(405, ApiResponse<object>.ErrorResponse(405, "use POST /api/v1/devices/fix-devices-db"));

        // Re-applies docs/db_template to the database: tables, then pending migrations (once each),
        // then any stored procedure whose file changed since it was last applied. See
        // Services/Database/SchemaApplier.cs for why unchanged procedures are left alone.
        [HttpPost("fix-devices-db")]
        [Authorize(Roles = UserRoles.Admin)]
        public async Task<IActionResult> FixDb()
        {
            var report = await _deviceService.FixDatabaseAsync();

            // Round 4 (#2): a retry while an apply is still running must not start a second one.
            if (report.InProgress)
                return StatusCode(409, ApiResponse<object>.ErrorResponse(409, "SCHEMA_APPLY_IN_PROGRESS: a schema apply is already running; wait for it to finish, then check the result"));

            if (report.Skipped != null)
                return StatusCode(500, ApiResponse<object>.ErrorResponse(500, $"Schema not applied: {report.Skipped}"));

            if (!report.Success)
                return StatusCode(500, ApiResponse<object>.ErrorResponse(500,
                    $"Applied {report.Applied.Count} file(s), {report.Migrations.Count} migration(s), {report.Failed.Count} FAILED: {string.Join(" ; ", report.Failed)}"));

            return Ok(ApiResponse<object>.SuccessResponse(
                new { applied = report.Applied, migrations = report.Migrations, unchanged = report.Unchanged, source = report.SourcePath },
                $"Schema applied: {report.Applied.Count} file(s) written, {report.Migrations.Count} migration(s), {report.Unchanged.Count} unchanged."));
        }
    }
}
