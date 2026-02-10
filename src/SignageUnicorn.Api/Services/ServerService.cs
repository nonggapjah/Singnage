using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using SignageUnicorn.Api.Repositories.Interfaces;

namespace SignageUnicorn.Api.Services
{
    public class ServerService
    {
        private readonly IConfiguration _configuration;
        private readonly IWebHostEnvironment _env;
        private readonly IMediaRepository _mediaRepo;

        public ServerService(IConfiguration configuration, IWebHostEnvironment env, IMediaRepository mediaRepo)
        {
            _configuration = configuration;
            _env = env;
            _mediaRepo = mediaRepo;
        }

        public async Task AutoConfigureStartupAsync()
        {
            try
            {
                Console.WriteLine("[ServerService] Starting Auto-Configuration...");

                // 1. Detect IP and Config
                var currentBaseUrl = _configuration["ServerSettings:BaseUrl"] ?? "";
                
                // If BaseUrl is already set to a public domain or HTTPS, do NOT auto-configure
                if (!string.IsNullOrEmpty(currentBaseUrl) && 
                    (currentBaseUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase) || 
                     !currentBaseUrl.Contains("localhost") && !currentBaseUrl.Contains("127.0.0.1") && currentBaseUrl.Count(c => c == '.') < 3))
                {
                    Console.WriteLine($"[ServerService] Existing BaseUrl '{currentBaseUrl}' looks like a custom domain or HTTPS. Skipping auto-configuration.");
                    return;
                }

                var currentPort = 8862;
                if (Uri.TryCreate(currentBaseUrl, UriKind.Absolute, out var uri))
                {
                    currentPort = uri.Port;
                }

                var detectedIp = GetLocalIpAddress();
                var newUrl = $"http://{detectedIp}:{currentPort}";

                Console.WriteLine($"[ServerService] Detected IP: {detectedIp}. Configured URL: {currentBaseUrl}. Target URL: {newUrl}");

                // 2. Update Configuration (appsettings.json & .env) if changed
                bool configUpdated = UpdateAppSettings(newUrl);
                UpdateFrontendEnv(newUrl, currentPort);
                
                if (configUpdated)
                {
                    Console.WriteLine("[ServerService] Configuration updated.");
                }

                // 3. Sync Media Paths
                await RunMediaMigration("AUTO_DETECT", newUrl);
                Console.WriteLine("[ServerService] Media paths synchronized.");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ServerService] Auto-Configuration Failed: {ex.Message}");
            }
        }

        public object GetConfig()
        {
            var currentBaseUrl = _configuration["ServerSettings:BaseUrl"] ?? "http://localhost:8862";
            var currentPort = 8862;
            if (Uri.TryCreate(currentBaseUrl, UriKind.Absolute, out var uri))
            {
                currentPort = uri.Port;
            }
            
            var detectedIp = GetLocalIpAddress();

            return new
            {
                currentBaseUrl,
                detectedIp,
                suggestedBaseUrl = $"http://{detectedIp}:{currentPort}"
            };
        }

        public async Task<bool> UpdateConfigAsync(string ipAddress, int port, int frontendPort)
        {
            ipAddress = ipAddress.Trim();
            if (ipAddress.StartsWith("http://")) ipAddress = ipAddress.Substring(7);
            if (ipAddress.StartsWith("https://")) ipAddress = ipAddress.Substring(8);
            if (ipAddress.Contains(":")) ipAddress = ipAddress.Split(':')[0];

            string newUrl = $"http://{ipAddress}:{port}";
            string oldUrl = _configuration["ServerSettings:BaseUrl"] ?? "http://localhost:8862";

            // 1. Update appsettings.json
            if (!UpdateAppSettings(newUrl))
                return false;

            // 2. Run SQL Migration
            await RunMediaMigration(oldUrl, newUrl);

            // 3. Attempt to update Frontend .env
            UpdateFrontendEnv(newUrl, frontendPort);

            return true;
        }

        public async Task<bool> SyncMediaPathsAsync()
        {
            try 
            {
                string currentBaseUrl = _configuration["ServerSettings:BaseUrl"] ?? "http://localhost:8862";
                await RunMediaMigration("AUTO_DETECT", currentBaseUrl);
                return true;
            }
            catch
            {
                return false;
            }
        }

        private async Task RunMediaMigration(string oldUrl, string newUrl)
        {
            try 
            {
                var targets = new List<string>();

                if (oldUrl != "AUTO_DETECT") 
                {
                    targets.Add(oldUrl);
                }
                
                // Add common legacy defaults
                targets.Add("http://localhost:8862");
                targets.Add("http://127.0.0.1:8862");
                
                // Add current detected local IP with current port (derived from newUrl)
                if (Uri.TryCreate(newUrl, UriKind.Absolute, out var newUri))
                {
                    int port = newUri.Port;
                    string detectedIp = GetLocalIpAddress();
                    targets.Add($"http://{detectedIp}:{port}");
                    targets.Add($"http://localhost:{port}");
                    targets.Add($"http://127.0.0.1:{port}");
                }

                foreach (var target in targets.Distinct())
                {
                    if (target.Equals(newUrl, StringComparison.OrdinalIgnoreCase)) continue;
                    
                    // Use Repository to update via Stored Procedure
                    await _mediaRepo.SyncMediaUrls(target, newUrl);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"SQL Migration Warning: {ex.Message}");
            }
        }

        private string GetLocalIpAddress()
        {
            try
            {
                var host = Dns.GetHostEntry(Dns.GetHostName());
                foreach (var ip in host.AddressList)
                {
                    if (ip.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(ip))
                    {
                        return ip.ToString();
                    }
                }
                return "127.0.0.1";
            }
            catch
            {
                return "127.0.0.1";
            }
        }

        private bool UpdateAppSettings(string newBaseUrl)
        {
            try
            {
                var filePath = Path.Combine(_env.ContentRootPath, "appsettings.json");
                var json = System.IO.File.ReadAllText(filePath);
                var jsonObj = JsonNode.Parse(json);

                if (jsonObj["ServerSettings"] == null)
                {
                    jsonObj["ServerSettings"] = new JsonObject();
                }
                
                // Only write if changed to avoid unnecessary I/O or reloads
                if (jsonObj["ServerSettings"]["BaseUrl"]?.ToString() == newBaseUrl)
                {
                    return true;
                }

                jsonObj["ServerSettings"]["BaseUrl"] = newBaseUrl;

                System.IO.File.WriteAllText(filePath, jsonObj.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
                return true;
            }
            catch
            {
                return false;
            }
        }

        private void UpdateFrontendEnv(string newApiUrl, int? frontendPort = null)
        {
            try
            {
                var envPaths = new List<string>
                {
                    Path.GetFullPath(Path.Combine(_env.ContentRootPath, "..", "signage-unicorn-web", ".env")),
                    Path.GetFullPath(Path.Combine(_env.ContentRootPath, "..", "..", ".env"))
                };
                
                foreach (var frontendPath in envPaths)
                {
                    if (!System.IO.File.Exists(frontendPath) && !frontendPath.Contains("signage-unicorn-web")) continue;

                    var lines = System.IO.File.Exists(frontendPath) 
                        ? System.IO.File.ReadAllLines(frontendPath).ToList() 
                        : new List<string>();
                    
                    bool changed = false;
                    bool foundParams = false;

                    for (int i = 0; i < lines.Count; i++)
                    {
                        if (lines[i].StartsWith("NEXT_PUBLIC_API_BASE_URL=")) 
                        {
                            var newValue = $"NEXT_PUBLIC_API_BASE_URL={newApiUrl}/api/v1";
                            if (lines[i] != newValue)
                            {
                                lines[i] = newValue;
                                changed = true;
                            }
                            foundParams = true;
                        }
                        if (frontendPort.HasValue && lines[i].StartsWith("PORT="))
                        {
                            var newValue = $"PORT={frontendPort.Value}";
                            if (lines[i] != newValue)
                            {
                                lines[i] = newValue;
                                changed = true;
                            }
                        }
                    }

                    if (!foundParams)
                    {
                        lines.Add($"NEXT_PUBLIC_API_BASE_URL={newApiUrl}/api/v1");
                        if (frontendPort.HasValue) lines.Add($"PORT={frontendPort.Value}");
                        changed = true;
                    }

                    if (changed)
                    {
                        System.IO.File.WriteAllLines(frontendPath, lines);
                    }
                }
            }
            catch 
            { 
                // Best effort
            }
        }
    }
}
