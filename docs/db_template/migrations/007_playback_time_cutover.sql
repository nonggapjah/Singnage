-- Contract T7 / Codex round-2 finding 17 / round-3 finding 4.
-- The retired sp_playback_log_std subtracted 7 hours from EVERY submitted playedAt (clients always
-- sent UTC), so every row that exists when this deploy lands is exactly 7 hours early. The new
-- procedure stores the value unchanged and reports now filter on start_time, so without this
-- correction all history would show 7 hours early. Recorded once in sn_schema_migrations and run
-- BEFORE the new procedures are applied, so no unshifted row can exist yet.
--
-- Resumable and never double-shifts: each 5000-id batch and the checkpoint that records it commit
-- in ONE transaction. If the API is restarted or the statement times out half-way, the next run
-- continues from the committed checkpoint; rows after it are untouched, rows before it were shifted
-- exactly once. The completion marker is written in the same transaction as the last batch and
-- makes the whole script a no-op afterwards.
SET XACT_ABORT ON;

IF NOT EXISTS (SELECT 1 FROM dbo.sn_system_settings WHERE config_key = 'PlaybackTimeCutoverUtc')
BEGIN
    DECLARE @batch BIGINT = 5000;
    DECLARE @max BIGINT, @last BIGINT, @to BIGINT;

    -- The highest id that existed when the cutover started (rows ingested later by the new procedure
    -- are already correct and must never be shifted).
    SELECT @max = MAX(playback_id) FROM dbo.sn_playback_logs;

    SELECT @last = TRY_CAST(config_value AS BIGINT)
    FROM dbo.sn_system_settings WHERE config_key = 'PlaybackTimeCutoverLastId';

    IF @last IS NULL
    BEGIN
        SET @last = 0;
        -- A checkpoint of 0 committed before any batch, so a crash before the first batch commits
        -- resumes from the start and a crash after it resumes after it.
        INSERT INTO dbo.sn_system_settings (config_key, config_value, description, updated_at)
        VALUES ('PlaybackTimeCutoverLastId', '0', 'Migration 007 progress: highest playback_id already shifted +7h.', SYSUTCDATETIME());
        -- Also freeze @max so a resumed run never shifts rows ingested after the cutover began.
        INSERT INTO dbo.sn_system_settings (config_key, config_value, description, updated_at)
        VALUES ('PlaybackTimeCutoverMaxId', CONVERT(NVARCHAR(40), ISNULL(@max, 0)), 'Migration 007: highest playback_id that existed when the cutover started.', SYSUTCDATETIME());
    END
    ELSE
    BEGIN
        SELECT @max = TRY_CAST(config_value AS BIGINT)
        FROM dbo.sn_system_settings WHERE config_key = 'PlaybackTimeCutoverMaxId';
    END

    WHILE @max IS NOT NULL AND @last < @max
    BEGIN
        SET @to = @last + @batch;
        IF @to > @max SET @to = @max;

        BEGIN TRANSACTION;

        UPDATE dbo.sn_playback_logs
        SET start_time = DATEADD(HOUR, 7, start_time),
            end_time   = CASE WHEN end_time IS NULL THEN NULL ELSE DATEADD(HOUR, 7, end_time) END
        WHERE playback_id > @last AND playback_id <= @to;

        UPDATE dbo.sn_system_settings
        SET config_value = CONVERT(NVARCHAR(40), @to), updated_at = SYSUTCDATETIME()
        WHERE config_key = 'PlaybackTimeCutoverLastId';

        IF @to >= @max
        BEGIN
            -- Last batch: the completion marker commits together with it.
            INSERT INTO dbo.sn_system_settings (config_key, config_value, description, updated_at)
            VALUES ('PlaybackTimeCutoverUtc', CONVERT(NVARCHAR(40), SYSUTCDATETIME(), 127),
                    'Rows with start_time before this were shifted +7h once by migration 007 (old procedure stored them 7h early).',
                    SYSUTCDATETIME());
        END

        COMMIT TRANSACTION;

        SET @last = @to;
    END

    -- Empty table (or nothing left to shift): write the marker so the script never runs again.
    IF NOT EXISTS (SELECT 1 FROM dbo.sn_system_settings WHERE config_key = 'PlaybackTimeCutoverUtc')
    BEGIN
        INSERT INTO dbo.sn_system_settings (config_key, config_value, description, updated_at)
        VALUES ('PlaybackTimeCutoverUtc', CONVERT(NVARCHAR(40), SYSUTCDATETIME(), 127),
                'Rows with start_time before this were shifted +7h once by migration 007 (old procedure stored them 7h early).',
                SYSUTCDATETIME());
    END

    DELETE FROM dbo.sn_system_settings WHERE config_key IN ('PlaybackTimeCutoverLastId', 'PlaybackTimeCutoverMaxId');
END
GO
