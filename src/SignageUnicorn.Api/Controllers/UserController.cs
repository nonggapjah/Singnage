using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Models.Responses;
using SignageUnicorn.Api.Repositories.Interfaces;
using SignageUnicorn.Api.Services;
using SignageUnicorn.Api.Constants;
using System.Security.Claims;

namespace SignageUnicorn.Api.Controllers
{
    [ApiController]
    [Route("api/v1/users")]
    [Authorize] // Require authentication/token
    public class UserController : ControllerBase
    {
        private readonly IUserRepository _userRepository;
        private readonly AuthService _authService;

        public UserController(IUserRepository userRepository, AuthService authService)
        {
            _userRepository = userRepository;
            _authService = authService;
        }

        [HttpGet]
        [Authorize(Roles = UserRoles.Admin + "," + UserRoles.Editor)]
        public async Task<IActionResult> GetAll()
        {
            var users = await _userRepository.GetAllAsync();
            // Map to simpler DTO to avoid sending PasswordHashes
            var data = users.Select(u => new {
                u.UserId,
                u.Username,
                u.FullName,
                u.Role,
                u.Active,
                u.AvatarUrl
            });
            return Ok(ApiResponse<object>.SuccessResponse(data));
        }

        [HttpPost]
        [Authorize(Roles = UserRoles.Admin + "," + UserRoles.Editor)]
        public async Task<IActionResult> Create([FromBody] RegisterRequest request)
        {
            // Safeguard: Editor cannot create Admin
            if (request.Role == UserRoles.Admin && !User.IsInRole(UserRoles.Admin))
            {
                return StatusCode(403, ApiResponse<bool>.ErrorResponse(403, "Editors cannot create Admin users."));
            }
            var success = await _authService.RegisterAsync(request);
            if (success)
            {
                return Ok(ApiResponse<bool>.SuccessResponse(true, "User created successfully"));
            }
            return BadRequest(ApiResponse<bool>.ErrorResponse(400, "Username already exists or creation failed"));
        }

        [HttpPut("{id}")]
        [Authorize(Roles = UserRoles.Admin + "," + UserRoles.Editor)]
        public async Task<IActionResult> Update(string id, [FromBody] User user)
        {
            // Safeguard: Verify target user first
            var target = await _userRepository.GetByIdAsync(id);
            if (target != null)
            {
                // Editor cannot edit Admin
                if (target.Role == UserRoles.Admin && !User.IsInRole(UserRoles.Admin))
                    return StatusCode(403, ApiResponse<bool>.ErrorResponse(403, "Editors cannot edit Admin users."));
            }

            // Safeguard: Editor cannot promote to Admin
            if (user.Role == UserRoles.Admin && !User.IsInRole(UserRoles.Admin))
                 return StatusCode(403, ApiResponse<bool>.ErrorResponse(403, "Editors cannot set Admin role."));
            user.UserId = id;
            var result = await _userRepository.UpdateAsync(user);
            if (result.Success)
            {
                return Ok(ApiResponse<bool>.SuccessResponse(true, "User updated successfully"));
            }
            return NotFound(ApiResponse<bool>.ErrorResponse(404, "User not found"));
        }

        [HttpDelete("{id}")]
        [Authorize(Roles = UserRoles.Admin + "," + UserRoles.Editor)]
        public async Task<IActionResult> Delete(string id)
        {
            var target = await _userRepository.GetByIdAsync(id);
            if (target != null)
            {
                // Editor cannot delete Admin
                if (target.Role == UserRoles.Admin && !User.IsInRole(UserRoles.Admin))
                    return StatusCode(403, ApiResponse<bool>.ErrorResponse(403, "Editors cannot delete Admin users."));
            }
            var result = await _userRepository.DeleteAsync(id);
            if (result.Success)
            {
                return Ok(ApiResponse<bool>.SuccessResponse(true, "User deactivated successfully"));
            }
            return NotFound(ApiResponse<bool>.ErrorResponse(404, "User not found"));
        }

        [HttpPost("change-password")]
        public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordRequest request)
        {
            // Usually we get UserId from token
            var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userId)) return Unauthorized();

            var userProfile = await _userRepository.GetByIdAsync(userId);
            if (userProfile == null) return NotFound();

            // Fetch credentials using the username we just found
            // This is necessary because GetByIdAsync does not return PasswordHash for security
            var user = await _userRepository.GetByUsernameAsync(userProfile.Username);
            if (user == null) return NotFound();

            // Verify old password
            if (!BCrypt.Net.BCrypt.Verify(request.OldPassword, user.PasswordHash))
            {
                return BadRequest(ApiResponse<bool>.ErrorResponse(400, "Invalid old password"));
            }

            // Update with new password
            var newHash = BCrypt.Net.BCrypt.HashPassword(request.NewPassword);
            var result = await _userRepository.UpdatePasswordAsync(userId, newHash);
            
            if (result.Success)
            {
                return Ok(ApiResponse<bool>.SuccessResponse(true, "Password changed successfully"));
            }
            return BadRequest(ApiResponse<bool>.ErrorResponse(500, "Failed to update password"));
        }
    }

    public class ChangePasswordRequest
    {
        public string OldPassword { get; set; } = string.Empty;
        public string NewPassword { get; set; } = string.Empty;
    }
}
