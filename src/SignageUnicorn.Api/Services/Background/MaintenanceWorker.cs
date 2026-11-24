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

                    // BUG-01 defect C: PENDING commands aimed at devices that never come back
                    // had no terminal state, so the queue grew without bound (303 rows, oldest
                    // from 19-06-2026). Runs every cycle alongside the ghost retirement.
                    await ExpireUndeliverableCommandsAsync();

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
        // comes back as a new row: a row that has gone silent for an hour and is superseded by a LIVE
        // row of the same branch + device name + playback mode that APPEARED after it went silent
        // (within 24 h). API 2.8.11: the uuid prefix no longer takes part - a 2.8.8 client on a box
        // where wmic fails still reports the WIN-<computername> fallback uuid yet registers a new row
        // (its device key changed), so 'WIN- ghost / non-WIN twin' missed four of the first six
        // upgraded screens (Kamala 625/626/628, homepro 627) and left their old rows live forever.
        // Superseded-ness needs upgrade evidence (Codex P1 on 2.8.11): either the classic
        // old-identity -> new-identity uuid change, or an UPDATE_CLIENT the old row acknowledged in
        // the two hours before the new row registered. The created_at window on top keeps same-name
        // screens that are switched off overnight safe. Soft-delete is self-healing: a real screen
        // merely powered off re-registers (and auto-plays via sibling schedule inheritance) on its
        // next boot.
        private async Task RetireSupersededDevicesAsync()
        {
            using var scope = _serviceProvider.CreateScope();
            var deviceRepo = scope.ServiceProvider.GetRequiredService<IDeviceRepository>();
            try
            {
                // API 2.8.10 (24-11-2026, screen rollout 2.7.2 -> 2.8.8): the upgraded screen comes back as a
                // NEW row (real hardware uuid instead of WIN-<computername>) with no assignments of its own
                // and plays only by inheriting from this ghost. Sibling inheritance requires a live donor,
                // so the retire below used to leave such a screen idle an hour after the upgrade ("Laguna
                // All" 556, 02-11-2026). Before retiring, copy the ghost's active assignments onto every
                // twin that has none (same branch + name + playback mode, created after the ghost went
                // silent, not set to explicit by an admin) and queue SYNC_SCHEDULE so the twin reloads.
                // One ghost per twin (the most recently seen) so two ghosts never both donate. Ghosts
                // retired in the last 7 days are included, which also repairs a twin that already went idle.
                // Recipients are matched with the same space/case normalisation as the inheritance query
                // (Codex: "KAMALA  ALL" inherited from "KAMALA ALL" and would otherwise be skipped here).
                var carryOver = @"
                    DECLARE @copied TABLE (twin_id BIGINT);
                    ;WITH ghosts AS (
                        SELECT g.device_id, g.device_uuid, g.branch_code, g.device_name,
                               ISNULL(g.playback_mode, 'screen') AS mode,
                               ISNULL(g.last_check_in, g.created_at) AS silent_since
                        FROM sn_devices g
                        WHERE ((g.is_deleted = 0 AND (g.last_check_in IS NULL OR g.last_check_in < DATEADD(HOUR, -1, SYSUTCDATETIME())))
                               OR (g.is_deleted = 1 AND g.deleted_at > DATEADD(DAY, -7, SYSUTCDATETIME())))
                          AND EXISTS (SELECT 1 FROM sn_device_playlists gp WHERE gp.device_id = g.device_id AND gp.is_active = 1)
                    ), pairs AS (
                        SELECT n.device_id AS twin_id, gh.device_id AS ghost_id,
                               ROW_NUMBER() OVER (PARTITION BY n.device_id ORDER BY gh.silent_since DESC, gh.device_id DESC) AS rn
                        FROM ghosts gh
                        JOIN sn_devices n
                          ON n.is_deleted = 0
                         AND n.device_id <> gh.device_id
                         AND LTRIM(RTRIM(n.branch_code)) = LTRIM(RTRIM(gh.branch_code))
                         AND LTRIM(RTRIM(REPLACE(REPLACE(REPLACE(n.device_name, ' ', CHAR(1)+CHAR(2)), CHAR(2)+CHAR(1), ''), CHAR(1)+CHAR(2), ' ')))
                             COLLATE SQL_Latin1_General_CP1_CI_AS
                             = LTRIM(RTRIM(REPLACE(REPLACE(REPLACE(gh.device_name, ' ', CHAR(1)+CHAR(2)), CHAR(2)+CHAR(1), ''), CHAR(1)+CHAR(2), ' ')))
                             COLLATE SQL_Latin1_General_CP1_CI_AS
                         AND ISNULL(n.playback_mode, 'screen') = gh.mode
                         AND n.last_check_in > DATEADD(MINUTE, -5, SYSUTCDATETIME())
                         AND n.created_at > gh.silent_since
                         AND n.created_at < DATEADD(HOUR, 24, gh.silent_since)
                         -- Review 2.8.11 (Codex P1): same name + timing alone would also pair a real
                         -- powered-off screen with an unrelated extra screen installed the same day.
                         -- Require upgrade evidence: the classic old-identity -> new-identity change,
                         -- or an UPDATE_CLIENT the ghost acknowledged shortly before the twin appeared.
                         AND ((gh.device_uuid LIKE 'WIN-%' AND n.device_uuid NOT LIKE 'WIN-%')
                              OR EXISTS (SELECT 1 FROM sn_device_commands uc
                                         WHERE uc.device_id = gh.device_id AND uc.command_type = 'UPDATE_CLIENT'
                                           AND uc.status = 'EXECUTED' AND uc.is_deleted = 0
                                           AND uc.updated_at > DATEADD(HOUR, -2, n.created_at)
                                           AND uc.updated_at <= DATEADD(MINUTE, 5, n.created_at)))
                        WHERE ISNULL(n.schedule_mode, '') <> 'explicit'
                          AND NOT EXISTS (SELECT 1 FROM sn_device_playlists tp WHERE tp.device_id = n.device_id AND tp.is_active = 1)
                    )
                    INSERT INTO sn_device_playlists (device_id, playlist_id, start_date, end_date, is_active,
                                                     start_time, end_time, days_of_week, repeat_every_minutes)
                    OUTPUT inserted.device_id INTO @copied (twin_id)
                    SELECT p.twin_id, gp.playlist_id, gp.start_date, gp.end_date, 1,
                           gp.start_time, gp.end_time, gp.days_of_week, gp.repeat_every_minutes
                    FROM pairs p
                    JOIN sn_device_playlists gp ON gp.device_id = p.ghost_id AND gp.is_active = 1
                    WHERE p.rn = 1;

                    INSERT INTO sn_device_commands (command_uuid, device_id, command_type, status, created_at, created_by, is_deleted)
                    SELECT NEWID(), c.twin_id, 'SYNC_SCHEDULE', 'PENDING', SYSUTCDATETIME(), 1, 0
                    FROM (SELECT DISTINCT twin_id FROM @copied) c
                    WHERE NOT EXISTS (SELECT 1 FROM sn_device_commands x
                                      WHERE x.device_id = c.twin_id AND x.command_type = 'SYNC_SCHEDULE'
                                        AND x.status = 'PENDING' AND x.is_deleted = 0);";
                await deviceRepo.ExecuteSqlAsync(carryOver);

                var sql = @"
                    UPDATE sn_devices
                    SET is_deleted = 1, status = 'OFFLINE', deleted_at = SYSUTCDATETIME()
                    WHERE is_deleted = 0
                      AND (last_check_in IS NULL OR last_check_in < DATEADD(HOUR, -1, SYSUTCDATETIME()))
                      AND EXISTS (
                            SELECT 1 FROM sn_devices n
                            WHERE n.is_deleted = 0
                              AND n.device_id <> sn_devices.device_id
                              AND ISNULL(n.playback_mode, 'screen') = ISNULL(sn_devices.playback_mode, 'screen')
                              AND LTRIM(RTRIM(n.branch_code)) = LTRIM(RTRIM(sn_devices.branch_code))
                              AND LTRIM(RTRIM(REPLACE(REPLACE(REPLACE(n.device_name, ' ', CHAR(1)+CHAR(2)), CHAR(2)+CHAR(1), ''), CHAR(1)+CHAR(2), ' ')))
                                  COLLATE SQL_Latin1_General_CP1_CI_AS
                                  = LTRIM(RTRIM(REPLACE(REPLACE(REPLACE(sn_devices.device_name, ' ', CHAR(1)+CHAR(2)), CHAR(2)+CHAR(1), ''), CHAR(1)+CHAR(2), ' ')))
                                  COLLATE SQL_Latin1_General_CP1_CI_AS
                              AND n.last_check_in > DATEADD(MINUTE, -5, SYSUTCDATETIME())
                              -- The twin must have APPEARED after this row went silent, and within a day
                              -- of it (an upgrade re-registers within hours). A WIN- row that kept
                              -- checking in after its supposed successor was created is a different
                              -- physical screen: several screens at one branch share a name (four
                              -- 'Ploenchit All' at 1006) and are switched off overnight, so the old rule
                              -- retired them every night and the morning heartbeat re-created them as
                              -- new rows, which also dropped their playlist assignments.
                              AND n.created_at > ISNULL(sn_devices.last_check_in, sn_devices.created_at)
                              AND n.created_at < DATEADD(HOUR, 24, ISNULL(sn_devices.last_check_in, sn_devices.created_at))
                              -- Review 2.8.11 (Codex P1): upgrade evidence, same as the carry-over above.
                              AND ((sn_devices.device_uuid LIKE 'WIN-%' AND n.device_uuid NOT LIKE 'WIN-%')
                                   OR EXISTS (SELECT 1 FROM sn_device_commands uc
                                              WHERE uc.device_id = sn_devices.device_id AND uc.command_type = 'UPDATE_CLIENT'
                                                AND uc.status = 'EXECUTED' AND uc.is_deleted = 0
                                                AND uc.updated_at > DATEADD(HOUR, -2, n.created_at)
                                                AND uc.updated_at <= DATEADD(MINUTE, 5, n.created_at))));";
                await deviceRepo.ExecuteSqlAsync(sql);
                _logger.LogInformation("[Maintenance] Ghost assignments carried over to their upgraded twins and superseded ghost devices retired (if any).");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[Maintenance] Failed to retire superseded devices.");
            }
        }

        // Gives PENDING commands a terminal state when they can no longer be delivered.
        // A command is only reachable through the device's own heartbeat, so once a device is
        // soft-deleted or has been dark for a week the row will never be picked up and simply
        // accumulates -- every playlist reassign queues another SYNC_SCHEDULE behind it.
        // The 7-day threshold is deliberately far beyond the 1-hour ghost-retirement grace, so a
        // screen that is merely powered off over a long weekend keeps its queued work.
        private async Task ExpireUndeliverableCommandsAsync()
        {
            using var scope = _serviceProvider.CreateScope();
            var deviceRepo = scope.ServiceProvider.GetRequiredService<IDeviceRepository>();
            try
            {
                var sql = @"
                    UPDATE c
                    SET c.status = 'EXPIRED',
                        c.updated_at = SYSUTCDATETIME(),
                        c.fail_reason = 'Undeliverable: target device deleted or dark for more than 7 days'
                    FROM sn_device_commands c
                    JOIN sn_devices d ON d.device_id = c.device_id
                    WHERE c.status = 'PENDING'
                      AND c.created_at < DATEADD(DAY, -7, SYSUTCDATETIME())
                      AND (d.is_deleted = 1
                           OR d.last_check_in IS NULL
                           OR d.last_check_in < DATEADD(DAY, -7, SYSUTCDATETIME()));";
                await deviceRepo.ExecuteSqlAsync(sql);
                _logger.LogInformation("[Maintenance] Undeliverable PENDING commands expired (if any).");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[Maintenance] Failed to expire undeliverable commands.");
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

                // F36: retention used to be a hard-coded 2 days while the dashboard and statistics
                // pages ask for 7, so reports silently undercounted after every nightly purge.
                int systemLogDays = Math.Max(1, config.GetValue<int?>("Maintenance:SystemLogRetentionDays") ?? 14);
                int playbackLogDays = Math.Max(1, config.GetValue<int?>("Maintenance:PlaybackLogRetentionDays") ?? 90);

                // 1. Clear Old System Logs
                try
                {
                    var sql = @"
                        SET NOCOUNT ON;
                        DECLARE @Deleted INT = 1;
                        WHILE @Deleted > 0
                        BEGIN
                            DELETE TOP (5000) FROM sn_system_logs WHERE created_at < DATEADD(day, -@days, SYSUTCDATETIME());
                            SET @Deleted = @@ROWCOUNT;
                        END";
                    await deviceRepo.ExecuteSqlAsync(sql, new { days = systemLogDays });
                    _logger.LogInformation("[Maintenance] Old system logs (> {Days} days) cleared.", systemLogDays);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "[Maintenance] Failed to clear system logs.");
                }

                // 2. Clear Old Playback Logs (proof-of-play; retention is configurable, default 90 days)
                try
                {
                    var sql = @"
                        SET NOCOUNT ON;
                        DECLARE @Deleted INT = 1;
                        WHILE @Deleted > 0
                        BEGIN
                            DELETE TOP (5000) FROM sn_playback_logs WHERE created_at < DATEADD(day, -@days, SYSUTCDATETIME());
                            SET @Deleted = @@ROWCOUNT;
                        END";
                    await deviceRepo.ExecuteSqlAsync(sql, new { days = playbackLogDays });
                    _logger.LogInformation("[Maintenance] Old playback logs (> {Days} days) cleared.", playbackLogDays);
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
                            DELETE TOP (5000) FROM sn_device_commands WHERE created_at < DATEADD(day, -7, SYSUTCDATETIME()) AND ISNULL(updated_at, created_at) < DATEADD(day, -7, SYSUTCDATETIME()) AND status <> 'PENDING'; -- 2.8.11: a recently acknowledged UPDATE_CLIENT is upgrade evidence for the ghost retire
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
                //    API 2.8.10: rows of a device deleted less than 7 days ago are kept, because the
                //    ghost carry-over in RetireSupersededDevicesAsync may still need to donate them.
                try
                {
                    await deviceRepo.ExecuteSqlAsync("SET QUOTED_IDENTIFIER ON; SET ANSI_NULLS ON; DELETE FROM sn_device_playlists WHERE device_id IN (SELECT device_id FROM sn_devices WHERE is_deleted = 1 AND (deleted_at IS NULL OR deleted_at < DATEADD(DAY, -7, SYSUTCDATETIME()))) OR is_active = 0;");
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

                        // F23: the sweep used to compare a snapshot of the database against the disk
                        // and delete every unmatched file at once. A file written by an upload whose
                        // row was committed a moment after the snapshot -- or a transcode published
                        // after it -- was deleted as an orphan, leaving a valid row pointing at nothing.
                        // Two guards: only files older than 24 h are candidates, and the database is
                        // re-checked for the exact name immediately before each delete.
                        var minAgeUtc = DateTime.UtcNow.AddHours(-24);

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
                                    if (fileInfo.LastWriteTimeUtc > minAgeUtc || fileInfo.CreationTimeUtc > minAgeUtc)
                                        continue; // too young to judge

                                    var stillReferenced = await deviceRepo.QueryScalarAsync<int>(
                                        "SELECT COUNT(*) FROM sn_media_files WHERE blob_url LIKE '%/' + @name",
                                        new { name = fileName });
                                    if (stillReferenced > 0)
                                        continue;

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
