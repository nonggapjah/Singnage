/* ============================================================================
   BUG-02 — Device data integrity corrections
   Prepared 20-08-2026 by AM (Overseer). Evidence:
   Development/Signage/08_AuditReport/AUDIT_OPS-06_FleetHealth_20-08-2026.md section 5

   Sibling inheritance matches on branch_code + device_name. A typo removes a
   screen from its peer group silently -- it comes up idle after a reinstall
   with no error anywhere. Three devices are stranded in branches of their own.

   Each correction was verified before being written here: the target branch
   already contains devices with the EXACT same device_name, and those siblings
   already hold active playlists, so the corrected row will inherit immediately.

     device 219  Sukhumvit 49 All   105  -> 1005   (3 exact-name peers, 9 with playlists)
     device 271  Chic All          1951  -> 1051   (5 exact-name peers, 10 with playlists)
     device  98  Nanglinchi All    1955  -> 1055   (18 exact-name peers, 54 with playlists)

   RUN AS ONE TRANSACTION. Review the printed before/after counts, then COMMIT.
   ROLLBACK is safe at any point before the COMMIT.
   ============================================================================ */

USE [SignageUnicornDB];
GO

SET XACT_ABORT ON;
BEGIN TRANSACTION;

-- ---------- BEFORE ----------
PRINT '--- BEFORE ---';
SELECT device_id, device_name, branch_code, status, last_check_in
FROM sn_devices WHERE device_id IN (219, 271, 98);

-- ---------- Guard: refuse to run if the rows are not what we expect ----------
IF NOT EXISTS (SELECT 1 FROM sn_devices WHERE device_id = 219 AND branch_code = '105'  AND device_name = 'Sukhumvit 49 All')
   OR NOT EXISTS (SELECT 1 FROM sn_devices WHERE device_id = 271 AND branch_code = '1951' AND device_name = 'Chic All')
   OR NOT EXISTS (SELECT 1 FROM sn_devices WHERE device_id =  98 AND branch_code = '1955' AND device_name = 'Nanglinchi All')
BEGIN
    PRINT 'ABORTED: the rows no longer match the audited state. Re-run the audit before applying.';
    ROLLBACK TRANSACTION;
    RETURN;
END

-- ---------- Corrections ----------
UPDATE sn_devices SET branch_code = '1005', updated_at = SYSUTCDATETIME() WHERE device_id = 219;
UPDATE sn_devices SET branch_code = '1051', updated_at = SYSUTCDATETIME() WHERE device_id = 271;
UPDATE sn_devices SET branch_code = '1055', updated_at = SYSUTCDATETIME() WHERE device_id =  98;

-- ---------- Optional: normalise the whitespace variants ----------
-- The application-side fix (SpDeviceRepository.GetSiblingDeviceIdWithAssignmentsAsync)
-- already matches across these, so this block is cosmetic -- it only makes the admin UI
-- read consistently. Safe: it collapses runs of spaces and trims the ends, nothing else.
UPDATE sn_devices
SET device_name = LTRIM(RTRIM(REPLACE(REPLACE(REPLACE(device_name, ' ', CHAR(1)+CHAR(2)), CHAR(2)+CHAR(1), ''), CHAR(1)+CHAR(2), ' '))),
    updated_at  = SYSUTCDATETIME()
WHERE is_deleted = 0
  AND device_name <> LTRIM(RTRIM(REPLACE(REPLACE(REPLACE(device_name, ' ', CHAR(1)+CHAR(2)), CHAR(2)+CHAR(1), ''), CHAR(1)+CHAR(2), ' ')));

-- ---------- Queue a schedule sync so the corrected screens pick content up ----------
INSERT INTO sn_device_commands (command_uuid, device_id, command_type, status, created_at)
SELECT NEWID(), device_id, 'SYNC_SCHEDULE', 'PENDING', SYSUTCDATETIME()
FROM sn_devices WHERE device_id IN (219, 271, 98);

-- ---------- AFTER ----------
PRINT '--- AFTER ---';
SELECT device_id, device_name, branch_code, status FROM sn_devices WHERE device_id IN (219, 271, 98);

PRINT '--- devices still stranded in a branch of their own (should list only 9999) ---';
SELECT branch_code, COUNT(*) AS Devices, MIN(device_name) AS SampleName
FROM sn_devices WHERE is_deleted = 0 GROUP BY branch_code HAVING COUNT(*) <= 2 ORDER BY branch_code;

-- Review the output above, then run ONE of:
--   COMMIT TRANSACTION;
--   ROLLBACK TRANSACTION;
GO

/* ----------------------------------------------------------------------------
   NOT INCLUDED ON PURPOSE — branch 9999, device 461 "ทดสอบ"
   The audit flagged it as a test row, but it is status PLAYING and checked in on
   19-08-2026. Something is using it. Soft-deleting a live screen is not a
   cleanup, so it is left alone pending a decision from Commander.
   ---------------------------------------------------------------------------- */
