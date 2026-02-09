using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using System.Text;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Server.Kestrel.Core;

using Microsoft.OpenApi.Models;

var builder = WebApplication.CreateBuilder(args);

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
var key = Encoding.ASCII.GetBytes(jwtSettings["Secret"] ?? "THIS_IS_A_VERY_SECRET_KEY_FOR_SIGNAGE_UNICORN_DEV_ONLY_DO_NOT_USE_IN_PROD");

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


var app = builder.Build();

// 4. Configure Pipeline
app.UseSwagger();
app.UseSwaggerUI();


app.UseForwardedHeaders(new ForwardedHeadersOptions
{
    ForwardedHeaders = Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedFor | Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedProto
});

app.UseStaticFiles();
app.UseCors("AllowAll"); // Enable CORS

app.UseAuthentication();
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
