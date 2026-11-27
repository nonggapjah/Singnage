using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SignageUnicorn.Api.Constants;
using SignageUnicorn.Api.Models.Responses;
using SignageUnicorn.Api.Services.Rollout;

namespace SignageUnicorn.Api.Controllers
{
    /// <summary>
    /// Branch-by-branch playlist rollouts (API 2.8.14). A rollout is started through
    /// POST /devices/batch-add-playlist with a `rollout` block; this controller lists and steers them.
    /// </summary>
    [ApiController]
    [Route("api/v1/rollouts")]
    [Authorize]
    public class RolloutController : ControllerBase
    {
        private readonly RolloutService _rollouts;
        public RolloutController(RolloutService rollouts) => _rollouts = rollouts;

        /// <summary>Active and paused rollouts, plus those finished or cancelled in the last 24 hours.</summary>
        [HttpGet]
        public async Task<IActionResult> List([FromQuery] string? playlistId = null)
        {
            var list = await _rollouts.ListAsync(playlistId, DateTime.UtcNow);
            return Ok(ApiResponse<object>.SuccessResponse(list));
        }

        [HttpPost("{id:long}/pause")]
        [Authorize(Roles = UserRoles.Admin)]
        public async Task<IActionResult> Pause(long id)
            => await _rollouts.PauseAsync(id)
                ? Ok(ApiResponse<object>.SuccessResponse(null, "Rollout paused. Screens already assigned keep the playlist; the remaining branches wait."))
                : NotFound(ApiResponse<object>.ErrorResponse(404, "No active rollout with that id."));

        [HttpPost("{id:long}/resume")]
        [Authorize(Roles = UserRoles.Admin)]
        public async Task<IActionResult> Resume(long id)
            => await _rollouts.ResumeAsync(id, DateTime.UtcNow)
                ? Ok(ApiResponse<object>.SuccessResponse(null, "Rollout resumed. The next branch is released now, the rest follow at the usual interval."))
                : NotFound(ApiResponse<object>.ErrorResponse(404, "No paused rollout with that id."));

        [HttpPost("{id:long}/cancel")]
        [Authorize(Roles = UserRoles.Admin)]
        public async Task<IActionResult> Cancel(long id)
            => await _rollouts.CancelAsync(id)
                ? Ok(ApiResponse<object>.SuccessResponse(null, "Rollout cancelled. Branches already released keep the playlist; the rest were not assigned."))
                : NotFound(ApiResponse<object>.ErrorResponse(404, "No active or paused rollout with that id."));
    }
}
