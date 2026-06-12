USE [SignageUnicornDB]
GO

/****** Object:  StoredProcedure [dbo].[sp_device_std]    Script Date: 2026-01-15 ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE OR ALTER PROCEDURE [dbo].[sp_device_std]
(
    @p_action              NVARCHAR(50),

    -- Device Identity
    @p_device_id           BIGINT        = NULL,
    @p_device_uuid         NVARCHAR(36)  = NULL,
    @p_device_name         NVARCHAR(255) = NULL,
	@p_branch_code         NVARCHAR(50)  = NULL,

    -- Runtime / Meta
    @p_location            NVARCHAR(255) = NULL,
    @p_ratio               NVARCHAR(50)  = NULL,
    @p_status              NVARCHAR(20)  = NULL,
    @p_ip_address          NVARCHAR(50)  = NULL,
    @p_mac_address         NVARCHAR(50)  = NULL,
    @p_app_version         NVARCHAR(50)  = NULL,

    -- Playback
    @p_current_playlist_id BIGINT        = NULL,
    @p_current_playlist_uuid NVARCHAR(36)= NULL,
    @p_current_item_id     BIGINT        = NULL,
    @p_current_item_uuid   NVARCHAR(36)  = NULL,
    @p_current_media_id    BIGINT        = NULL,
    @p_current_media_uuid  NVARCHAR(36)  = NULL,
    @p_position_sec        INT           = NULL,
    @p_cache_progress      INT           = NULL,

    -- Command
    @p_command_type        NVARCHAR(50)  = NULL,
    @p_command_id          BIGINT        = NULL,

    -- Audit
    @p_userid              BIGINT        = NULL,
    
    -- Config
    @p_cleanup_days        INT           = 14
)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @err_code INT = 0;
    DECLARE @err_flag BIT = 0;
    DECLARE @msg NVARCHAR(4000) = N'';
    
    -- Table Variable for Command Polling (Used in HEARTBEAT)
    DECLARE @PollTbl TABLE (
        CommandId BIGINT,
        CommandUuid NVARCHAR(36),
        DeviceCommandId NVARCHAR(36),
        DeviceId BIGINT,
        CommandType NVARCHAR(50),
        Payload NVARCHAR(MAX),
        Status NVARCHAR(20),
        CreatedAt DATETIME2
    );

    IF @p_cleanup_days IS NULL SET @p_cleanup_days = 14; 

    IF @p_action IS NULL OR @p_action = ''
    BEGIN
        SET @err_code = 99; SET @err_flag = 1; SET @msg = N'Action required';
        GOTO ResultSection;
    END

    /* =====================================================
       REGISTER_OR_LOGIN
    ===================================================== */
    IF @p_action = 'REGISTER_OR_LOGIN'
    BEGIN
        -- TACTICAL FIX: If the UUID provided looks like a numeric ID (vulnerably saved by old frontend),
        -- try to resolve it back to the proper string UUID of that record.
        IF TRY_CAST(@p_device_uuid AS BIGINT) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sn_devices WITH (NOLOCK) WHERE device_uuid = @p_device_uuid AND is_deleted = 0)
        BEGIN
             SELECT TOP 1 @p_device_uuid = device_uuid FROM sn_devices WITH (NOLOCK) WHERE device_id = TRY_CAST(@p_device_uuid AS BIGINT) AND is_deleted = 0;
        END

        IF EXISTS (SELECT 1 FROM sn_devices WITH (NOLOCK) WHERE device_uuid = @p_device_uuid AND is_deleted = 0)
        BEGIN
            UPDATE sn_devices
            SET last_check_in = SYSUTCDATETIME(),
                status = 'ONLINE',
                ip_address = ISNULL(@p_ip_address, ip_address),
                app_version = ISNULL(@p_app_version, app_version),
                device_name = ISNULL(@p_device_name, device_name), -- Allow rename on login too
                branch_code = ISNULL(@p_branch_code, branch_code),
                location = ISNULL(@p_location, location)
            WHERE device_uuid = @p_device_uuid;

            SET @msg = N'Device logged in.';
        END
        ELSE
        BEGIN
            -- Final check: if we somehow tried to register with a UUID that IS a number matching an ID, we prevent it.
            IF TRY_CAST(@p_device_uuid AS BIGINT) IS NOT NULL
                SET @p_device_uuid = NEWID(); -- Force generation if collision with ID space

            IF @p_device_uuid IS NULL SET @p_device_uuid = NEWID();

            INSERT INTO sn_devices
            (device_uuid, device_name, status, branch_code, created_at, is_deleted, app_version, ip_address, location, ratio, last_check_in)
            VALUES
            (@p_device_uuid, ISNULL(@p_device_name,'Unnamed Device'), 'ONLINE', ISNULL(@p_branch_code,'1000'), SYSUTCDATETIME(), 0, @p_app_version, @p_ip_address, @p_location, @p_ratio, SYSUTCDATETIME());

            SET @msg = N'Device registered.';
        END

        GOTO ResultSection;
    END

    /* =====================================================
       HEARTBEAT  (Auto-Registration + Dynamic Rename)
    ===================================================== */
    IF @p_action = 'HEARTBEAT'
    BEGIN
        -- Resolve IDs from UUIDs if provided
        IF @p_current_playlist_id IS NULL AND @p_current_playlist_uuid IS NOT NULL
           SELECT @p_current_playlist_id = playlist_id FROM sn_playlists WITH (NOLOCK) WHERE playlist_uuid = @p_current_playlist_uuid;

        IF @p_current_media_id IS NULL AND @p_current_media_uuid IS NOT NULL
           SELECT @p_current_media_id = media_id FROM sn_media_files WITH (NOLOCK) WHERE media_uuid = @p_current_media_uuid;

        -- DATA CLEANUP: (Existing logic kept for safety)
        IF TRY_CAST(@p_device_uuid AS BIGINT) IS NOT NULL
        BEGIN
             DECLARE @real_uuid NVARCHAR(36);
             SELECT TOP 1 @real_uuid = device_uuid FROM sn_devices WITH (NOLOCK) WHERE device_id = TRY_CAST(@p_device_uuid AS BIGINT) AND is_deleted = 0;
             
             IF @real_uuid IS NOT NULL AND @real_uuid <> @p_device_uuid
             BEGIN
                  UPDATE sn_devices SET is_deleted = 1, status = 'OFFLINE' WHERE device_uuid = @p_device_uuid;
                  SET @p_device_uuid = @real_uuid;
                  SET @p_device_id = TRY_CAST(@real_uuid AS BIGINT);
             END
        END

        UPDATE sn_devices
        SET last_check_in = SYSUTCDATETIME(),
            status = UPPER(ISNULL(@p_status, 'ONLINE')),
            device_name = ISNULL(@p_device_name, device_name),
            branch_code = ISNULL(@p_branch_code, branch_code),
            location = ISNULL(@p_location, location),
            ratio = ISNULL(@p_ratio, ratio),
            ip_address = ISNULL(@p_ip_address, ip_address),
            mac_address = ISNULL(@p_mac_address, mac_address),
            app_version = ISNULL(@p_app_version, app_version),
            current_playlist_id = ISNULL(@p_current_playlist_id, current_playlist_id),
            current_playlist_item_id = ISNULL(@p_current_item_id, current_playlist_item_id),
            current_media_id = ISNULL(@p_current_media_id, current_media_id),
            current_position_sec = ISNULL(@p_position_sec, current_position_sec),
            cache_progress = ISNULL(@p_cache_progress, cache_progress),
            last_playback_at = CASE WHEN @p_position_sec IS NOT NULL THEN SYSUTCDATETIME() ELSE last_playback_at END
        WHERE device_id = @p_device_id 
           OR (@p_device_id IS NULL AND device_uuid = @p_device_uuid)
           AND is_deleted = 0;

        IF @@ROWCOUNT = 0 AND @p_device_uuid IS NOT NULL
        BEGIN
             INSERT INTO sn_devices
             (device_uuid, device_name, status, branch_code, created_at, is_deleted, last_check_in, ip_address, app_version)
             VALUES
             (@p_device_uuid, ISNULL(@p_device_name, 'Recovered Device'), 'ONLINE', ISNULL(@p_branch_code, '1000'), SYSUTCDATETIME(), 0, SYSUTCDATETIME(), @p_ip_address, @p_app_version);

             SET @msg = N'Heartbeat processed (Device Recovered).';
        END
        ELSE
        BEGIN
             SET @msg = N'Heartbeat processed.';
        END

        -- Execute Command Polling Logic BEFORE ResultSection!
        DECLARE @actual_id BIGINT;
        SELECT TOP 1 @actual_id = device_id 
        FROM sn_devices WITH (NOLOCK) 
        WHERE is_deleted = 0 AND (device_id = @p_device_id OR device_uuid = @p_device_uuid);

        -- Expire stale POLLING commands that have been active for more than 3 minutes
        UPDATE sn_device_commands
        SET status = 'EXPIRED',
            updated_at = SYSUTCDATETIME(),
            fail_reason = 'Command execution timed out (3 minutes in POLLING status)'
        WHERE device_id = @actual_id 
          AND status = 'POLLING' 
          AND updated_at < DATEADD(MINUTE, -3, SYSUTCDATETIME());

        UPDATE sn_device_commands
        SET status = CASE 
                        WHEN command_type IN ('REFRESH', 'RELOAD', 'WIPE_CACHE', 'REBOOT', 'UPDATE_CLIENT') OR command_type LIKE 'RESTART%' THEN 'EXECUTED'
                        ELSE 'POLLING'
                     END,
            executed_at = CASE 
                             WHEN command_type IN ('REFRESH', 'RELOAD', 'WIPE_CACHE', 'REBOOT', 'UPDATE_CLIENT') OR command_type LIKE 'RESTART%' THEN SYSUTCDATETIME()
                             ELSE executed_at
                          END,
            updated_at = SYSUTCDATETIME()
        OUTPUT 
            INSERTED.command_id AS CommandId,
            INSERTED.command_uuid AS CommandUuid,
            INSERTED.command_uuid AS DeviceCommandId, -- Alias for DTO
            INSERTED.device_id AS DeviceId,
            INSERTED.command_type AS CommandType,
            INSERTED.payload AS Payload,
            INSERTED.status AS Status,
            INSERTED.created_at AS CreatedAt
        INTO @PollTbl
        WHERE device_id = @actual_id AND (status = 'PENDING' OR (status = 'POLLING' AND updated_at < DATEADD(SECOND, -30, SYSUTCDATETIME())));

        GOTO ResultSection;
    END

    /* =====================================================
       GET_ALL
    ===================================================== */
    IF @p_action = 'GET_ALL'
    BEGIN
        -- PERFORMANCE NOTE: Removed synchronous UPDATE of 'OFFLINE' status here.
        -- Status is calculated dynamically in the ResultSection using DATEDIFF.
        -- This prevents table locking when dashboard polls frequently.
        GOTO ResultSection;
    END

    /* =====================================================
       GET_BY_ID / UUID
    ===================================================== */
    IF @p_action IN ('GET_BY_ID','GET_BY_UUID')
    BEGIN
         -- PERFORMANCE NOTE: Removed synchronous UPDATE of 'OFFLINE' status.
        GOTO ResultSection;
    END

    /* =====================================================
       DEACTIVATE
    ===================================================== */
    IF @p_action = 'DEACTIVATE'
    BEGIN
        UPDATE sn_devices
        SET status = 'OFFLINE', is_deleted = 1,
            deleted_at = SYSUTCDATETIME(), deleted_by = @p_userid
        WHERE device_id = @p_device_id OR device_uuid = @p_device_uuid;

        SET @msg = N'Device deactivated.';
        GOTO ResultSection;
    END

    /* =====================================================
       CLEANUP_OFFLINE
    ===================================================== */
    IF @p_action = 'CLEANUP_OFFLINE'
    BEGIN
        UPDATE sn_devices
        SET is_deleted = 1, deleted_at = SYSUTCDATETIME()
        WHERE is_deleted = 0
          AND (last_check_in IS NULL OR last_check_in < DATEADD(DAY, -@p_cleanup_days, SYSUTCDATETIME()));

        SET @msg = N'Offline devices cleaned.';
        GOTO ResultSection;
    END
    
    /* =====================================================
       COUNT_OFFLINE_ZOMBIES (NEW)
    ===================================================== */
    IF @p_action = 'COUNT_OFFLINE_ZOMBIES'
    BEGIN
        -- Just set message, select happens in ResultSection
        SET @msg = N'Count calculated.';
        GOTO ResultSection;
    END

    SET @err_code = 99; SET @err_flag = 1; SET @msg = N'Unknown action';

ResultSection:
    -- 1. Status Result Set
    SELECT @err_code AS err_code, @err_flag AS err_flag, @msg AS msg;
    
    -- 2. Data Result Set
    IF @err_flag = 0 
    BEGIN
        IF @p_action = 'REGISTER_OR_LOGIN'
        BEGIN
            SELECT 
                CAST(d.device_id AS NVARCHAR(36)) AS DeviceId, 
                d.device_uuid AS DeviceUuid, 
                d.device_uuid AS DeviceKey,
                d.device_name AS DeviceName, 
                d.location AS Location, 
                d.ratio AS Ratio,
                d.branch_code AS BranchCode,
                d.ip_address AS IpAddress,
                d.status AS Status,
                CAST(d.current_playlist_id AS NVARCHAR(36)) AS CurrentPlaylistId,
                CAST(d.current_playlist_item_id AS NVARCHAR(36)) AS CurrentPlaylistItemId,
                CAST(d.current_media_id AS NVARCHAR(36)) AS CurrentMediaId,
                d.current_position_sec AS CurrentPositionSec,
                d.cache_progress AS CacheProgress,
                d.app_version AS AppVersion,
                d.last_check_in AS LastCheckIn,
                'Y' AS Active
            FROM sn_devices d WITH (NOLOCK) 
            WHERE d.device_uuid = @p_device_uuid;
        END

        IF @p_action = 'HEARTBEAT'
        BEGIN
            SELECT 
                CAST(CommandId AS NVARCHAR(36)) AS CommandId,
                CommandUuid,
                DeviceCommandId,
                CAST(DeviceId AS NVARCHAR(36)) AS DeviceId,
                CommandType,
                Payload,
                Status,
                CreatedAt
            FROM @PollTbl 
            ORDER BY CreatedAt ASC;
        END

        IF @p_action = 'GET_ALL'
        BEGIN
            SELECT 
                CAST(d.device_id AS NVARCHAR(36)) AS DeviceId, 
                d.device_uuid AS DeviceUuid, 
                d.device_uuid AS DeviceKey,
                d.device_name AS DeviceName, 
                d.location AS Location, 
                d.ratio AS Ratio,
                d.branch_code AS BranchCode,
                d.ip_address AS IpAddress,
                
                CASE
                    WHEN d.last_check_in IS NULL THEN 'OFFLINE'
                    WHEN DATEDIFF(SECOND, d.last_check_in, SYSUTCDATETIME()) > 60 THEN 'OFFLINE' 
                    ELSE d.status
                END AS Status,

                CAST(d.current_playlist_id AS NVARCHAR(36)) AS CurrentPlaylistId,
                CAST(d.current_playlist_item_id AS NVARCHAR(36)) AS CurrentPlaylistItemId,
                CAST(d.current_media_id AS NVARCHAR(36)) AS CurrentMediaId,
                d.current_position_sec AS CurrentPositionSec,
                d.cache_progress AS CacheProgress,
                d.app_version AS AppVersion,
                d.last_check_in AS LastCheckIn,
                'Y' AS Active

            FROM sn_devices d WITH (NOLOCK)
            WHERE d.is_deleted = 0
            ORDER BY d.last_check_in DESC;
        END

        IF @p_action IN ('GET_BY_ID','GET_BY_UUID')
        BEGIN
            SELECT TOP 1 
                CAST(d.device_id AS NVARCHAR(36)) AS DeviceId, 
                d.device_uuid AS DeviceUuid, 
                d.device_uuid AS DeviceKey,
                d.device_name AS DeviceName, 
                d.location AS Location, 
                d.ratio AS Ratio,
                d.branch_code AS BranchCode,
                d.ip_address AS IpAddress,
                CASE
                    WHEN d.last_check_in IS NULL THEN 'OFFLINE'
                    WHEN DATEDIFF(SECOND, d.last_check_in, SYSUTCDATETIME()) > 60 THEN 'OFFLINE' 
                    ELSE d.status
                END AS Status,
                CAST(d.current_playlist_id AS NVARCHAR(36)) AS CurrentPlaylistId,
                CAST(d.current_playlist_item_id AS NVARCHAR(36)) AS CurrentPlaylistItemId,
                CAST(d.current_media_id AS NVARCHAR(36)) AS CurrentMediaId,
                d.current_position_sec AS CurrentPositionSec,
                d.cache_progress AS CacheProgress,
                d.app_version AS AppVersion,
                d.last_check_in AS LastCheckIn,
                'Y' AS Active
            FROM sn_devices d WITH (NOLOCK)
            WHERE d.is_deleted = 0
              AND (d.device_id = @p_device_id OR d.device_uuid = @p_device_uuid);
        END
        
        IF @p_action = 'COUNT_OFFLINE_ZOMBIES'
        BEGIN
             SELECT Count(*) as Count
             FROM sn_devices WITH (NOLOCK)
             WHERE is_deleted = 0
               AND (last_check_in IS NULL OR last_check_in < DATEADD(DAY, -@p_cleanup_days, SYSUTCDATETIME()));
        END
    END
END
GO
