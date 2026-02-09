SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE OR ALTER PROCEDURE [dbo].[sp_playlist_std]
(
    @p_action                 NVARCHAR(50),

    -- Playlist
    @p_playlist_id            BIGINT        = NULL,
    @p_playlist_uuid          NVARCHAR(36)  = NULL,
    @p_playlist_name          NVARCHAR(255) = NULL,
    @p_description            NVARCHAR(500) = NULL,
    @p_active_only            BIT           = 0,

    -- Item
    @p_playlist_item_uuid     NVARCHAR(36)  = NULL,
    @p_media_id               BIGINT        = NULL,
    @p_media_uuid             NVARCHAR(36)  = NULL,
    @p_position_order         INT           = NULL,
    @p_duration_override      INT           = NULL,

    -- Audit
    @p_userid                 BIGINT        = NULL
)
AS
BEGIN
    SET ARITHABORT ON;
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @err_code INT = 0;
    DECLARE @err_flag BIT = 0;
    DECLARE @msg NVARCHAR(4000) = N'';

    /* =============================================
       Resolve playlist_id from UUID
    ============================================= */
    IF @p_playlist_id IS NULL AND @p_playlist_uuid IS NOT NULL
        SELECT @p_playlist_id = playlist_id FROM sn_playlists WHERE playlist_uuid = @p_playlist_uuid;

    IF @p_media_id IS NULL AND @p_media_uuid IS NOT NULL
        SELECT @p_media_id = media_id FROM sn_media_files WHERE media_uuid = @p_media_uuid;

    /* =============================================
       GET_ALL (Legacy compatible)
    ============================================= */
    IF @p_action = 'GET_ALL'
    BEGIN
        GOTO ResultSection;
    END

    /* =============================================
       GET_BY_ID
    ============================================= */
    IF @p_action = 'GET_BY_ID'
    BEGIN
        GOTO ResultSection;
    END

    /* =============================================
       CREATE
    ============================================= */
    IF @p_action = 'CREATE'
    BEGIN
        IF @p_playlist_uuid IS NULL SET @p_playlist_uuid = NEWID();

        INSERT INTO sn_playlists (
            playlist_uuid, playlist_name, description,
            status, created_at, created_by, is_deleted
        )
        VALUES (
            @p_playlist_uuid, @p_playlist_name, @p_description,
            'active', SYSUTCDATETIME(), @p_userid, 0
        );
        
        SET @msg = N'Playlist created.';
        GOTO ResultSection;
    END

    /* =============================================
       UPDATE
    ============================================= */
    IF @p_action = 'UPDATE'
    BEGIN
        UPDATE sn_playlists
        SET playlist_name = ISNULL(@p_playlist_name, playlist_name),
            description   = ISNULL(@p_description, description),
            status        = CASE WHEN @p_active_only = 1 THEN 'active' ELSE 'inactive' END,
            updated_at    = SYSUTCDATETIME(),
            updated_by    = @p_userid
        WHERE playlist_id = @p_playlist_id AND is_deleted = 0;
        
        SET @msg = N'Playlist updated.';
        GOTO ResultSection;
    END

    /* =============================================
       DELETE_PLAYLIST (Legacy name)
    ============================================= */
    IF @p_action = 'DELETE_PLAYLIST'
    BEGIN
        UPDATE sn_playlists
        SET is_deleted = 1, deleted_at = SYSUTCDATETIME(), deleted_by = @p_userid
        WHERE playlist_id = @p_playlist_id;

        UPDATE sn_playlist_items
        SET is_deleted = 1, deleted_at = SYSUTCDATETIME(), deleted_by = @p_userid
        WHERE playlist_id = @p_playlist_id;
        
        SET @msg = N'Playlist deleted.';
        GOTO ResultSection;
    END

    /* =============================================
       GET_ITEMS
    ============================================= */
    IF @p_action = 'GET_ITEMS'
    BEGIN
        GOTO ResultSection;
    END

    /* =============================================
       ADD_ITEM
    ============================================= */
    IF @p_action = 'ADD_ITEM'
    BEGIN
        IF @p_playlist_item_uuid IS NULL SET @p_playlist_item_uuid = NEWID();
        IF @p_position_order IS NULL
            SELECT @p_position_order = ISNULL(MAX(position_order),0)+1
            FROM sn_playlist_items WHERE playlist_id = @p_playlist_id AND is_deleted = 0;

        INSERT INTO sn_playlist_items (
            playlist_item_uuid, playlist_id, media_id,
            position_order, duration_override,
            created_at, created_by, is_deleted
        )
        VALUES (
            @p_playlist_item_uuid, @p_playlist_id, @p_media_id,
            @p_position_order, @p_duration_override,
            SYSUTCDATETIME(), @p_userid, 0
        );

        -- Return UUID to Caller in Data Section
        SET @msg = N'Item added.';
        GOTO ResultSection;
    END

    /* =============================================
       REMOVE_ITEM
    ============================================= */
    IF @p_action = 'REMOVE_ITEM'
    BEGIN
        UPDATE sn_playlist_items
        SET is_deleted = 1, deleted_at = SYSUTCDATETIME(), deleted_by = @p_userid
        WHERE playlist_item_uuid = @p_playlist_item_uuid;
        
        SET @msg = N'Item removed.';
        GOTO ResultSection;
    END

    /* =============================================
       REORDER_ITEMS
    ============================================= */
    IF @p_action = 'REORDER_ITEMS'
    BEGIN
        UPDATE sn_playlist_items
        SET position_order = @p_position_order,
            updated_at = SYSUTCDATETIME(),
            updated_by = @p_userid
        WHERE playlist_item_uuid = @p_playlist_item_uuid;
        
        SET @msg = N'Item reordered.';
        GOTO ResultSection;
    END

    /* =============================================
       CLEAR_ITEMS
    ============================================= */
    IF @p_action = 'CLEAR_ITEMS'
    BEGIN
        UPDATE sn_playlist_items
        SET is_deleted = 1, deleted_at = SYSUTCDATETIME(), deleted_by = @p_userid
        WHERE playlist_id = @p_playlist_id;
        
        SET @msg = N'Items cleared.';
        GOTO ResultSection;
    END

    /* =============================================
       DELETE_BY_MEDIA
    ============================================= */
    IF @p_action = 'DELETE_BY_MEDIA'
    BEGIN
        UPDATE sn_playlist_items
        SET is_deleted = 1, deleted_at = SYSUTCDATETIME(), deleted_by = @p_userid
        WHERE media_id = @p_media_id;
        
        SET @msg = N'Items deleted by media.';
        GOTO ResultSection;
    END

    SET @err_code = 99; SET @err_flag = 1;
    SET @msg = N'Unknown action.';

ResultSection:
    -- 1. Status Result Set
    SELECT @err_code AS err_code, @err_flag AS err_flag, @msg AS msg;

    -- 2. Data Result Set
    IF @err_flag = 0 
    BEGIN
        IF @p_action = 'GET_ALL'
        BEGIN
            SELECT
                p.*,
                CASE WHEN p.status = 'active' THEN 'Y' ELSE 'N' END AS active,
                ItemCount = (
                    SELECT COUNT(*)
                    FROM sn_playlist_items pi
                    WHERE pi.playlist_id = p.playlist_id AND pi.is_deleted = 0
                ),
                TotalDuration = (
                    SELECT ISNULL(SUM(ISNULL(pi.duration_override, m.duration_sec)), 0)
                    FROM sn_playlist_items pi
                    JOIN sn_media_files m ON pi.media_id = m.media_id
                    WHERE pi.playlist_id = p.playlist_id
                      AND pi.is_deleted = 0
                      AND m.is_deleted = 0
                )
            FROM sn_playlists p
            WHERE p.is_deleted = 0
              AND (@p_active_only = 0 OR p.status = 'active')
              AND (@p_playlist_name IS NULL OR p.playlist_name LIKE '%' + @p_playlist_name + '%' OR p.description LIKE '%' + @p_playlist_name + '%')
            ORDER BY p.created_at DESC;
        END

        IF @p_action = 'GET_BY_ID'
        BEGIN
            SELECT
                p.*,
                CASE WHEN p.status = 'active' THEN 'Y' ELSE 'N' END AS active,
                ItemCount = (
                    SELECT COUNT(*) FROM sn_playlist_items pi
                    WHERE pi.playlist_id = p.playlist_id AND pi.is_deleted = 0
                ),
                TotalDuration = (
                    SELECT ISNULL(SUM(ISNULL(pi.duration_override, m.duration_sec)), 0)
                    FROM sn_playlist_items pi
                    JOIN sn_media_files m ON pi.media_id = m.media_id
                    WHERE pi.playlist_id = p.playlist_id AND pi.is_deleted = 0 AND m.is_deleted = 0
                )
            FROM sn_playlists p
            WHERE p.playlist_id = @p_playlist_id AND p.is_deleted = 0;
        END

        IF @p_action = 'GET_ITEMS'
        BEGIN
            SELECT
                pi.playlist_item_uuid,
                pi.position_order,
                pi.duration_override,
                m.media_id,
                m.media_uuid,
                m.file_name,
                m.display_name,
                m.blob_url,
                m.duration_sec AS original_duration,
                m.ratio,
                m.file_size_kb,
                m.created_at AS uploaded_at,
                m.supplier_code,
                m.remark1,
                m.remark2
            FROM sn_playlist_items pi
            JOIN sn_media_files m ON pi.media_id = m.media_id
            WHERE pi.playlist_id = @p_playlist_id
              AND pi.is_deleted = 0
              AND m.is_deleted = 0
            ORDER BY pi.position_order;
        END

        IF @p_action = 'ADD_ITEM'
        BEGIN
            SELECT @p_playlist_item_uuid AS playlist_item_uuid;
        END
    END
END
GO
