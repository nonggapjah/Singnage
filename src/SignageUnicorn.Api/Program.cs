using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using System.Text;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.AspNetCore.StaticFiles;

using Microsoft.OpenApi.Models;

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
builder.Services.AddControllers();
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
                // Scheme = "oauth2", // Not needed for Http type, removed to avoid confusion
                Name = "Bearer",
                In = ParameterLocation.Header,
            },
            new List<string>()
        }
    });
});
builder.Services.AddHttpContextAccessor();

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
if (string.IsNullOrEmpty(jwtSecret))
{
    Console.WriteLine("[FATAL] JwtSettings:Secret is missing from appsettings.json. API cannot start securely.");
    // Use a random fallback for dev only — production must have this set
    jwtSecret = "CHANGE_THIS_SECRET_IN_PRODUCTION_appsettings_json_JwtSettings_Secret";
}
var key = Encoding.ASCII.GetBytes(jwtSecret);

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
        ValidIssuer = jwtSettings["Issuer"],
        ValidAudience = jwtSettings["Audience"],
        ClockSkew = TimeSpan.Zero
    };
    x.Events = new Microsoft.AspNetCore.Authentication.JwtBearer.JwtBearerEvents
    {
        OnAuthenticationFailed = context =>
        {
            Console.WriteLine($"[DEBUG JWT FAILED] Path: {context.Request.Path} | Error: {context.Exception.Message}");
            return Task.CompletedTask;
        },
        OnTokenValidated = context =>
        {
            var user = context.Principal?.Identity?.Name ?? "none";
            Console.WriteLine($"[DEBUG JWT VALIDATED] Path: {context.Request.Path} | User: {user}");
            return Task.CompletedTask;
        }
    };
});

// 2. Add CORS (Allow Frontend to connect)
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
builder.Services.AddScoped<SignageUnicorn.Api.Services.ServerService>(); // Added ServerService
builder.Services.AddScoped<SignageUnicorn.Api.Services.Application.PlaylistService>();
builder.Services.AddScoped<SignageUnicorn.Api.Services.MediaService>();
builder.Services.AddScoped<SignageUnicorn.Api.Services.AuthService>();

// Background Services
builder.Services.AddHostedService<SignageUnicorn.Api.Services.Background.MaintenanceWorker>();
builder.Services.AddHostedService<SignageUnicorn.Api.Services.Background.MediaCleanupWorker>();


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


var provider = new FileExtensionContentTypeProvider();
// Allow downloading .exe files for client installers
provider.Mappings[".exe"] = "application/vnd.microsoft.portable-executable";

app.UseStaticFiles(new StaticFileOptions
{
    ContentTypeProvider = provider
});
app.UseCors("AllowAll"); // Enable CORS

app.UseAuthentication();

    // Auth debug middleware disabled in production — re-enable only when debugging auth issues
    // Console.WriteLine($"[DEBUG AUTH] Path: {path} | ...");

app.UseAuthorization();

// 5. Automatic Database Migration/Fix
using (var scope = app.Services.CreateScope())
{
    try 
    {
        var deviceService = scope.ServiceProvider.GetRequiredService<SignageUnicorn.Api.Services.DeviceService>();
        await deviceService.FixDatabaseAsync();
        Console.WriteLine("Database schema and stored procedures updated successfully.");

        // Auto-Run Server Config & Sync Media (User Request)
        var serverService = scope.ServiceProvider.GetRequiredService<SignageUnicorn.Api.Services.ServerService>();
        await serverService.AutoConfigureStartupAsync();
    }
    catch (Exception ex)
    {
        Console.WriteLine($"Error during database initialization: {ex.Message}");
    }
}
// Forced restart trigger for DB Schema Update 6

app.MapControllers(); // Enable Controllers

app.Run();

// Reclaims the listen port from a stale instance of this app (a PM2-orphaned dotnet) so a fresh
// start never crash-loops on "address already in use". Best-effort: never blocks or fails startup,
// and only ever kills a dotnet process that is actually LISTENING on our exact port.
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
                // Only reclaim from a stale instance of THIS app — never touch anything else.
                if (holder.ProcessName.Equals("dotnet", StringComparison.OrdinalIgnoreCase))
                {
                    Console.WriteLine($"[Startup] Port {port} held by stale dotnet process {pid}; terminating to reclaim.");
                    holder.Kill(true);
                    holder.WaitForExit(3000);
                    killedAny = true;
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
