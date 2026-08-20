/* ============================================================================
   BUG-02 — Device data integrity corrections

   *** WARNING 1 — THIS SCRIPT ALONE DOES NOT WORK FOR A LIVE DEVICE ***
   sp_device_std's HEARTBEAT applies
       branch_code = ISNULL(@p_branch_code, branch_code)
       device_name = ISNULL(@p_device_name, device_name)
   and the client sends both from its OWN local config on every beat. Nothing
   pushes a server-side change back down -- the only self-healing command is
   UPDATE_DEVICE_ID. All three target devices are LIVE, so anything written
   here is overwritten within ~15 seconds.

   To correct a live device, change branchCode in the client's setup screen on
   that machine. Use this script only for devices that are already dark, or as
   the second half of that change.

   *** WARNING 2 — THIS IS NOT AN OUTAGE FIX ***
   All three devices already hold their own active playlists (3, 2 and 2). The
   typo is not making them idle today; the correction is preventive, for the
   next time one of them is reinstalled and has to inherit from a sibling.

   ----------------------------------------------------------------------------
   TRANSACTION DESIGN NOTE (rewritten 20-08-2026 after an incident)

   The first version of this script opened a transaction and ended with a
   comment asking the operator to review the output and then type COMMIT. That
   design caused a production stall: the transaction sat open in SSMS for six
   minutes holding 360 exclusive key locks on sn_device_commands, and roughly
   100 API heartbeat sessions piled up behind it. No screen went dark, but no
   screen could receive a command either.

   Never leave a transaction open awaiting a human on a table that sits on the
   fleet's hot path. This version is split instead: STEP 1 is read-only and
   shows you exactly what would change; STEP 2 is a single self-contained
   transaction that commits or rolls back on its own with no human in the
   middle. Run STEP 1, read it, then run STEP 2.
   ============================================================================ */

USE [SignageUnicornDB];
GO

/* ==========================================================================
   STEP 1 — PREVIEW (read-only, safe to run any time, takes no locks)
   ========================================================================== */
PRINT '=== STEP 1: preview ===';

SELECT d.device_id, d.device_name, d.branch_code AS CurrentBranch, t.Target AS NewBranch,
       d.last_check_in,
       DATEDIFF(minute, d.last_check_in, GETUTCDATE()) AS MinsSinceCheckIn,
       CASE WHEN d.last_check_in >= DATEADD(minute,-10,GETUTCDATE())
            THEN 'LIVE - will be reverted by its next heartbeat, fix the client config instead'
            ELSE 'dark - the correction will stick' END AS Verdict
FROM sn_devices d WITH (NOLOCK)
JOIN (VALUES (219,'1005'),(271,'1051'),(98,'1055')) AS t(Id,Target) ON t.Id = d.device_id;

SELECT COUNT(*) AS NameRowsThatWouldBeNormalised
FROM sn_devices WITH (NOLOCK)
WHERE is_deleted = 0
  AND device_name <> LTRIM(RTRIM(REPLACE(REPLACE(REPLACE(device_name,' ',CHAR(1)+CHAR(2)),CHAR(2)+CHAR(1),''),CHAR(1)+CHAR(2),' ')));
GO

/* ==========================================================================
   STEP 2 — APPLY (self-contained: commits or rolls back on its own)
   Run this only after reading STEP 1. Nothing waits for a human inside it.
   ========================================================================== */
PRINT '=== STEP 2: apply ===';

SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;

    -- Refuse to run if the rows are no longer what was audited.
    IF NOT EXISTS (SELECT 1 FROM sn_devices WHERE device_id = 219 AND branch_code = '105'  AND device_name = 'Sukhumvit 49 All')
       OR NOT EXISTS (SELECT 1 FROM sn_devices WHERE device_id = 271 AND branch_code = '1951' AND device_name = 'Chic All')
       OR NOT EXISTS (SELECT 1 FROM sn_devices WHERE device_id =  98 AND branch_code = '1955' AND device_name = 'Nanglinchi All')
        THROW 50001, 'Rows no longer match the audited state. Re-run the audit before applying.', 1;

    UPDATE sn_devices SET branch_code = '1005', updated_at = SYSUTCDATETIME() WHERE device_id = 219;
    UPDATE sn_devices SET branch_code = '1051', updated_at = SYSUTCDATETIME() WHERE device_id = 271;
    UPDATE sn_devices SET branch_code = '1055', updated_at = SYSUTCDATETIME() WHERE device_id =  98;

    -- Cosmetic only: the application-side fix already matches across these.
    UPDATE sn_devices
    SET device_name = LTRIM(RTRIM(REPLACE(REPLACE(REPLACE(device_name,' ',CHAR(1)+CHAR(2)),CHAR(2)+CHAR(1),''),CHAR(1)+CHAR(2),' '))),
        updated_at  = SYSUTCDATETIME()
    WHERE is_deleted = 0
      AND device_name <> LTRIM(RTRIM(REPLACE(REPLACE(REPLACE(device_name,' ',CHAR(1)+CHAR(2)),CHAR(2)+CHAR(1),''),CHAR(1)+CHAR(2),' ')));

    -- Queue a schedule sync for the corrected screens.
    INSERT INTO sn_device_commands (command_uuid, device_id, command_type, status, created_at)
    SELECT NEWID(), device_id, 'SYNC_SCHEDULE', 'PENDING', SYSUTCDATETIME()
    FROM sn_devices WHERE device_id IN (219, 271, 98);

    COMMIT TRANSACTION;
    PRINT 'Applied and committed.';
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'ROLLED BACK: ' + ERROR_MESSAGE();
END CATCH
GO

PRINT '=== result ===';
SELECT device_id, device_name, branch_code FROM sn_devices WITH (NOLOCK) WHERE device_id IN (219, 271, 98);
GO

/* ----------------------------------------------------------------------------
   NOT INCLUDED ON PURPOSE — branch 9999, device 461 "test row"
   Flagged as a test device by the audit, but status PLAYING and checked in on
   19-08-2026. Something is using it. Soft-deleting a live screen is not a
   cleanup, so it is left for Commander to decide.
   ---------------------------------------------------------------------------- */
