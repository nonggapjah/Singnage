using System;
using System.ComponentModel.DataAnnotations;

namespace SignageUnicorn.Api.Models
{
    public class User
    {
        public string? UserId { get; set; }
        public string? Username { get; set; }
        public string? IdentifierType { get; set; } // "email", "phone", "username"
        public string? PasswordHash { get; set; }
        public string? FullName { get; set; }
        public string? Role { get; set; }
        public string? Active { get; set; }
        public string? AvatarUrl { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        // F12: session revocation and lockout state (read from sn_auth_user).
        public int TokenVersion { get; set; } = 1;
        public int FailedLoginCount { get; set; }
        public DateTime? LockedUntil { get; set; }
    }

    public class LoginRequest
    {
        [Required]
        public string Username { get; set; } = string.Empty;
        [Required]
        public string Password { get; set; } = string.Empty;
    }

    public class RegisterRequest
    {
        [Required]
        public string Username { get; set; } = string.Empty;
        public string IdentifierType { get; set; } = "username";
        [Required]
        public string Password { get; set; } = string.Empty;
        [Required]
        public string FullName { get; set; } = string.Empty;
        public string Role { get; set; } = "viewer";
        public string? AvatarUrl { get; set; }
    }

    public class LoginResponse
    {
        public string Token { get; set; } = string.Empty;
        public string Username { get; set; } = string.Empty;
        public string FullName { get; set; } = string.Empty;
        public string Role { get; set; } = string.Empty;
        public string? AvatarUrl { get; set; }
        // Contract T12: "cookie" when the API also set the HttpOnly su_session cookie. The admin
        // console then stops keeping the token itself; kiosk/web-player paths keep using Token.
        public string? AuthMode { get; set; }
    }
}
