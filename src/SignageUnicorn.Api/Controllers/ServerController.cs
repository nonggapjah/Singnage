using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using SignageUnicorn.Api.Models.Responses;
using SignageUnicorn.Api.Services; // Add this using
using System.Threading.Tasks;

namespace SignageUnicorn.Api.Controllers
{
    using Microsoft.AspNetCore.Authorization;
    using SignageUnicorn.Api.Constants;

    [ApiController]
    [Route("api/v1/server")]
    [Authorize(Roles = UserRoles.Admin)]
    public class ServerController : ControllerBase
    {
        private readonly ServerService _serverService;

        public ServerController(ServerService serverService)
        {
            _serverService = serverService;
        }

        [HttpGet("config")]
        public IActionResult GetConfig()
        {
            var config = _serverService.GetConfig();
            return Ok(ApiResponse<object>.SuccessResponse(config));
        }

        [HttpPost("config")]
        public async Task<IActionResult> UpdateConfig([FromBody] ServerConfigUpdateDto request)
        {
            var success = await _serverService.UpdateConfigAsync(request.IpAddress, request.Port, request.FrontendPort);
            
            if (success)
            {
                return Ok(ApiResponse<object>.SuccessResponse(new { success = true, message = "Server IP Updated and SQL Media Paths fixed. Please restart the backend service manually." }));
            }
            else
            {
                return StatusCode(500, ApiResponse<bool>.ErrorResponse(500, "Failed to update configuration. Check logs."));
            }
        }

        [HttpPost("sync-media")]
        public async Task<IActionResult> SyncMediaPaths()
        {
            var success = await _serverService.SyncMediaPathsAsync();
            if (success)
            {
                return Ok(ApiResponse<bool>.SuccessResponse(true, "Media paths synchronized successfully."));
            }
            else
            {
                return StatusCode(500, ApiResponse<bool>.ErrorResponse(500, "Sync failed. Check logs."));
            }
        }
    }

    public class ServerConfigUpdateDto
    {
        public string IpAddress { get; set; }
        public int Port { get; set; }
        public int FrontendPort { get; set; }
    }
}
