/* ============================================================================
   BUG-01 — one-time expiry of undeliverable PENDING commands
   Prepared 20-08-2026 by AM (Overseer).

   The permanent fix lives in MaintenanceWorker.ExpireUndeliverableCommandsAsync
   and runs every 30 minutes -- but that ships in the API DLL, which needs a
   Windows deploy. This script performs the same operation once, so the existing
   backlog clears without waiting for the DLL rollout.

   Identical predicate to the C# version, deliberately: a command is only
   reachable through its device's own heartbeat, so once the device is deleted
   or has been dark for a week the row can never be picked up. The 7-day
   threshold is far beyond the 1-hour ghost-retirement grace, so a screen merely
   powered off over a long weekend keeps its queued work.

   RUN AS ONE TRANSACTION. Review the counts, then COMMIT.
   ============================================================================ */

USE [SignageUnicornDB];
GO

SET XACT_ABORT ON;
BEGIN TRANSACTION;

PRINT '--- BEFORE: PENDING by age ---';
SELECT CASE WHEN created_at < DATEADD(DAY,-30,SYSUTCDATETIME()) THEN 'older than 30d'
            WHEN created_at < DATEADD(DAY,-7, SYSUTCDATETIME()) THEN '7-30d'
            ELSE 'under 7d' END AS Age,
       COUNT(*) AS Cnt, COUNT(DISTINCT device_id) AS Devices
FROM sn_device_commands WHERE status = 'PENDING'
GROUP BY CASE WHEN created_at < DATEADD(DAY,-30,SYSUTCDATETIME()) THEN 'older than 30d'
              WHEN created_at < DATEADD(DAY,-7, SYSUTCDATETIME()) THEN '7-30d'
              ELSE 'under 7d' END;

UPDATE c
SET c.status      = 'EXPIRED',
    c.updated_at  = SYSUTCDATETIME(),
    c.fail_reason = 'Undeliverable: target device deleted or dark for more than 7 days'
FROM sn_device_commands c
JOIN sn_devices d ON d.device_id = c.device_id
WHERE c.status = 'PENDING'
  AND c.created_at < DATEADD(DAY, -7, SYSUTCDATETIME())
  AND (d.is_deleted = 1
       OR d.last_check_in IS NULL
       OR d.last_check_in < DATEADD(DAY, -7, SYSUTCDATETIME()));

PRINT '--- rows expired ---';
SELECT @@ROWCOUNT AS Expired;

PRINT '--- AFTER: remaining PENDING ---';
SELECT COUNT(*) AS StillPending, MIN(created_at) AS Oldest FROM sn_device_commands WHERE status = 'PENDING';

PRINT '--- LIVE devices still holding stale PENDING (these are the BUG-01 delivery cases,';
PRINT '    they must clear on their own once the patched sp_device_std is in place) ---';
SELECT c.device_id, d.device_name, d.branch_code, d.last_check_in, COUNT(*) AS StaleCmds
FROM sn_device_commands c JOIN sn_devices d ON d.device_id = c.device_id
WHERE c.status = 'PENDING' AND c.created_at < DATEADD(DAY,-7,SYSUTCDATETIME())
GROUP BY c.device_id, d.device_name, d.branch_code, d.last_check_in
ORDER BY COUNT(*) DESC;

-- Review the output above, then run ONE of:
--   COMMIT TRANSACTION;
--   ROLLBACK TRANSACTION;
GO
