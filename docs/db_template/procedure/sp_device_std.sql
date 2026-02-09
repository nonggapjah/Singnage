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
        IF EXISTS (SELECT 1 FROM sn_devices WHERE device_uuid = @p_device_uuid AND is_deleted = 0)
        BEGIN
            UPDATE sn_devices
            SET last_check_in = SYSUTCDATETIME(),
                status = 'online',
                ip_address = ISNULL(@p_ip_address, ip_address),
                app_version = ISNULL(@p_app_version, app_version),
                device_name = ISNULL(@p_device_name, device_name), -- Allow rename on login too
                branch_code = ISNULL(@p_branch_code, branch_code)
            WHERE device_uuid = @p_device_uuid;

            SET @msg = N'Device logged in.';
        END
        ELSE
        BEGIN
            IF @p_device_uuid IS NULL SET @p_device_uuid = NEWID();

            INSERT INTO sn_devices
            (device_uuid, device_name, status, branch_code, created_at, is_deleted, app_version, ip_address)
            VALUES
            (@p_device_uuid, ISNULL(@p_device_name,'Unnamed Device'), 'online', ISNULL(@p_branch_code,'1000'), SYSUTCDATETIME(), 0, @p_app_version, @p_ip_address);

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
           SELECT @p_current_playlist_id = playlist_id FROM sn_playlists WHERE playlist_uuid = @p_current_playlist_uuid;

        IF @p_current_media_id IS NULL AND @p_current_media_uuid IS NOT NULL
           SELECT @p_current_media_id = media_id FROM sn_media_files WHERE media_uuid = @p_current_media_uuid;

        UPDATE sn_devices
        SET last_check_in = SYSUTCDATETIME(),
            status = ISNULL(@p_status, 'online'),
            -- NEW: Update Name/Branch if provided
            device_name = ISNULL(@p_device_name, device_name),
            branch_code = ISNULL(@p_branch_code, branch_code),
            
            ip_address = ISNULL(@p_ip_address, ip_address),
            mac_address = ISNULL(@p_mac_address, mac_address),
            app_version = ISNULL(@p_app_version, app_version),
            current_playlist_id = ISNULL(@p_current_playlist_id, current_playlist_id),
            current_playlist_item_id = ISNULL(@p_current_item_id, current_playlist_item_id),
            current_media_id = ISNULL(@p_current_media_id, current_media_id),
            current_position_sec = ISNULL(@p_position_sec, current_position_sec),
            cache_progress = ISNULL(@p_cache_progress, cache_progress),
            last_playback_at = CASE WHEN @p_position_sec IS NOT NULL THEN SYSUTCDATETIME() ELSE last_playback_at END
        WHERE (device_id = @p_device_id OR device_uuid = @p_device_uuid)
          AND is_deleted = 0;

        -- AUTO-REGISTER LOGIC FOR OLD DEVICES
        IF @@ROWCOUNT = 0 AND @p_device_uuid IS NOT NULL
        BEGIN
             INSERT INTO sn_devices
             (device_uuid, device_name, status, branch_code, created_at, is_deleted, last_check_in, ip_address, app_version)
             VALUES
             (@p_device_uuid, ISNULL(@p_device_name, 'Recovered Device'), 'online', ISNULL(@p_branch_code, '1000'), SYSUTCDATETIME(), 0, SYSUTCDATETIME(), @p_ip_address, @p_app_version);

             SET @msg = N'Heartbeat processed (Device Recovered).';
        END
        ELSE
        BEGIN
             SET @msg = N'Heartbeat processed.';
        END

        GOTO ResultSection;
    END

    /* =====================================================
       GET_ALL
    ===================================================== */
    IF @p_action = 'GET_ALL'
    BEGIN
        GOTO ResultSection;
    END

    /* =====================================================
       GET_BY_ID / UUID
    ===================================================== */
    IF @p_action IN ('GET_BY_ID','GET_BY_UUID')
    BEGIN
        GOTO ResultSection;
    END

    /* =====================================================
       DEACTIVATE
    ===================================================== */
    IF @p_action = 'DEACTIVATE'
    BEGIN
        UPDATE sn_devices
        SET status = 'offline', is_deleted = 1,
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
            SELECT * FROM sn_devices WHERE device_uuid = @p_device_uuid;
        END

        IF @p_action = 'GET_ALL'
        BEGIN
            SELECT 
                d.device_id AS DeviceId, 
                d.device_uuid AS DeviceUuid, 
                d.device_uuid AS DeviceKey,
                d.device_name AS DeviceName, 
                d.location AS Location, 
                d.ratio AS Ratio,
                d.branch_code AS BranchCode,
                d.ip_address AS IpAddress,
                
                CASE
                    WHEN d.last_check_in IS NULL THEN 'offline'
                    WHEN DATEDIFF(SECOND, d.last_check_in, SYSUTCDATETIME()) > 90 THEN 'offline' 
                    ELSE d.status
                END AS Status,

                d.current_playlist_id AS CurrentPlaylistId,
                d.current_playlist_item_id AS CurrentPlaylistItemId,
                d.current_media_id AS CurrentMediaId,
                d.current_position_sec AS CurrentPositionSec,
                d.cache_progress AS CacheProgress,
                d.last_check_in AS LastCheckIn,
                'Y' AS Active

            FROM sn_devices d
            WHERE d.is_deleted = 0
            ORDER BY d.last_check_in DESC;
        END

        IF @p_action IN ('GET_BY_ID','GET_BY_UUID')
        BEGIN
            SELECT TOP 1 *
            FROM sn_devices
            WHERE is_deleted = 0
              AND (device_id = @p_device_id OR device_uuid = @p_device_uuid);
        END
        
        IF @p_action = 'COUNT_OFFLINE_ZOMBIES'
        BEGIN
             SELECT Count(*) as Count
             FROM sn_devices
             WHERE is_deleted = 0
               AND (last_check_in IS NULL OR last_check_in < DATEADD(DAY, -@p_cleanup_days, SYSUTCDATETIME()));
        END
    END
END
GO
