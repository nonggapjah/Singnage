using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using SignageUnicorn.Api.Services;
using SignageUnicorn.Api.Repositories.Interfaces;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;

namespace SignageUnicorn.Api.Services.Background
{
    public class MaintenanceWorker : BackgroundService
    {
        private readonly IServiceProvider _serviceProvider;
        private readonly ILogger<MaintenanceWorker> _logger;

        public MaintenanceWorker(IServiceProvider serviceProvider, ILogger<MaintenanceWorker> logger)
        {
            _serviceProvider = serviceProvider;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation("Maintenance Worker started.");

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await PerformMaintenanceAsync();
                    
                    // Wait for 24 hours before next run
                    // If you want to run at specific time (e.g. 2 AM), logic needs to be adjustments,
                    // but interval-based 24h is simple and robust for local apps.
                    await Task.Delay(TimeSpan.FromHours(24), stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    // Graceful shutdown
                    break;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error occurred during maintenance task.");
                    
                    // Retry in 1 hour if failed
                    await Task.Delay(TimeSpan.FromHours(1), stoppingToken);
                }
            }
        }

        private async Task PerformMaintenanceAsync()
        {
            using (var scope = _serviceProvider.CreateScope())
            {
                var systemLogRepo = scope.ServiceProvider.GetRequiredService<ISystemLogRepository>();
                var playbackLogRepo = scope.ServiceProvider.GetRequiredService<IPlaybackLogRepository>();
                var deviceService = scope.ServiceProvider.GetRequiredService<DeviceService>();
                var deviceRepo = scope.ServiceProvider.GetRequiredService<IDeviceRepository>();
                var env = scope.ServiceProvider.GetRequiredService<IWebHostEnvironment>();
                var config = scope.ServiceProvider.GetRequiredService<IConfiguration>();

                _logger.LogInformation("[Maintenance] Starting Daily Cleanup...");

                // 1. Clear Old System Logs (> 2 Days)
                try
                {
                    var sql = @"
                        SET NOCOUNT ON;
                        DECLARE @Deleted INT = 1;
                        WHILE @Deleted > 0
                        BEGIN
                            DELETE TOP (5000) FROM sn_system_logs WHERE created_at < DATEADD(day, -2, SYSUTCDATETIME());
                            SET @Deleted = @@ROWCOUNT;
                        END";
                    await deviceRepo.ExecuteSqlAsync(sql);
                    _logger.LogInformation("[Maintenance] Old system logs (> 2 days) cleared.");
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "[Maintenance] Failed to clear system logs.");
                }

                // 2. Clear Old Playback Logs (> 2 Days)
                try
                {
                    var sql = @"
                        SET NOCOUNT ON;
                        DECLARE @Deleted INT = 1;
                        WHILE @Deleted > 0
                        BEGIN
                            DELETE TOP (5000) FROM sn_playback_logs WHERE created_at < DATEADD(day, -2, SYSUTCDATETIME());
                            SET @Deleted = @@ROWCOUNT;
                        END";
                    await deviceRepo.ExecuteSqlAsync(sql);
                    _logger.LogInformation("[Maintenance] Old playback logs (> 2 days) cleared.");
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "[Maintenance] Failed to clear playback logs.");
                }

                // 3. Clear Stale Commands for deleted devices & older than 2 days
                try
                {
                    var sql1 = "SET QUOTED_IDENTIFIER ON; SET ANSI_NULLS ON; DELETE FROM sn_device_commands WHERE device_id IN (SELECT device_id FROM sn_devices WHERE is_deleted = 1);";
                    await deviceRepo.ExecuteSqlAsync(sql1);

                    var sql2 = @"
                        SET NOCOUNT ON;
                        DECLARE @Deleted INT = 1;
                        WHILE @Deleted > 0
                        BEGIN
                            DELETE TOP (5000) FROM sn_device_commands WHERE created_at < DATEADD(day, -7, SYSUTCDATETIME()) AND status <> 'PENDING';
                            SET @Deleted = @@ROWCOUNT;
                        END";
                    await deviceRepo.ExecuteSqlAsync(sql2);
                    _logger.LogInformation("[Maintenance] Stale device commands (> 7 days, non-pending) cleared.");
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "[Maintenance] Failed to clear stale commands.");
                }

                // 4. Clear Stale Schedules (sn_device_playlists) for deleted devices
                try
                {
                    await deviceRepo.ExecuteSqlAsync("SET QUOTED_IDENTIFIER ON; SET ANSI_NULLS ON; DELETE FROM sn_device_playlists WHERE device_id IN (SELECT device_id FROM sn_devices WHERE is_deleted = 1);");
                    _logger.LogInformation("[Maintenance] Stale schedules for deleted devices cleared.");
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "[Maintenance] Failed to clear stale schedules.");
                }

                // 5. Clean up Physical Orphan Files on Disk (wwwroot/media)
                try
                {
                    _logger.LogInformation("[Maintenance] Scanning for orphan media files on disk...");
                    var mediaRepo = scope.ServiceProvider.GetRequiredService<IMediaRepository>();
                    var allMedia = await mediaRepo.GetAllAsync();
                    var dbFiles = allMedia
                        .Where(m => !string.IsNullOrEmpty(m.BlobUrl) && m.BlobUrl.Contains("/media/", StringComparison.OrdinalIgnoreCase))
                        .Select(m => Path.GetFileName(m.BlobUrl).Trim().ToLowerInvariant())
                        .ToHashSet();

                    string webRootPath = env.WebRootPath ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot");
                    string mediaFolder = Path.Combine(webRootPath, "media");

                    if (Directory.Exists(mediaFolder))
                    {
                        var files = Directory.GetFiles(mediaFolder);
                        int deletedCount = 0;
                        long reclaimedBytes = 0;

                        foreach (var file in files)
                        {
                            var fileName = Path.GetFileName(file);
                            var lowerName = fileName.ToLowerInvariant();

                            // Skip installers or non-media config files
                            if (lowerName.EndsWith(".exe") || lowerName.EndsWith(".msi"))
                                continue;

                            if (!dbFiles.Contains(lowerName))
                            {
                                try
                                {
                                    var fileInfo = new FileInfo(file);
                                    reclaimedBytes += fileInfo.Length;
                                    File.Delete(file);
                                    deletedCount++;
                                }
                                catch (Exception fileEx)
                                {
                                    _logger.LogWarning("[Maintenance] Failed to delete orphan file {File}: {Error}", fileName, fileEx.Message);
                                }
                            }
                        }

                        if (deletedCount > 0)
                        {
                            _logger.LogInformation("[Maintenance] Deleted {Count} orphan files on disk, reclaiming {MB} MB.", 
                                deletedCount, Math.Round(reclaimedBytes / (1024.0 * 1024.0), 2));
                        }
                        else
                        {
                            _logger.LogInformation("[Maintenance] No orphan media files found on disk.");
                        }
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "[Maintenance] Failed to scan and clean orphan files.");
                }

                // 6. Truncate / Shrink Database Files
                try
                {
                    _logger.LogInformation("[Maintenance] Shrinking database and log file...");
                    var connectionString = config.GetConnectionString("DefaultConnection") 
                                           ?? config["DB_CONNECTION_STRING"];

                    if (!string.IsNullOrEmpty(connectionString))
                    {
                        using (var connection = new SqlConnection(connectionString))
                        {
                            await connection.OpenAsync();
                            
                            // Checkpoint & shrink file
                            var shrinkSql = @"
                                ALTER DATABASE SignageUnicornDB SET RECOVERY SIMPLE;
                                CHECKPOINT;
                                DBCC SHRINKFILE (SignageUnicornDB_log, 10);
                                DBCC SHRINKDATABASE (SignageUnicornDB);";
                            
                            using (var cmd = new SqlCommand(shrinkSql, connection))
                            {
                                await cmd.ExecuteNonQueryAsync();
                            }
                            _logger.LogInformation("[Maintenance] Database shrink completed successfully.");
                        }
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "[Maintenance] Failed to shrink database files.");
                }

                _logger.LogInformation("[Maintenance] Cleanup Completed Successfully.");
            }
        }
    }
}
