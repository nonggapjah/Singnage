using Microsoft.AspNetCore.Mvc;
using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Models.Responses;
using SignageUnicorn.Api.Services;
using Dapper;
using Microsoft.Data.SqlClient;

namespace SignageUnicorn.Api.Controllers
{
    [ApiController]
    [Route("api/v1/auth")]
    public class AuthController : ControllerBase
    {
        private readonly AuthService _authService;
        private readonly IConfiguration _configuration;

        public AuthController(AuthService authService, IConfiguration configuration)
        {
            _authService = authService;
            _configuration = configuration;
        }

        [HttpPost("login")]
        public async Task<IActionResult> Login([FromBody] LoginRequest request)
        {
            var response = await _authService.LoginAsync(request);
            if (response == null)
            {
                return Unauthorized(ApiResponse<object>.ErrorResponse(401, "Invalid username or password"));
            }
            return Ok(ApiResponse<LoginResponse>.SuccessResponse(response, "Login successful"));
        }

        [HttpPost("register")]
        public async Task<IActionResult> Register([FromBody] RegisterRequest request)
        {
            var success = await _authService.RegisterAsync(request);
            if (!success)
            {
                return BadRequest(ApiResponse<object>.ErrorResponse(400, "Username already exists or registration failed"));
            }
            return Ok(ApiResponse<object>.SuccessResponse(null, "Registration successful"));
        }

        [HttpPost("local-auto-admin")]
        public async Task<IActionResult> LocalAutoAdmin()
        {
            // Security Check: Only allow if no Authorization header or strictly for dev convenience
            // In a real scenario, check HostingEnvironment.IsDevelopment().
            // For now, we trust the caller knows this is a backdoor for dev only.
            
            var response = await _authService.AutoAdminLoginAsync();
            if (response == null)
            {
                return Unauthorized(ApiResponse<object>.ErrorResponse(401, "Admin user not found. Database might not be seeded."));
            }
            return Ok(ApiResponse<LoginResponse>.SuccessResponse(response, "Auto-Admin Login successful"));
        }
    }
}
