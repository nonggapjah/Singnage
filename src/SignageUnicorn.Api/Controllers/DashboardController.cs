using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Models.Responses;
using SignageUnicorn.Api.Repositories.Interfaces;
using System.Reflection;

namespace SignageUnicorn.Api.Controllers
{
    [ApiController]
    [Route("api/v1/dashboard")]
    [Authorize]
    public class DashboardController : ControllerBase
    {
        private readonly IDeviceRepository _deviceRepo;
        private readonly IMediaRepository _mediaRepo;
        private readonly IPlaylistRepository _playlistRepo;
        private readonly ISystemLogRepository _systemLogRepo;
        private readonly IPlaybackLogRepository _playbackLogRepo;

        public DashboardController(
            IDeviceRepository deviceRepo,
            IMediaRepository mediaRepo,
            IPlaylistRepository playlistRepo,
            ISystemLogRepository systemLogRepo,
            IPlaybackLogRepository playbackLogRepo)
        {
            _deviceRepo = deviceRepo;
            _mediaRepo = mediaRepo;
            _playlistRepo = playlistRepo;
            _systemLogRepo = systemLogRepo;
            _playbackLogRepo = playbackLogRepo;
        }

        private static string ResolveVersion() => SignageUnicorn.Api.Services.ApiVersion.Current;

        [HttpGet("stats")]
        public async Task<IActionResult> GetStats()
        {
            try
            {
                var devices = await _deviceRepo.GetAllDevicesAsync();
                var media = await _mediaRepo.GetAllAsync();
                var playlists = await _playlistRepo.GetAllPlaylistsAsync();

                // All stored times are UTC; filter with UTC (the old code passed DateTime.Now).
                var nowUtc = DateTime.UtcNow;
                var latestPlaybackSummary = await _playbackLogRepo.GetSummaryAsync(nowUtc.AddDays(-7), nowUtc);

                var logEntries = await _systemLogRepo.GetLatestLogsAsync(20);

                // Filter INFO and map/extract DeviceId if needed
                var filteredLogs = logEntries
                    .Where(l => (l.LogType ?? "INFO").ToUpper() != "INFO")
                    .Select(l =>
                    {
                        if (string.IsNullOrEmpty(l.DeviceId) && !string.IsNullOrEmpty(l.Message) && l.Message.StartsWith("[Device: "))
                        {
                            var endIdx = l.Message.IndexOf(']');
                            if (endIdx > 9)
                            {
                                l.DeviceId = l.Message.Substring(9, endIdx - 9);
                            }
                        }
                        return l;
                    })
                    .Take(10)
                    .ToList();

                var onlineDevices = devices.Where(d => d.Status == "ONLINE" || d.Status == "PLAYING" || d.Status == "IDLE");

                // F40: AverageLatencyMs used to be derived from check-in age with a made-up formula and
                // DynamicTxSpeedMbps included a random component. Both read as measurements on the
                // console and were not. The properties are kept (the web type expects them) but carry
                // 0 until something actually measures latency/throughput; the console hides them.
                var stats = new DashboardStatsDto
                {
                    TotalDevices = devices.Count(),
                    OnlineDevices = onlineDevices.Count(),
                    OfflineDevices = devices.Count() - onlineDevices.Count(),
                    TotalMedia = media.Count(),
                    TotalPlaylists = playlists.Count(),
                    AverageLatencyMs = 0,
                    DynamicTxSpeedMbps = 0,
                    SystemVersion = ResolveVersion(),
                    TopMedia = latestPlaybackSummary.OrderByDescending(s => s.PlayCount).Take(5),
                    RecentAlerts = filteredLogs
                };

                return Ok(ApiResponse<DashboardStatsDto>.SuccessResponse(stats));
            }
            catch (Exception ex)
            {
                return StatusCode(500, ApiResponse<object>.ErrorResponse(500, $"Dashboard error: {ex.Message}"));
            }
        }
    }
}
