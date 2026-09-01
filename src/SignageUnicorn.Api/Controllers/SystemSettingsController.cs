using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using SignageUnicorn.Api.Constants;
using SignageUnicorn.Api.Models.Responses;
using SignageUnicorn.Api.Repositories.Interfaces;
using System.IO;
using System.Threading.Tasks;

namespace SignageUnicorn.Api.Controllers
{
    [ApiController]
    [Route("api/v1/system/settings")]
    [Authorize(Roles = UserRoles.Admin)]
    public class SystemSettingsController : ControllerBase
    {
        private readonly ISystemSettingsRepository _repository;
        private readonly IWebHostEnvironment _env;

        public SystemSettingsController(ISystemSettingsRepository repository, IWebHostEnvironment env)
        {
            _repository = repository;
            _env = env;
        }

        [HttpGet("{key}")]
        [AllowAnonymous]
        public async Task<IActionResult> Get(string key)
        {
            var value = await _repository.GetSettingAsync(key);
            return Ok(ApiResponse<string>.SuccessResponse(value));
        }

        [HttpGet("setup/download")]
        [AllowAnonymous]
        public async Task<IActionResult> DownloadSetup()
        {
            var path = Path.Combine(_env.ContentRootPath, "wwwroot", "setup", "Signage_Unicorn_Setup_latest.exe");
            if (!System.IO.File.Exists(path)) return NotFound(ApiResponse<string>.ErrorResponse(404, "Setup file not found"));

            // The download name used to be hard-coded to 2.5.9 while the file behind it kept being
            // replaced -- by 01-09-2026 it was handing out 2.7.4 under the 2.5.9 name. Take the
            // version from the same setting the players read, so the name cannot drift again.
            var version = await _repository.GetSettingAsync("LatestClientVersion");
            var downloadName = string.IsNullOrWhiteSpace(version)
                ? "Signage_Unicorn_Setup.exe"
                : $"Signage_Unicorn_Setup_{version}.exe";

            // Streamed, not ReadAllBytesAsync: the installer is ~70 MB and buffering a copy per
            // request put that much on the heap for every screen downloading at once. Range
            // processing also lets an interrupted download resume instead of restarting.
            return PhysicalFile(path, "application/vnd.microsoft.portable-executable", downloadName, enableRangeProcessing: true);
        }

        [HttpPost]
        public async Task<IActionResult> Set([FromBody] SettingRequest request)
        {
            if (string.IsNullOrEmpty(request.Key)) return BadRequest(ApiResponse<bool>.ErrorResponse(400, "Key is required"));
            
            await _repository.SetSettingAsync(request.Key, request.Value);
            return Ok(ApiResponse<bool>.SuccessResponse(true, "Setting saved"));
        }
    }

    public class SettingRequest
    {
        public string Key { get; set; }
        public string Value { get; set; }
    }
}
