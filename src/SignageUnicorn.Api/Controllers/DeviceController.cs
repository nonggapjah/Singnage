using Microsoft.AspNetCore.Mvc;
using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Models.Responses;
using SignageUnicorn.Api.Services;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using SignageUnicorn.Api.Constants;
using SignageUnicorn.Api.Models.Domain;

namespace SignageUnicorn.Api.Controllers
{
    [ApiController]
    [Route("api/v1/devices")]
    [Authorize]
    public class DeviceController : ControllerBase
    {
        private readonly DeviceService _deviceService;

        public DeviceController(DeviceService deviceService)
        {
            _deviceService = deviceService; // Assuming registered in Program.cs
        }

        [HttpPost("register")]
        [AllowAnonymous]
        public async Task<IActionResult> Register([FromBody] DeviceRegisterRequest request)
        {
            // Auto-detect IP
            var remoteIp = HttpContext.Connection.RemoteIpAddress?.ToString();
            if (!string.IsNullOrEmpty(remoteIp) && remoteIp != "::1")
            {
               request.IpAddress = remoteIp;
            }

            var device = await _deviceService.RegisterDeviceAsync(request);
            return Ok(ApiResponse<DeviceDto>.SuccessResponse(device));
        }

        [HttpPost("heartbeat")]
        [AllowAnonymous]
        public async Task<IActionResult> Heartbeat([FromBody] HeartbeatRequest request)
        {
            // Auto-detect IP from request (same as Register)
            var remoteIp = HttpContext.Connection.RemoteIpAddress?.ToString();
            if (!string.IsNullOrEmpty(remoteIp) && remoteIp != "::1")
            {
                request.IpAddress = remoteIp;
            }

            var commands = await _deviceService.ProcessHeartbeatAsync(request);
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

        [HttpPost("{id}/assign-playlist")]
        [AllowAnonymous]
        public async Task<IActionResult> AssignPlaylist(string id, [FromBody] dynamic payload)
        {
            string playlistId = payload.GetProperty("playlistId").GetString();
            // Directly queue the command as if sent by admin
            await _deviceService.SendCommandAsync(id, "PLAY_PLAYLIST:" + playlistId);
            return Ok(ApiResponse<object>.SuccessResponse(null, "Playlist assigned successfully"));
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
            // Extract User ID for auditing
            long? userId = null;
            // Assuming "id" claim or NameIdentifier holds the numeric ID; adjust based on your Auth setup
            var userIdClaim = User.Claims.FirstOrDefault(c => c.Type == "id" || c.Type == System.Security.Claims.ClaimTypes.NameIdentifier);
            if (userIdClaim != null && long.TryParse(userIdClaim.Value, out var uid))
            {
                userId = uid;
            }

            var result = await _deviceService.DeactivateDeviceAsync(id, userId);
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
            foreach (var deviceId in request.DeviceIds)
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
            }

            return Ok(ApiResponse<object>.SuccessResponse(null, $"Added playlist to {request.DeviceIds.Count} devices."));
        }

        [HttpPost("batch-clear-schedule")]
        [Authorize(Roles = UserRoles.Admin)]
        public async Task<IActionResult> BatchClearSchedule([FromBody] BatchCommandRequest request)
        {
            foreach (var deviceId in request.DeviceIds)
            {
                if (request.PlaylistIds == null || request.PlaylistIds.Count == 0)
                {
                    // Send empty list to clear all schedules
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
            }
            return Ok(ApiResponse<object>.SuccessResponse(null, $"Updated schedule for {request.DeviceIds.Count} devices."));
        }

        [HttpGet("fix-devices-db")]
        [Authorize(Roles = UserRoles.Admin)]
        public async Task<IActionResult> FixDb()
        {
            await _deviceService.FixDatabaseAsync();
            return Ok(new { success = true, message = "Devices DB Schema Updated" });
        }
    }
}
