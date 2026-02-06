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
    }
}
