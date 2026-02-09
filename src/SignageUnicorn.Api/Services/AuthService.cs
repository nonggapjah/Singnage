using Microsoft.IdentityModel.Tokens;
using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Repositories.Interfaces;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using BCrypt.Net;

namespace SignageUnicorn.Api.Services
{
    public class AuthService
    {
        private readonly IUserRepository _userRepository;
        private readonly ISystemLogRepository _systemLog;
        private readonly IConfiguration _configuration;

        public AuthService(IUserRepository userRepository, ISystemLogRepository systemLog, IConfiguration configuration)
        {
            _userRepository = userRepository;
            _systemLog = systemLog;
            _configuration = configuration;
        }

        public async Task<LoginResponse?> LoginAsync(LoginRequest request)
        {
            var user = await _userRepository.GetByUsernameAsync(request.Username);
            if (user == null || !BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
            {
                await _systemLog.LogAsync("WARNING", "AUTH", $"Failed login attempt for username: {request.Username}");
                return null;
            }

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

        public async Task<LoginResponse?> AutoAdminLoginAsync()
        {
            // 1. Try specific 'admin' user
            var user = await _userRepository.GetByUsernameAsync("admin");
            
            // 2. Fallback: Find ANY admin user (in case 'admin' doesn't exist but another admin does)
            if (user == null)
            {
                 var allUsers = await _userRepository.GetAllAsync();
                 user = allUsers.FirstOrDefault(u => u.Role?.ToLower() == "admin" && u.Active == "Y");
            }

            if (user == null) 
            {
                await _systemLog.LogAsync("WARNING", "AUTH", "Auto-Admin failed: No admin user found in database.");
                return null;
            }

            await _systemLog.LogAsync("INFO", "AUTH", $"Auto-Admin login detected.");

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
            var jwtSettings = _configuration.GetSection("JwtSettings");
            var key = Encoding.ASCII.GetBytes(jwtSettings["Secret"] ?? "DEFAULT_SECRET_KEY_FOR_DEVELOPMENT_ONLY");

            var tokenDescriptor = new SecurityTokenDescriptor
            {
                Subject = new ClaimsIdentity(new[]
                {
                    new Claim(ClaimTypes.NameIdentifier, user.UserId ?? "0"),
                    new Claim(ClaimTypes.Name, user.Username ?? "Unknown"),
                    new Claim(ClaimTypes.Role, user.Role ?? "viewer")
                }),
                Expires = DateTime.UtcNow.AddMinutes(double.Parse(jwtSettings["ExpiryMinutes"] ?? "1440")),
                SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(key), SecurityAlgorithms.HmacSha256Signature),
                Issuer = jwtSettings["Issuer"],
                Audience = jwtSettings["Audience"]
            };

            var tokenHandler = new JwtSecurityTokenHandler();
            var token = tokenHandler.CreateToken(tokenDescriptor);
            return tokenHandler.WriteToken(token);
        }
    }
}
