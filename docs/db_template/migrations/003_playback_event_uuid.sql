-- F27 / contract item 4: clients generate one UUID per playback event so ingestion is idempotent.
-- The unique index is filtered so rows from legacy clients (no event id) are unaffected.
IF COL_LENGTH('dbo.sn_playback_logs', 'event_uuid') IS NULL
    ALTER TABLE dbo.sn_playback_logs ADD event_uuid NVARCHAR(36) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_sn_playback_logs_event_uuid'
               AND object_id = OBJECT_ID('dbo.sn_playback_logs'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_sn_playback_logs_event_uuid
        ON dbo.sn_playback_logs (event_uuid) WHERE event_uuid IS NOT NULL;
GO
-- Reports now filter and sort by the playback time (start_time) instead of the server receipt time.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sn_playback_logs_start_time'
               AND object_id = OBJECT_ID('dbo.sn_playback_logs'))
    CREATE NONCLUSTERED INDEX IX_sn_playback_logs_start_time
        ON dbo.sn_playback_logs (start_time) INCLUDE (device_id, media_id, playlist_id, duration_sec, branch_code);
GO
