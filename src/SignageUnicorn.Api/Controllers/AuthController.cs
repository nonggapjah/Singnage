using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Models.Responses;
using SignageUnicorn.Api.Services;

namespace SignageUnicorn.Api.Controllers
{
    [ApiController]
    [Route("api/v1/auth")]
    public class AuthController : ControllerBase
    {
        private readonly AuthService _authService;
        private readonly JwtOptions _jwt;

        public AuthController(AuthService authService, JwtOptions jwt)
        {
            _authService = authService;
            _jwt = jwt;
        }

        // Contract T12: Secure only when the request really is https (directly, or as the proxy says).
        private bool IsHttpsRequest()
        {
            if (Request.IsHttps) return true;
            var proto = Request.Headers["X-Forwarded-Proto"].ToString();
            return string.Equals(proto, "https", StringComparison.OrdinalIgnoreCase);
        }

        private CookieOptions SessionCookieOptions(bool expire) => new()
        {
            HttpOnly = true,
            SameSite = SameSiteMode.Strict,
            Path = "/",
            Secure = IsHttpsRequest(),
            IsEssential = true,
            MaxAge = expire ? TimeSpan.Zero : TimeSpan.FromMinutes(_jwt.ExpiryMinutes),
            Expires = expire ? DateTimeOffset.UnixEpoch : null
        };

        // Per-IP rate limit: password guessing was otherwise unlimited (see Program.cs).
        [Microsoft.AspNetCore.RateLimiting.EnableRateLimiting("login")]
        [HttpPost("login")]
        public async Task<IActionResult> Login([FromBody] LoginRequest request)
        {
            var response = await _authService.LoginAsync(request);
            if (response == null)
            {
                return Unauthorized(ApiResponse<object>.ErrorResponse(401, "Invalid username or password"));
            }

            // Contract T12: the same JWT also travels as an HttpOnly cookie so the admin console no
            // longer has to keep it in localStorage. The body still carries "token" for the kiosk/web
            // player paths and any script that uses the Authorization header.
            Response.Cookies.Append(SessionCookie.Name, response.Token, SessionCookieOptions(expire: false));
            response.AuthMode = "cookie";
            return Ok(ApiResponse<LoginResponse>.SuccessResponse(response, "Login successful"));
        }

        // Contract T12: clears the session cookie. The JWT itself stays valid until expiry (or until
        // the account's token_version is bumped), so clients should also drop their copy.
        [Authorize]
        [HttpPost("logout")]
        public IActionResult Logout()
        {
            Response.Cookies.Append(SessionCookie.Name, string.Empty, SessionCookieOptions(expire: true));
            return Ok(ApiResponse<object>.SuccessResponse(null, "Logged out"));
        }

        [HttpPost("register")]
        public async Task<IActionResult> Register([FromBody] RegisterRequest request)
        {
            // Self-registration never grants privileges: the role is forced to viewer regardless of the
            // body. Admins and editors are created by an admin through /api/v1/users.
            request.Role = Constants.UserRoles.Viewer;

            var success = await _authService.RegisterAsync(request);
            if (!success)
            {
                return BadRequest(ApiResponse<object>.ErrorResponse(400, "Username already exists or registration failed"));
            }
            return Ok(ApiResponse<object>.SuccessResponse(null, "Registration successful"));
        }

        // F01: POST api/v1/auth/local-auto-admin was removed. It returned an administrator JWT to any
        // caller with no credentials and no environment check -- a full authentication bypass on a
        // publicly reachable API. Deliberately not replaced by a development-only variant: the admin
        // console's "auto-admin" button was removed with it.
    }
}
