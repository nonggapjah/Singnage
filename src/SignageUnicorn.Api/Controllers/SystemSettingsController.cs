using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SignageUnicorn.Api.Constants;
using SignageUnicorn.Api.Models.Responses;
using SignageUnicorn.Api.Repositories.Interfaces;
using System.Threading.Tasks;

namespace SignageUnicorn.Api.Controllers
{
    [ApiController]
    [Route("api/v1/system/settings")]
    [Authorize(Roles = UserRoles.Admin)]
    public class SystemSettingsController : ControllerBase
    {
        private readonly ISystemSettingsRepository _repository;

        public SystemSettingsController(ISystemSettingsRepository repository)
        {
            _repository = repository;
        }

        [HttpGet("{key}")]
        [AllowAnonymous]
        public async Task<IActionResult> Get(string key)
        {
            var value = await _repository.GetSettingAsync(key);
            return Ok(ApiResponse<string>.SuccessResponse(value));
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
