using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using System.Text;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.OpenApi.Models;
using SignageUnicorn.Api.Models.Json;
using SignageUnicorn.Api.Repositories.Interfaces;
using SignageUnicorn.Api.Services;

// Single-instance guard: PM2 on Windows occasionally fails to kill the previous dotnet child on
// restart, leaving an orphan that still holds the listen port. The new instance then crash-loops
// with SocketException 10048. Before binding, reclaim the port from any stale instance of this app.
EnsurePortAvailable(args);

var builder = WebApplication.CreateBuilder(args);

// Clear logging providers to prevent Windows Event Log permission issues from crashing the app
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.Logging.AddDebug();

// 1. Add Services
builder.Services.AddControllers().AddJsonOptions(options =>
{
    // Contract item 4: every DateTime leaves as ISO-8601 UTC with "Z" and every DateTime that arrives
    // without an offset is read as UTC. See Models/Json/UtcDateTimeJsonConverter.cs.
    options.JsonSerializerOptions.Converters.Add(new UtcDateTimeJsonConverter());
    options.JsonSerializerOptions.Converters.Add(new UtcNullableDateTimeJsonConverter());
});
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo { Title = "SignageUnicorn.Api", Version = "v1" });

    c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Description = "JWT Authorization header using the Bearer scheme. Enter your token in the text input below.",
        Name = "Authorization",
        In = ParameterLocation.Header,
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT"
    });

    c.AddSecurityRequirement(new OpenApiSecurityRequirement()
    {
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference
                {
                    Type = ReferenceType.SecurityScheme,
                    Id = "Bearer"
                },
                Name = "Bearer",
                In = ParameterLocation.Header,
            },
            new List<string>()
        }
    });
});
builder.Services.AddHttpContextAccessor();
builder.Services.AddMemoryCache();

// Configure File Upload Limits (2GB)
builder.Services.Configure<FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = 2147483648; // 2 GB
});

builder.Services.Configure<KestrelServerOptions>(options =>
{
    options.Limits.MaxRequestBodySize = 2147483648; // 2 GB
});

builder.Services.Configure<IISServerOptions>(options =>
{
    options.MaxRequestBodySize = 2147483648; // 2 GB
});

// JWT Setup
var jwtSettings = builder.Configuration.GetSection("JwtSettings");
var jwtSecret = jwtSettings["Secret"];

// This used to log "[FATAL] ... API cannot start securely" and then carry on with a hardcoded
// constant committed to a PUBLIC repository. Anyone who read it could mint a valid admin token
// against any deployment missing its secret. A fatal message followed by starting anyway is not a
// safeguard.
//
// The rejected values are only the ones this repository has actually published -- deliberately
// not a heuristic on length or wording, because a false positive here refuses to start a healthy
// production deployment. appsettings.json now ships an empty Secret, so the blank check is the
// one that normally fires; the two literals are kept for deployments still carrying an old copy.
static bool IsPublishedPlaceholder(string s) =>
    s.StartsWith("CHANGE_THIS_SECRET", StringComparison.OrdinalIgnoreCase) ||
    s.StartsWith("THIS_IS_A_VERY_SECRET_KEY", StringComparison.OrdinalIgnoreCase);

if (string.IsNullOrWhiteSpace(jwtSecret) || IsPublishedPlaceholder(jwtSecret))
{
    if (builder.Environment.IsProduction())
    {
        throw new InvalidOperationException(
            "JwtSettings:Secret is missing or is a placeholder published in this repository. Set a real " +
            "value in appsettings.Production.json (untracked) before starting in Production. Refusing to " +
            "start with a signing key anyone can read.");
    }

    var random = new byte[64];
    System.Security.Cryptography.RandomNumberGenerator.Fill(random);
    jwtSecret = Convert.ToBase64String(random);
    Console.WriteLine("[WARN] JwtSettings:Secret is not configured. Generated a random key for this " +
                      "process only -- every restart invalidates existing tokens. Development only.");
}
else if (jwtSecret.Length < 32)
{
    // Warn, do not refuse: a short key is weak for HS256 but stopping a running deployment over it
    // would be worse than saying so.
    Console.WriteLine($"[WARN] JwtSettings:Secret is only {jwtSecret.Length} characters. HS256 wants at " +
                      "least 32; consider rotating to a longer key.");
}

// F11: resolved ONCE. The same object signs tokens (AuthService) and validates them (below), so a
// generated development key can no longer differ between the two paths.
var jwtOptions = new JwtOptions
{
    Secret = jwtSecret,
    Issuer = jwtSettings["Issuer"] ?? "SignageUnicornApi",
    Audience = jwtSettings["Audience"] ?? "SignageUnicornClient",
    ExpiryMinutes = int.TryParse(jwtSettings["ExpiryMinutes"], out var expiry) && expiry > 0 ? expiry : 1440
};
builder.Services.AddSingleton(jwtOptions);

var key = jwtOptions.KeyBytes;
builder.Services.AddAuthentication(x =>
{
    x.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    x.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
})
.AddJwtBearer(x =>
{
    x.RequireHttpsMetadata = false;
    x.SaveToken = true;
    x.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = new SymmetricSecurityKey(key),
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidIssuer = jwtOptions.Issuer,
        ValidAudience = jwtOptions.Audience,
        ClockSkew = TimeSpan.Zero
    };
    x.Events = new JwtBearerEvents
    {
        // Contract T12: no Authorization header -> use the HttpOnly session cookie, but only for
        // requests that cannot be a cross-site forgery (safe methods, or the X-Requested-With header
        // that a cross-site form cannot set). A state-changing request that arrives with the cookie
        // and without the header is deliberately NOT authenticated: protected endpoints answer 401
        // and the CSRF middleware below turns that into an explicit 403 so the cause is visible.
        OnMessageReceived = context =>
        {
            if (!context.Request.Headers.ContainsKey("Authorization")
                && context.Request.Cookies.TryGetValue(SessionCookie.Name, out var cookie)
                && !string.IsNullOrEmpty(cookie))
            {
                if (SessionCookie.IsCsrfSafe(context.Request.Method, context.Request.Headers[SessionCookie.CsrfHeaderName]))
                {
                    context.Token = cookie;
                    context.HttpContext.Items[SessionCookie.AuthSourceItem] = "cookie";
                }
                else
                {
                    context.HttpContext.Items[SessionCookie.CsrfBlockedItem] = true;
                }
            }
            return Task.CompletedTask;
        },
        OnAuthenticationFailed = context =>
        {
            Console.WriteLine($"[DEBUG JWT FAILED] Path: {context.Request.Path} | Error: {context.Exception.Message}");
            return Task.CompletedTask;
        },
        // F12: a signed token used to stay valid for its full lifetime after the account was
        // deactivated, its password changed or its role changed. The token now carries the
        // token_version it was minted with; the database value is bumped on each of those events and
        // compared here (cached 60 s per user, so revocation lands within a minute without a
        // database round-trip per request).
        OnTokenValidated = async context =>
        {
            var principal = context.Principal;
            var userId = principal?.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userId)) return;

            var claim = principal?.FindFirst(AuthService.TokenVersionClaim)?.Value;
            int tokenVersion = int.TryParse(claim, out var tv) ? tv : 1; // tokens issued before this change carry no claim

            try
            {
                var cache = context.HttpContext.RequestServices.GetRequiredService<IMemoryCache>();
                var current = await cache.GetOrCreateAsync($"tokenversion:{userId}", async entry =>
                {
                    entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(60);
                    var users = context.HttpContext.RequestServices.GetRequiredService<IUserRepository>();
                    return await users.GetTokenVersionAsync(userId);
                });

                if (current.HasValue && tokenVersion < current.Value)
                {
                    Console.WriteLine($"[JWT REVOKED] user={userId} tokenVersion={tokenVersion} current={current.Value} path={context.Request.Path}");
                    context.Fail("Token revoked");
                }
            }
            catch (Exception ex)
            {
                // Cannot verify (database down): fail open rather than lock every operator out,
                // but say so.
                Console.WriteLine($"[WARN] token_version check skipped: {ex.Message}");
            }
        }
    };
});

// Brute-force protection for the login endpoint.
//
// sp_auth_user_std implements LOGIN_SUCCESS and LOGIN_FAIL and sn_auth_user carries
// failed_login_count and locked_until. AuthService now records both outcomes (F12), so the
// database lockout is active as well; this limiter remains the first line because it works even
// when the database is unavailable.
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    // Per client IP, so one branch fumbling its password cannot lock out another.
    options.AddPolicy("login", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 10,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0
            }));

    // Device registration is anonymous and creates rows: 20 per minute per IP is far above what a
    // branch of screens rebooting together needs.
    options.AddPolicy("register", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 20,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0
            }));

    // Token claims (contract T2): anonymous, so bounded per IP like registration.
    options.AddPolicy("claim", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 10,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0
            }));

    // Device log uploads (contract item 5): 6 batches of up to 100 entries per minute per IP.
    options.AddPolicy("logs", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 6,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0
            }));
});

// 2. CORS. AllowAnyOrigin is acceptable here and deliberately kept: authentication is a bearer
// token in the Authorization header (no cookies, nothing ambient), so a cross-origin page gains
// nothing from a permissive CORS policy that it could not already do with curl. The Electron kiosk
// renders from file:// (origin "null") and the admin console is proxied same-origin by Next.js, so
// an allowlist would only break the kiosk without protecting anything.
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll",
        builder =>
        {
            builder.AllowAnyOrigin()
                   .AllowAnyMethod()
                   .AllowAnyHeader();
        });
});

// 3. Register Dependencies (Manual DI for now to keep it simple, or scan)
builder.Services.AddScoped<SignageUnicorn.Api.DBManager.DbUtils>();
builder.Services.AddScoped<SignageUnicorn.Api.Services.Database.IDatabaseService, SignageUnicorn.Api.Services.Database.DatabaseService>();

// Repositories
builder.Services.AddScoped<SignageUnicorn.Api.Repositories.Interfaces.IDeviceRepository, SignageUnicorn.Api.Repositories.Implementations.SpDeviceRepository>();
builder.Services.AddScoped<SignageUnicorn.Api.Repositories.Interfaces.IPlaylistRepository, SignageUnicorn.Api.Repositories.Implementations.SpPlaylistRepository>();
builder.Services.AddScoped<SignageUnicorn.Api.Repositories.Interfaces.IMediaRepository, SignageUnicorn.Api.Repositories.Implementations.SpMediaRepository>();
builder.Services.AddScoped<SignageUnicorn.Api.Repositories.Interfaces.IUserRepository, SignageUnicorn.Api.Repositories.Implementations.SpUserRepository>();
builder.Services.AddScoped<SignageUnicorn.Api.Repositories.Interfaces.ISystemLogRepository, SignageUnicorn.Api.Repositories.Implementations.SpSystemLogRepository>();
builder.Services.AddScoped<SignageUnicorn.Api.Repositories.Interfaces.IPlaybackLogRepository, SignageUnicorn.Api.Repositories.Implementations.SpPlaybackLogRepository>();
builder.Services.AddScoped<SignageUnicorn.Api.Repositories.Interfaces.ISystemSettingsRepository, SignageUnicorn.Api.Repositories.Implementations.SpSystemSettingsRepository>();

// Services
builder.Services.AddScoped<SignageUnicorn.Api.Services.DeviceService>();
builder.Services.AddScoped<SignageUnicorn.Api.Services.DeviceAuthService>();
builder.Services.AddScoped<SignageUnicorn.Api.Services.ServerService>(); // Added ServerService
builder.Services.AddScoped<SignageUnicorn.Api.Services.Application.PlaylistService>();
builder.Services.AddScoped<SignageUnicorn.Api.Services.MediaService>();
builder.Services.AddScoped<SignageUnicorn.Api.Services.AuthService>();

// Background Services
builder.Services.AddHostedService<SignageUnicorn.Api.Services.Background.MaintenanceWorker>();
builder.Services.AddHostedService<SignageUnicorn.Api.Services.Background.MediaCleanupWorker>();
builder.Services.AddHostedService<SignageUnicorn.Api.Services.Background.ScheduleTransitionWorker>();


var app = builder.Build();

// 4. Configure Pipeline
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}


app.UseForwardedHeaders(new ForwardedHeadersOptions
{
    ForwardedHeaders = Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedFor | Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedProto
});

// Contract item 8: screenshots now live under App_Data and are read through the authorized
// GET /api/v1/devices/{id}/screenshot. Anything still under wwwroot/screenshots from before is
// never served again.
// Likewise the working folders inside wwwroot/media: uploads being validated, conversions in
// progress and the originals MassConvertMedia keeps are not published content.
app.Use(async (context, next) =>
{
    var path = context.Request.Path;
    if (path.StartsWithSegments("/screenshots")
        || path.StartsWithSegments("/media/_staging")
        || path.StartsWithSegments("/media/temp_conversion")
        || path.StartsWithSegments("/media/_originals"))
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
    }
    await next();
});

var provider = new FileExtensionContentTypeProvider();
// Allow downloading .exe files for client installers
provider.Mappings[".exe"] = "application/vnd.microsoft.portable-executable";
// Contract item 9: nothing that a browser would execute or render as a document is ever served from
// wwwroot (media, setup). Uploads are allowlisted too, but an old file or a mis-copied one must not
// become a stored script on the application origin. Unknown types are not served at all.
foreach (var blocked in new[] { ".html", ".htm", ".xhtml", ".shtml", ".svg", ".svgz", ".xml", ".xsl", ".xslt", ".js", ".mjs", ".hta", ".vbs", ".jse", ".wsf" })
{
    provider.Mappings.Remove(blocked);
}

app.UseStaticFiles(new StaticFileOptions
{
    ContentTypeProvider = provider,
    ServeUnknownFileTypes = false,
    OnPrepareResponse = ctx =>
    {
        var headers = ctx.Context.Response.Headers;
        headers["X-Content-Type-Options"] = "nosniff";
        var path = ctx.Context.Request.Path;
        if (path.StartsWithSegments("/media") || path.StartsWithSegments("/setup"))
        {
            headers["Content-Security-Policy"] = "sandbox; default-src 'none'";
        }
    }
});
app.UseCors("AllowAll"); // Enable CORS

app.UseRateLimiter();
app.UseAuthentication();

// Contract T12: a cookie-authenticated, state-changing request without X-Requested-With was not
// authenticated above. When it targets an endpoint that requires authorization, answer 403 with a
// message that names the missing header instead of a bare 401, so a misconfigured client is
// diagnosable. Anonymous endpoints (device traffic from the same origin) are unaffected.
app.Use(async (context, next) =>
{
    if (context.Items.ContainsKey(SessionCookie.CsrfBlockedItem)
        && context.User?.Identity?.IsAuthenticated != true)
    {
        var endpoint = context.GetEndpoint();
        var requiresAuth = endpoint?.Metadata.GetMetadata<Microsoft.AspNetCore.Authorization.IAuthorizeData>() != null
                           && endpoint.Metadata.GetMetadata<Microsoft.AspNetCore.Authorization.IAllowAnonymous>() == null;
        if (requiresAuth)
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            context.Response.ContentType = "application/json";
            await context.Response.WriteAsync("{\"success\":false,\"code\":403,\"message\":\"CSRF_HEADER_REQUIRED: send X-Requested-With: SignageUnicorn with cookie-authenticated requests\",\"data\":null,\"errors\":null}");
            return;
        }
    }
    await next();
});

app.UseAuthorization();

// 5. Database schema: tables, pending migrations, changed procedures (see SchemaApplier).
// F14: the outcome is reported honestly -- "updated successfully" is printed only when nothing failed.
using (var scope = app.Services.CreateScope())
{
    try
    {
        var deviceService = scope.ServiceProvider.GetRequiredService<SignageUnicorn.Api.Services.DeviceService>();
        var report = await deviceService.FixDatabaseAsync();
        if (report.InProgress)
        {
            Console.WriteLine("[WARN] Database schema apply skipped: another apply is in progress (lock held by another process). This instance assumes that run brings the schema up to date.");
        }
        else if (report.Success)
        {
            Console.WriteLine($"Database schema up to date: {report.Applied.Count} file(s) written, {report.Migrations.Count} migration(s) applied, {report.Unchanged.Count} unchanged.");
        }
        else
        {
            Console.WriteLine($"[ERROR] Database schema apply FAILED: {report.Skipped ?? string.Join(" ; ", report.Failed)}");
            Console.WriteLine("[ERROR] The API is starting anyway so operators can reach the console, but the schema may be behind the code. Fix the failures above and run Re-apply Schema.");
        }

        // Auto-Run Server Config & Sync Media (User Request)
        var serverService = scope.ServiceProvider.GetRequiredService<SignageUnicorn.Api.Services.ServerService>();
        await serverService.AutoConfigureStartupAsync();
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[ERROR] Error during database initialization: {ex.Message}");
    }
}

app.MapControllers(); // Enable Controllers

app.Run();

// Reclaims the listen port from a stale instance of this app (a PM2-orphaned dotnet) so a fresh
// start never crash-loops on "address already in use". Best-effort: never blocks or fails startup.
// F39: it used to kill ANY dotnet process listening on the port. It now kills only a process whose
// command line names this application; anything else is reported as a port conflict and left alone.
static void EnsurePortAvailable(string[] args)
{
    try
    {
        // Resolve the port from --urls (e.g. "http://0.0.0.0:8862"); default to 8862.
        int port = 8862;
        for (int i = 0; i < args.Length; i++)
        {
            string? val = args[i].StartsWith("--urls=") ? args[i]["--urls=".Length..]
                        : (args[i] == "--urls" && i + 1 < args.Length) ? args[i + 1]
                        : null;
            if (val != null)
            {
                var m = System.Text.RegularExpressions.Regex.Match(val, @":(\d+)");
                if (m.Success && int.TryParse(m.Groups[1].Value, out var parsed)) port = parsed;
                break;
            }
        }

        int currentPid = Environment.ProcessId;

        var psi = new System.Diagnostics.ProcessStartInfo("netstat", "-ano -p tcp")
        {
            RedirectStandardOutput = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        using var probe = System.Diagnostics.Process.Start(psi);
        if (probe == null) return;
        string output = probe.StandardOutput.ReadToEnd();
        probe.WaitForExit(5000);

        bool killedAny = false;
        foreach (var raw in output.Split('\n'))
        {
            var line = raw.Trim();
            if (line.Length == 0 || !line.Contains("LISTENING")) continue;

            var parts = line.Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 5) continue;

            var local = parts[1];                          // e.g. 0.0.0.0:8862 or [::]:8862
            if (!local.EndsWith(":" + port)) continue;     // exact port (won't match :48862 etc.)
            if (!int.TryParse(parts[^1], out var pid) || pid == 0 || pid == currentPid) continue;

            try
            {
                var holder = System.Diagnostics.Process.GetProcessById(pid);
                var commandLine = GetCommandLine(pid) ?? string.Empty;
                bool isThisApp = holder.ProcessName.Equals("dotnet", StringComparison.OrdinalIgnoreCase)
                                 && commandLine.Contains("SignageUnicorn.Api", StringComparison.OrdinalIgnoreCase);
                if (isThisApp)
                {
                    Console.WriteLine($"[Startup] Port {port} held by stale SignageUnicorn.Api process {pid}; terminating to reclaim.");
                    holder.Kill(true);
                    holder.WaitForExit(3000);
                    killedAny = true;
                }
                else
                {
                    Console.WriteLine($"[Startup] PORT CONFLICT: port {port} is held by process {pid} ({holder.ProcessName}) which is NOT this API " +
                                      $"(command line: {(commandLine.Length > 0 ? commandLine : "unavailable")}). Not touching it; binding will fail until it is stopped.");
                }
            }
            catch { /* the holder may have exited already */ }
        }

        if (killedAny) System.Threading.Thread.Sleep(800); // let the socket fully release before bind
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[Startup] Port guard skipped: {ex.Message}");
    }
}

// Reads a process's command line through CIM. Returns null when it cannot be determined, which the
// caller treats as "not this app" -- the safe direction.
static string? GetCommandLine(int pid)
{
    try
    {
        var psi = new System.Diagnostics.ProcessStartInfo("powershell",
            $"-NoProfile -NonInteractive -Command \"(Get-CimInstance Win32_Process -Filter 'ProcessId={pid}').CommandLine\"")
        {
            RedirectStandardOutput = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        using var p = System.Diagnostics.Process.Start(psi);
        if (p == null) return null;
        var text = p.StandardOutput.ReadToEnd();
        if (!p.WaitForExit(5000)) { try { p.Kill(); } catch { } return null; }
        return string.IsNullOrWhiteSpace(text) ? null : text.Trim();
    }
    catch
    {
        return null;
    }
}
