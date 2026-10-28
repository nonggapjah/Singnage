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

        private string? CurrentUserId => User.FindFirst(ClaimTypes.NameIdentifier)?.Value;

        // F02: the role check used to compare the raw string against "admin" while the repository
        // lower-cased it before storing. "Admin" or "ADMIN" sailed past the editor guard and was
        // stored as admin. Every role now goes through this one canonical form BEFORE any
        // authorization decision, and anything outside the known set is rejected outright.
        private static string? CanonicalRole(string? role) => UserRoles.Canonical(role);

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
            var role = CanonicalRole(string.IsNullOrWhiteSpace(request.Role) ? UserRoles.Viewer : request.Role);
            if (role == null)
                return BadRequest(ApiResponse<bool>.ErrorResponse(400, "Role must be one of admin, editor, viewer."));
            request.Role = role;

            // Safeguard: Editor cannot create Admin
            if (role == UserRoles.Admin && !User.IsInRole(UserRoles.Admin))
            {
                return StatusCode(403, ApiResponse<bool>.ErrorResponse(403, "Editors cannot create Admin users."));
            }
            var executorId = CurrentUserId;
            var success = await _authService.RegisterAsync(request, executorId);
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
            if (target == null)
                return NotFound(ApiResponse<bool>.ErrorResponse(404, "User not found"));

            // Editor cannot edit Admin
            if (target.Role == UserRoles.Admin && !User.IsInRole(UserRoles.Admin))
                return StatusCode(403, ApiResponse<bool>.ErrorResponse(403, "Editors cannot edit Admin users."));

            string? role = null;
            if (!string.IsNullOrWhiteSpace(user.Role))
            {
                role = CanonicalRole(user.Role);
                if (role == null)
                    return BadRequest(ApiResponse<bool>.ErrorResponse(400, "Role must be one of admin, editor, viewer."));

                // Safeguard: Editor cannot promote to Admin
                if (role == UserRoles.Admin && !User.IsInRole(UserRoles.Admin))
                    return StatusCode(403, ApiResponse<bool>.ErrorResponse(403, "Editors cannot set Admin role."));

                // Nobody edits their own role through this endpoint: an editor could otherwise grant
                // themselves whatever the previous checks let through, and an admin demoting
                // themselves by accident locks the console.
                bool isSelf = !string.IsNullOrEmpty(CurrentUserId) && CurrentUserId == id;
                if (isSelf && !string.Equals(role, target.Role, StringComparison.OrdinalIgnoreCase))
                    return StatusCode(403, ApiResponse<bool>.ErrorResponse(403, "You cannot change your own role."));

                // Round 4 (#11): the same role is not a role change; do not send it to UPDATE_ROLE.
                role = UserRoles.ChangeOrNull(target.Role, role);
            }
            user.Role = role; // canonical or null (= unchanged)
            user.UserId = id;
            var result = await _userRepository.UpdateAsync(user, CurrentUserId);
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
            if (!string.IsNullOrEmpty(CurrentUserId) && CurrentUserId == id)
                return StatusCode(403, ApiResponse<bool>.ErrorResponse(403, "You cannot deactivate your own account."));

            // F12: this is a real deactivation now (status inactive + all sessions revoked).
            var result = await _userRepository.DeleteAsync(id, CurrentUserId);
            if (result.Success)
            {
                return Ok(ApiResponse<bool>.SuccessResponse(true, "User deactivated successfully"));
            }
            return NotFound(ApiResponse<bool>.ErrorResponse(404, result.Message ?? "User not found"));
        }

        [HttpPost("change-password")]
        public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordRequest request)
        {
            // Usually we get UserId from token
            var userId = CurrentUserId;
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

            if (string.IsNullOrWhiteSpace(request.NewPassword) || request.NewPassword.Length < 8)
            {
                return BadRequest(ApiResponse<bool>.ErrorResponse(400, "New password must be at least 8 characters."));
            }

            // Update with new password (the procedure bumps token_version, so other sessions end)
            var newHash = BCrypt.Net.BCrypt.HashPassword(request.NewPassword);
            var result = await _userRepository.UpdatePasswordAsync(userId, newHash, userId);

            if (result.Success)
            {
                return Ok(ApiResponse<bool>.SuccessResponse(true, "Password changed successfully. Sign in again on other devices."));
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
