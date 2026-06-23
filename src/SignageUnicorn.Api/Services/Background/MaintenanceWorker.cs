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

            var lastDailyUtc = DateTime.MinValue;

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    // Lightweight, runs every cycle: retire old device records that have been
                    // superseded by an upgraded screen, so the old duplicate disappears on its own.
                    await RetireSupersededDevicesAsync();

                    // Heavy daily cleanup (logs, orphan files, DB shrink) at most once per 24h.
                    if (DateTime.UtcNow - lastDailyUtc >= TimeSpan.FromHours(24))
                    {
                        await PerformMaintenanceAsync();
                        lastDailyUtc = DateTime.UtcNow;
                    }

                    // Re-check for superseded devices every 30 minutes.
                    await Task.Delay(TimeSpan.FromMinutes(30), stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    // Graceful shutdown
                    break;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error occurred during maintenance task.");

                    // Retry in 30 minutes if failed
                    await Task.Delay(TimeSpan.FromMinutes(30), stoppingToken);
                }
            }
        }

        // Automatically retires the old device record left behind when a screen is upgraded and
        // re-registers under a new hardware identity. A "ghost" is an old-identity device
        // (device_uuid like 'WIN-<computername>') that has gone offline and is superseded by a LIVE
        // new-identity device of the same branch + device name. Only already-upgraded branches are
        // touched; the 1-hour offline grace ignores brief reboots/network blips. Soft-delete is
        // self-healing: a real screen merely powered off re-registers (and auto-plays via sibling
        // schedule inheritance) on its next boot.
        private async Task RetireSupersededDevicesAsync()
        {
            using var scope = _serviceProvider.CreateScope();
            var deviceRepo = scope.ServiceProvider.GetRequiredService<IDeviceRepository>();
            try
            {
                var sql = @"
                    UPDATE sn_devices
                    SET is_deleted = 1, status = 'OFFLINE', deleted_at = SYSUTCDATETIME()
                    WHERE is_deleted = 0
                      AND device_uuid LIKE 'WIN-%'
                      AND (last_check_in IS NULL OR last_check_in < DATEADD(HOUR, -1, SYSUTCDATETIME()))
                      AND EXISTS (
                            SELECT 1 FROM sn_devices n
                            WHERE n.is_deleted = 0
                              AND n.device_uuid NOT LIKE 'WIN-%'
                              AND n.branch_code = sn_devices.branch_code
                              AND n.device_name = sn_devices.device_name
                              AND n.last_check_in > DATEADD(MINUTE, -5, SYSUTCDATETIME()));";
                await deviceRepo.ExecuteSqlAsync(sql);
                _logger.LogInformation("[Maintenance] Superseded ghost devices retired (if any).");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[Maintenance] Failed to retire superseded devices.");
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

                // 4. Clear Stale Schedules (sn_device_playlists): rows for deleted devices, plus any
                //    leftover inactive rows (e.g. from playlist deletion) so the table stays lean.
                try
                {
                    await deviceRepo.ExecuteSqlAsync("SET QUOTED_IDENTIFIER ON; SET ANSI_NULLS ON; DELETE FROM sn_device_playlists WHERE device_id IN (SELECT device_id FROM sn_devices WHERE is_deleted = 1) OR is_active = 0;");
                    _logger.LogInformation("[Maintenance] Stale/inactive schedule rows cleared.");
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

                // NOTE: Periodic DBCC SHRINKDATABASE was intentionally removed. Repeatedly shrinking a
                // live database severely fragments indexes and hurts performance; the file just regrows.
                // Keeping RECOVERY SIMPLE is handled once at the DB level, not on every maintenance run.

                _logger.LogInformation("[Maintenance] Cleanup Completed Successfully.");
            }
        }
    }
}
