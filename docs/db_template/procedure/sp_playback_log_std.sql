USE [SignageUnicornDB]
GO
/****** Object:  StoredProcedure [dbo].[sp_playback_log_std]    Script Date: 02/13/2026 3:13:58 PM ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
ALTER   PROCEDURE [dbo].[sp_playback_log_std]
(
    @p_action           NVARCHAR(50),
    
    -- Filter / Data Input
    @p_device_id        BIGINT         = NULL,
    @p_device_uuid      NVARCHAR(36)   = NULL,
    @p_media_id         BIGINT         = NULL,
    @p_media_uuid       NVARCHAR(36)   = NULL,
    @p_playlist_id      BIGINT         = NULL,
    @p_playlist_uuid    NVARCHAR(36)   = NULL,
    @p_start_time       DATETIME2(7)   = NULL,
    @p_end_time         DATETIME2(7)   = NULL,
    @p_duration_sec     INT            = NULL,
    @p_status           NVARCHAR(20)   = NULL,
    @p_error_message    NVARCHAR(500)  = NULL,
    @p_top              INT            = 100
)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @err_code INT = 0;
    DECLARE @err_flag BIT = 0;

    DECLARE @msg NVARCHAR(4000) = N'';


    /* =============================================
       TIMEZONE ADJUSTMENT (Local +7 -> UTC)
    ============================================= */
    IF @p_start_time IS NOT NULL SET @p_start_time = DATEADD(HOUR, -7, @p_start_time);
    IF @p_end_time IS NOT NULL SET @p_end_time = DATEADD(HOUR, -7, @p_end_time);

    /* =============================================
       RESOLVE IDs FROM UUIDs (Support API Consumers)
    ============================================= */
    IF @p_device_id IS NULL AND @p_device_uuid IS NOT NULL
        SELECT @p_device_id = device_id FROM sn_devices WHERE device_uuid = @p_device_uuid;

    IF @p_media_id IS NULL AND @p_media_uuid IS NOT NULL
        SELECT @p_media_id = media_id FROM sn_media_files WHERE media_uuid = @p_media_uuid;
        
    IF @p_playlist_id IS NULL AND @p_playlist_uuid IS NOT NULL
        SELECT @p_playlist_id = playlist_id FROM sn_playlists WHERE playlist_uuid = @p_playlist_uuid;

    -- Safety Check: If Device ID or Media ID is unknown (e.g. invalid UUID sent), abort
    IF (@p_device_id IS NULL OR @p_media_id IS NULL) AND @p_action = 'INSERT'
    BEGIN
        SET @err_code = 404; 
        SET @err_flag = 1; 
        SET @msg = N'Device or Media not found (Invalid ID/UUID)'; 
        GOTO ResultSection; 
    END

    -- Validation
    IF @p_action IS NULL BEGIN 
        SET @err_code = 99; SET @err_flag = 1; SET @msg = N'Action required'; 
        GOTO ResultSection; 
    END

    /* =====================================================
       INSERT (Proof of Play) + Auto-Update Device Status
    ===================================================== */
    IF @p_action = 'INSERT'
    BEGIN
        -- 1. Snapshot branch_code
        DECLARE @v_branch_code NVARCHAR(50); -- select * from sn_devices
        SELECT @v_branch_code = branch_code FROM sn_devices WHERE device_id = @p_device_id;

        -- 1.1 Deduplication / Idempotency Check
        -- Prevent inserting if same device + same media was logged within last 10 seconds
        DECLARE @v_check_time DATETIME2(7) = ISNULL(@p_start_time, SYSUTCDATETIME());
        
        IF EXISTS (
            SELECT 1 FROM sn_playback_logs 
            WHERE device_id = @p_device_id 
            AND media_id = @p_media_id 
            AND start_time >= DATEADD(SECOND, -10, @v_check_time)
            AND start_time <= DATEADD(SECOND, 10, @v_check_time)
        )
        BEGIN
            SET @msg = N'Duplicate skipped';
            GOTO ResultSection;
        END

        -- 2. Insert into sn_playback_logs
        DECLARE @v_start_time DATETIME2(7) = ISNULL(@p_start_time, SYSUTCDATETIME());
        DECLARE @v_end_time DATETIME2(7) = ISNULL(@p_end_time, DATEADD(SECOND, ISNULL(@p_duration_sec, 0), @v_start_time));

        INSERT INTO sn_playback_logs 
        (device_id, media_id, playlist_id, start_time, end_time, duration_sec, branch_code, status, error_message, created_at)
        VALUES 
        (@p_device_id, @p_media_id, @p_playlist_id, 
         @v_start_time, @v_end_time, 
         @p_duration_sec, @v_branch_code, 
         ISNULL(@p_status, 'completed'), @p_error_message, SYSUTCDATETIME());
        
        -- 3. Update Device status
        UPDATE sn_devices 
        SET last_check_in = SYSUTCDATETIME(), 
            last_playback_at = SYSUTCDATETIME(), 
            status = 'online'
        WHERE device_id = @p_device_id;

        SET @msg = N'Recorded successfully';
        GOTO ResultSection;
    END

    /* =====================================================
       GET_LATEST / GET_BY_DEVICE
    ===================================================== */
    IF @p_action IN ('GET_LATEST', 'GET_BY_DEVICE')
    BEGIN
        GOTO ResultSection;
    END

    /* =====================================================
       GET_SUMMARY (Group by Media)
    ===================================================== */
    IF @p_action = 'GET_SUMMARY'
    BEGIN
        GOTO ResultSection;
    END

    /* =====================================================
       GET_BRANCH_SUMMARY
    ===================================================== */
    IF @p_action = 'GET_BRANCH_SUMMARY'
    BEGIN
        GOTO ResultSection;
    END

    /* =====================================================
       GET_EXPORT_DATA (Full Report)
    ===================================================== */
    IF @p_action = 'GET_EXPORT_DATA'
    BEGIN
        GOTO ResultSection;
    END

    /* =====================================================
       CLEANUP (Maintenance - Delete Old Logs in Batches)
       ===================================================== */
    IF @p_action = 'CLEANUP'
    BEGIN
        DECLARE @v_retention_days INT = ISNULL(@p_duration_sec, 30);
        DECLARE @DeletedRows INT = 1;

        -- Delete in batches of 5000 to prevent transaction log full and table locking
        WHILE @DeletedRows > 0
        BEGIN
            DELETE TOP (5000) FROM sn_playback_logs
            WHERE created_at < DATEADD(DAY, -@v_retention_days, SYSUTCDATETIME());

            SET @DeletedRows = @@ROWCOUNT;
        END

        SET @msg = N'Old playback logs cleaned';
        GOTO ResultSection;
    END

    SET @err_code = 99; SET @err_flag = 1; SET @msg = N'Unknown action';

ResultSection:
    -- 1. Status Result Set (Always First)
    SELECT @err_code AS err_code, @err_flag AS err_flag, @msg AS msg;

    -- 2. Data Result Set
    IF @err_flag = 0 
    BEGIN
        IF @p_action IN ('GET_LATEST', 'GET_BY_DEVICE')
        BEGIN
            SELECT TOP (@p_top) 
                pl.playback_id AS LogId,
                pl.device_id AS DeviceId,
                pl.media_id AS MediaId,
                pl.playlist_id AS PlaylistId,
                DATEADD(HOUR, 7, pl.created_at) AS PlayedAt,
                pl.duration_sec AS Duration,
                pl.status AS Result,
                pl.error_message AS ErrorMessage,
                d.device_name AS DeviceName,
                m.display_name AS MediaName
            FROM sn_playback_logs pl
            LEFT JOIN sn_devices d ON pl.device_id = d.device_id
            LEFT JOIN sn_media_files m ON pl.media_id = m.media_id
            WHERE (@p_action = 'GET_LATEST' OR pl.device_id = @p_device_id)
            ORDER BY pl.created_at DESC;
        END

        IF @p_action = 'GET_SUMMARY'
        BEGIN
            SELECT 
                m.display_name AS DisplayName, 
                m.file_name AS FileName,
                COUNT(pl.playback_id) AS PlayCount, 
                SUM(pl.duration_sec) AS TotalDurationSec,
                MAX(DATEADD(HOUR, 7, pl.created_at)) AS LastPlayed
            FROM sn_playback_logs pl
            INNER JOIN sn_media_files m ON pl.media_id = m.media_id
            WHERE (@p_start_time IS NULL OR pl.created_at >= @p_start_time)
              AND (@p_end_time IS NULL OR pl.created_at <= @p_end_time)
            GROUP BY m.display_name, m.file_name
            ORDER BY PlayCount DESC;
        END

        IF @p_action = 'GET_BRANCH_SUMMARY'
        BEGIN
            SELECT 
                ISNULL(pl.branch_code, 'Unknown') AS BranchCode, 
                COUNT(pl.playback_id) AS PlayCount,
                COUNT(DISTINCT pl.device_id) AS DeviceCount
            FROM sn_playback_logs pl
            WHERE (@p_start_time IS NULL OR pl.created_at >= @p_start_time)
              AND (@p_end_time IS NULL OR pl.created_at <= @p_end_time)
            GROUP BY pl.branch_code
            ORDER BY PlayCount DESC;
        END

        IF @p_action = 'GET_EXPORT_DATA'
        BEGIN
            SELECT 
                DATEADD(HOUR, 7, pl.created_at) AS PlayedAt,
                pl.device_id AS DeviceId,
                d.device_name AS DeviceName,
                pl.branch_code AS BranchCode,
                m.supplier_code AS SupplierCode,
                pl.playlist_id AS PlaylistId,
				p.playlist_name AS PlaylistName,
				pl.media_id AS MediaId,
                m.display_name AS MediaName,
                m.file_name AS FileName,
                pl.duration_sec AS DurationSec,
                CASE WHEN isnull(pl.error_message,'') = '' THEN pl.status ELSE pl.error_message END AS Result
            FROM sn_playback_logs pl
            LEFT JOIN sn_devices d ON pl.device_id = d.device_id
            LEFT JOIN sn_media_files m ON pl.media_id = m.media_id
			LEFT JOIN sn_playlists p ON pl.playlist_id = p.playlist_id
            WHERE (@p_start_time IS NULL OR pl.created_at >= @p_start_time)
              AND (@p_end_time IS NULL OR pl.created_at <= @p_end_time)
            ORDER BY pl.created_at DESC;
        END
    END
END