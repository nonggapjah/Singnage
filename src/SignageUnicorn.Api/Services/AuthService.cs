using Microsoft.IdentityModel.Tokens;
using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Repositories.Interfaces;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using BCrypt.Net;

namespace SignageUnicorn.Api.Services
{
    public class AuthService
    {
        // F12: the JWT claim that carries the user's token_version at issue time.
        public const string TokenVersionClaim = "tv";

        private readonly IUserRepository _userRepository;
        private readonly ISystemLogRepository _systemLog;
        private readonly JwtOptions _jwt;

        public AuthService(IUserRepository userRepository, ISystemLogRepository systemLog, JwtOptions jwt)
        {
            _userRepository = userRepository;
            _systemLog = systemLog;
            _jwt = jwt;
        }

        public async Task<LoginResponse?> LoginAsync(LoginRequest request)
        {
            var user = await _userRepository.GetByUsernameAsync(request.Username);

            // F12: an inactive (deactivated) account or a locked one is refused BEFORE the password
            // is checked, and with the same message as a wrong password so nothing leaks.
            if (user != null && user.Active != "Y")
            {
                await _systemLog.LogAsync("WARNING", "AUTH", $"Login refused for inactive account: {request.Username}");
                return null;
            }
            if (user != null && user.LockedUntil.HasValue && user.LockedUntil.Value > DateTime.UtcNow)
            {
                await _systemLog.LogAsync("WARNING", "AUTH", $"Login refused for locked account: {request.Username} (until {user.LockedUntil:O})");
                return null;
            }

            bool isVerified = false;
            if (user != null && !string.IsNullOrEmpty(user.PasswordHash))
            {
                try
                {
                    isVerified = BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash);
                }
                catch (Exception)
                {
                    isVerified = false;
                }
            }

            if (user == null || !isVerified)
            {
                await _systemLog.LogAsync("WARNING", "AUTH", $"Failed login attempt for username: {request.Username}");
                if (user?.UserId != null) await RecordOutcomeSafe(user.UserId, success: false);
                return null;
            }

            if (user.UserId != null) await RecordOutcomeSafe(user.UserId, success: true);
            await _systemLog.LogAsync("INFO", "AUTH", $"User '{user.Username}' ({user.FullName}) logged in.");

            var token = GenerateJwtToken(user);
            return new LoginResponse
            {
                Token = token,
                Username = user.Username ?? "",
                FullName = user.FullName ?? "",
                Role = user.Role ?? "viewer",
                AvatarUrl = user.AvatarUrl
            };
        }

        // The lockout counters live in the database (LOGIN_SUCCESS / LOGIN_FAIL). A failure to record
        // the outcome is logged and ignored: it must never turn a correct password into a refusal, and
        // the per-IP rate limiter still bounds guessing if the counters are unavailable.
        private async Task RecordOutcomeSafe(string userId, bool success)
        {
            try
            {
                await _userRepository.RecordLoginOutcomeAsync(userId, success);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[WARN] Could not record login outcome for user {userId}: {ex.Message}");
            }
        }

        // F01: the anonymous "local auto admin" login that minted an administrator token for whoever
        // reached the endpoint has been removed. Nothing replaces it: use a real account.

        public async Task<bool> RegisterAsync(RegisterRequest request, string? executorId = null)
        {
            var existing = await _userRepository.GetByUsernameAsync(request.Username);
            if (existing != null)
            {
                await _systemLog.LogAsync("WARNING", "AUTH", $"Registration failed: Username '{request.Username}' already exists.");
                return false;
            }

            var user = new User
            {
                Username = request.Username,
                IdentifierType = request.IdentifierType,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
                FullName = request.FullName,
                Role = request.Role,
                Active = "Y",
                AvatarUrl = request.AvatarUrl
            };

            var result = await _userRepository.CreateAsync(user, executorId);
            if (result.Success)
            {
                 await _systemLog.LogAsync("INFO", "AUTH", $"New user registered: '{request.Username}' ({request.Role})");
                 return true;
            }

            await _systemLog.LogAsync("ERROR", "AUTH", $"REGISTRATION_FAILED | Code: {result.ErrorCode} | Msg: {result.Message}");
            return false;
        }

        private string GenerateJwtToken(User user)
        {
            // F11: same key object the bearer validator uses -- no second read of configuration, no
            // fallback literal.
            var tokenDescriptor = new SecurityTokenDescriptor
            {
                Subject = new ClaimsIdentity(new[]
                {
                    new Claim(ClaimTypes.NameIdentifier, user.UserId ?? "0"),
                    new Claim(ClaimTypes.Name, user.Username ?? "Unknown"),
                    new Claim(ClaimTypes.Role, user.Role ?? "viewer"),
                    new Claim(TokenVersionClaim, user.TokenVersion.ToString())
                }),
                Expires = DateTime.UtcNow.AddMinutes(_jwt.ExpiryMinutes),
                SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(_jwt.KeyBytes), SecurityAlgorithms.HmacSha256Signature),
                Issuer = _jwt.Issuer,
                Audience = _jwt.Audience
            };

            var tokenHandler = new JwtSecurityTokenHandler();
            var token = tokenHandler.CreateToken(tokenDescriptor);
            return tokenHandler.WriteToken(token);
        }
    }
}
