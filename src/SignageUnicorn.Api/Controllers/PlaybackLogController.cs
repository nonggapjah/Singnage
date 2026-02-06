using Microsoft.AspNetCore.Mvc;
using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Repositories.Interfaces;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using SignageUnicorn.Api.Constants;

namespace SignageUnicorn.Api.Controllers
{
    [ApiController]
    [Route("api/v1/logs/playback")]
    [Authorize]
    public class PlaybackLogController : ControllerBase
    {
        private readonly IPlaybackLogRepository _playbackRepo;

        public PlaybackLogController(IPlaybackLogRepository playbackRepo)
        {
            _playbackRepo = playbackRepo;
        }

        [AllowAnonymous]
        [HttpPost]
        public async Task<IActionResult> Create([FromBody] CreatePlaybackLogRequest request)
        {
            await _playbackRepo.LogPlaybackAsync(request);
            return Ok(new { success = true, message = "Playback log recorded" });
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
