/* ============================================================================
   Index corrections found by the full-system audit, 20-08-2026

   Idempotent and self-contained. Every statement is guarded, so re-running is a
   no-op. No transaction is left open awaiting a human -- see the incident note
   in BUG-01_QueueCleanup: a script written that way held 360 exclusive locks on
   sn_device_commands for six minutes and stalled every heartbeat in the fleet.

   The same definitions are now in the docs/db_template/table scripts, so "Re-apply
   Schema" preserves them instead of undoing this.
   ============================================================================ */

USE [SignageUnicornDB];
GO

/* -- STEP 1: what is there now (read-only, safe any time) ------------------ */
PRINT '=== indexes before ===';
SELECT t.name AS TableName, i.name AS IndexName,
       s.user_seeks + s.user_scans + s.user_lookups AS Reads, s.user_updates AS Writes
FROM sys.indexes i
JOIN sys.tables t ON t.object_id = i.object_id
LEFT JOIN sys.dm_db_index_usage_stats s
       ON s.object_id = i.object_id AND s.index_id = i.index_id AND s.database_id = DB_ID()
WHERE t.name IN ('sn_device_commands','sn_device_playlists','sn_devices','sn_playback_logs','sn_system_logs')
  AND i.type > 0
ORDER BY t.name, i.index_id;
GO

/* -- STEP 2: apply --------------------------------------------------------- */

/* 2a. The heartbeat dequeue reads
         WHERE device_id = @actual_id
           AND (status = 'PENDING' OR (status = 'POLLING' AND updated_at < ...))
       IX_sn_device_commands_Pending is FILTERED on status = 'PENDING', so the OR over a second
       status puts this predicate outside the filter and every heartbeat scanned the table --
       inside an UPDATE, so it took update locks on rows it only examined. The missing-index DMV
       reported this exact shape with 36.6 million uses. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sn_device_commands_Dequeue'
               AND object_id = OBJECT_ID('dbo.sn_device_commands'))
BEGIN
    PRINT 'creating IX_sn_device_commands_Dequeue';
    CREATE NONCLUSTERED INDEX [IX_sn_device_commands_Dequeue]
    ON [dbo].[sn_device_commands] ([device_id] ASC, [status] ASC)
    INCLUDE ([updated_at], [command_type], [payload], [created_at], [command_uuid]);
END
ELSE PRINT 'IX_sn_device_commands_Dequeue already present';
GO

/* 2b. sn_device_playlists had nothing but its clustered key on id, while every schedule lookup
       filters device_id + is_active. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sn_device_playlists_device_active'
               AND object_id = OBJECT_ID('dbo.sn_device_playlists'))
BEGIN
    PRINT 'creating IX_sn_device_playlists_device_active';
    CREATE NONCLUSTERED INDEX [IX_sn_device_playlists_device_active]
    ON [dbo].[sn_device_playlists] ([device_id] ASC, [is_active] ASC)
    INCLUDE ([playlist_id], [start_date], [end_date]);
END
ELSE PRINT 'IX_sn_device_playlists_device_active already present';
GO

/* 2c. Sibling inheritance matches branch_code + device_name; nothing indexed that pair. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sn_devices_branch_name'
               AND object_id = OBJECT_ID('dbo.sn_devices'))
BEGIN
    PRINT 'creating IX_sn_devices_branch_name';
    CREATE NONCLUSTERED INDEX [IX_sn_devices_branch_name]
    ON [dbo].[sn_devices] ([branch_code] ASC, [device_name] ASC)
    INCLUDE ([is_deleted], [last_check_in]);
END
ELSE PRINT 'IX_sn_devices_branch_name already present';
GO

/* 2d. Two exact duplicates. Same key columns, no includes, no filters, so the pair does the same
       work twice on every write -- 30 million index maintenance operations each on a table taking
       roughly 5.5 inserts a second. The survivor in each pair is the one declared in the table
       template, so "Re-apply Schema" will not resurrect what is dropped here.

       IX_playback_dup_check == IX_PLAYBACK_LOGS_Reporting  (device_id, media_id, start_time)
       IX_sys_logs_created   == IX_SYSTEM_LOGS_CreatedAt    (created_at) */
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_playback_dup_check'
           AND object_id = OBJECT_ID('dbo.sn_playback_logs'))
BEGIN
    PRINT 'dropping duplicate IX_playback_dup_check';
    DROP INDEX [IX_playback_dup_check] ON [dbo].[sn_playback_logs];
END
ELSE PRINT 'IX_playback_dup_check already gone';
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sys_logs_created'
           AND object_id = OBJECT_ID('dbo.sn_system_logs'))
BEGIN
    PRINT 'dropping duplicate IX_sys_logs_created';
    DROP INDEX [IX_sys_logs_created] ON [dbo].[sn_system_logs];
END
ELSE PRINT 'IX_sys_logs_created already gone';
GO

PRINT '=== indexes after ===';
SELECT t.name AS TableName, i.name AS IndexName
FROM sys.indexes i JOIN sys.tables t ON t.object_id = i.object_id
WHERE t.name IN ('sn_device_commands','sn_device_playlists','sn_devices','sn_playback_logs','sn_system_logs')
  AND i.type > 0
ORDER BY t.name, i.index_id;
GO
