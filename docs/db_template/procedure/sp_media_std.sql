SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE OR ALTER PROCEDURE [dbo].[sp_media_std]
(
    @p_action             NVARCHAR(50),

    -- Identity / Keys
    @p_media_id           BIGINT        = NULL,
    @p_media_uuid         NVARCHAR(36)  = NULL,
    @p_ref_media_id       BIGINT        = NULL, -- Target/New Media ID for replacement

    -- Media info
    @p_file_name          NVARCHAR(255) = NULL,
    @p_display_name       NVARCHAR(255) = NULL,
    @p_blob_url           NVARCHAR(MAX) = NULL,
    @p_duration_sec       INT           = NULL,
    @p_ratio              NVARCHAR(50)  = NULL,
    @p_file_size_kb       INT           = NULL,
    @p_file_hash          NVARCHAR(100) = NULL,
    @p_supplier_code      NVARCHAR(100) = NULL,
    @p_remark1            NVARCHAR(500) = NULL,
    @p_remark2            NVARCHAR(500) = NULL,
    @p_storage_provider   NVARCHAR(20)  = NULL,
    @p_force_delete       BIT           = 0, -- New parameter for force delete
    @p_end_date           DATETIME2(7)  = NULL, -- New parameter for expiration

    -- Filters (legacy compatible)
    @p_filter_status      NVARCHAR(1)   = NULL, -- kept for compatibility
    @p_media_type         NVARCHAR(20)  = NULL, -- video / image
    @p_search_term        NVARCHAR(100) = NULL,

    -- Audit
    @p_userid             BIGINT        = NULL
)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @err_code INT = 0;
    DECLARE @err_flag BIT = 0;
    DECLARE @msg NVARCHAR(4000) = N'';

    /* =============================================
       RESOLVE ID FROM UUID
    ============================================= */
    IF @p_media_id IS NULL AND @p_media_uuid IS NOT NULL
        SELECT @p_media_id = media_id FROM sn_media_files WHERE media_uuid = @p_media_uuid;

    /* =============================================
       VALIDATION
    ============================================= */
    IF @p_action IS NULL OR @p_action = ''
    BEGIN
        SET @err_code = 99; SET @err_flag = 1;
        SET @msg = N'Action is required.';
        GOTO ResultSection;
    END

    /* =============================================
       GET_ALL  (Legacy compatible)
    ============================================= */
    IF @p_action = 'GET_ALL'
    BEGIN
        -- Logic moved to ResultSection to ensure Status is First
        GOTO ResultSection;
    END

	/* =============================================
	   GET_ACTIVE
	============================================= */
	IF @p_action = 'GET_ACTIVE'
	BEGIN
		-- Logic moved to ResultSection to ensure Status is First
		GOTO ResultSection;
	END


    /* =============================================
       GET_BY_ID
    ============================================= */
    IF @p_action = 'GET_BY_ID'
    BEGIN
        -- Logic moved to ResultSection to ensure Status is First
        GOTO ResultSection;
    END

    /* =============================================
       CREATE
    ============================================= */
    IF @p_action = 'CREATE'
    BEGIN
        IF @p_file_name IS NULL OR @p_blob_url IS NULL
        BEGIN
            SET @err_code = 1; SET @err_flag = 1;
            SET @msg = N'file_name and blob_url are required.';
            GOTO ResultSection;
        END

        IF @p_media_uuid IS NULL SET @p_media_uuid = NEWID();

        INSERT INTO sn_media_files (
            media_uuid, file_name, display_name, blob_url,
            duration_sec, ratio, file_size_kb, supplier_code,
            remark1, remark2, storage_provider, file_hash, end_date, -- Added end_date
            created_at, created_by, is_deleted
        )
        VALUES (
            @p_media_uuid,
            @p_file_name,
            ISNULL(@p_display_name, @p_file_name),
            @p_blob_url,
            ISNULL(@p_duration_sec, 0),
            @p_ratio,
            @p_file_size_kb,
            @p_supplier_code,
            @p_remark1,
            @p_remark2,
            ISNULL(@p_storage_provider, 'local'),
            @p_file_hash,
            @p_end_date, -- Value
            SYSUTCDATETIME(),
            @p_userid,
            0
        );

        SET @p_media_id = SCOPE_IDENTITY();
        SET @msg = N'Media created.';
        GOTO ResultSection;
    END

    /* =============================================
       UPDATE
    ============================================= */
    IF @p_action = 'UPDATE'
    BEGIN
        UPDATE sn_media_files
        SET display_name = ISNULL(@p_display_name, display_name),
            supplier_code = ISNULL(@p_supplier_code, supplier_code),
            remark1 = ISNULL(@p_remark1, remark1),
            remark2 = ISNULL(@p_remark2, remark2),
            end_date = ISNULL(@p_end_date, end_date), -- Update end_date (allows setting to NULL if passed explicitly, or handle in app logic)
            updated_at = SYSUTCDATETIME(),
            updated_by = @p_userid,
			is_deleted = case when @p_filter_status = 'Y' then 0 when @p_filter_status = 'N' then 1 else is_deleted end
        WHERE is_deleted = 0
          AND (media_id = @p_media_id OR media_uuid = @p_media_uuid);

        SET @msg = N'Media updated.';
        GOTO ResultSection;
    END

    /* =============================================
       REPLACE_FILE (Update Content)
    ============================================= */
    IF @p_action = 'REPLACE_FILE'
    BEGIN
        IF @p_blob_url IS NULL
        BEGIN
            SET @err_code = 1; SET @err_flag = 1;
            SET @msg = N'blob_url is required for replacement.';
            GOTO ResultSection;
        END

        UPDATE sn_media_files
        SET file_name     = ISNULL(@p_file_name, file_name),
            blob_url      = @p_blob_url,
            duration_sec  = ISNULL(@p_duration_sec, duration_sec),
            ratio         = ISNULL(@p_ratio, ratio),
            file_size_kb  = ISNULL(@p_file_size_kb, file_size_kb),
            file_hash     = ISNULL(@p_file_hash, file_hash),
            storage_provider = ISNULL(@p_storage_provider, storage_provider),
            end_date      = ISNULL(@p_end_date, end_date), -- Update end_date if provided
            updated_at    = SYSUTCDATETIME(),
            updated_by    = @p_userid
        WHERE is_deleted = 0
          AND (media_id = @p_media_id OR media_uuid = @p_media_uuid);

        SET @msg = N'Media content replaced.';
        GOTO ResultSection;
    END

    /* =============================================
       REPLACE_USAGE (Global Swap)
    ============================================= */
    IF @p_action = 'REPLACE_USAGE'
    BEGIN
        -- Resolve ref_media_id if UUID provided
        IF @p_ref_media_id IS NULL AND @p_media_uuid IS NOT NULL -- Note: using p_media_uuid as target for ref logic if id is null
            SELECT @p_ref_media_id = media_id FROM sn_media_files WHERE media_uuid = @p_media_uuid AND is_deleted = 0;

        -- Validate
        IF @p_ref_media_id IS NULL
        BEGIN
            SET @err_code = 1; SET @err_flag = 1;
            SET @msg = N'New Media ID (ref_media_id) is required for usage replacement.';
            GOTO ResultSection;
        END

        -- Check if target media exists and is active
        IF NOT EXISTS (SELECT 1 FROM sn_media_files WHERE media_id = @p_ref_media_id AND is_deleted = 0)
        BEGIN
             SET @err_code = 2; SET @err_flag = 1;
             SET @msg = N'Target media not found or deleted.';
             GOTO ResultSection;
        END

        -- Perform Atomic Update
        UPDATE sn_playlist_items
        SET media_id = @p_ref_media_id,
            updated_at = SYSUTCDATETIME(),
            updated_by = @p_userid
        WHERE media_id = @p_media_id
          AND is_deleted = 0;

        SET @msg = N'Media usage replaced globally.';
        GOTO ResultSection;
    END

    /* =============================================
       DELETE (Business Safe)
    ============================================= */
    IF @p_action = 'DELETE'
    BEGIN
        -- Check usage in active playlists UNLESS Force Delete is requested
        IF @p_force_delete = 0 AND EXISTS (
            SELECT 1
            FROM sn_playlist_items pi
            JOIN sn_playlists p ON pi.playlist_id = p.playlist_id
            WHERE pi.media_id = @p_media_id
              AND pi.is_deleted = 0
              AND p.is_deleted = 0
        )
        BEGIN
            SET @err_code = 10; SET @err_flag = 1;
            SET @msg = N'Cannot delete media because it is used in active playlist.';
            GOTO ResultSection;
        END

        -- If Force Delete, perform cascading soft-delete on playlist items
        IF @p_force_delete = 1
        BEGIN
            UPDATE sn_playlist_items
            SET is_deleted = 1,
                deleted_at = SYSUTCDATETIME(),
                deleted_by = @p_userid
            WHERE media_id = @p_media_id 
              AND is_deleted = 0;
        END

        UPDATE sn_media_files
        SET is_deleted = 1,
            deleted_at = SYSUTCDATETIME(),
            deleted_by = @p_userid
        WHERE media_id = @p_media_id OR media_uuid = @p_media_uuid;

        SET @msg = N'Media deleted.';
        GOTO ResultSection;
    END

    /* =============================================
       RESTORE (Re-Activate)
    ============================================= */
    IF @p_action = 'RESTORE'
    BEGIN
        UPDATE sn_media_files
        SET is_deleted = 0,
            updated_at = SYSUTCDATETIME(),
            updated_by = @p_userid
        WHERE media_id = @p_media_id OR media_uuid = @p_media_uuid;

        SET @msg = N'Media restored (Activated).';
        GOTO ResultSection;
    END

    /* =============================================
       GET_USAGE (Legacy compatible)
    ============================================= */
    IF @p_action = 'GET_USAGE'
    BEGIN
        -- Logic moved to ResultSection
        GOTO ResultSection;
    END

    /* =============================================
       SYNC_BLOB_URL (Action for ServerController Migration)
    ============================================= */
    IF @p_action = 'SYNC_BLOB_URL'
    BEGIN
        -- Usage: @blob_url = NEW_URL_BASE, @remark1 = TARGET_URL_BASE (to be replaced)
        IF @p_blob_url IS NULL OR @p_remark1 IS NULL
        BEGIN
             SET @err_code = 1; 
             SET @msg = N'blob_url (New URL) and remark1 (Target URL) are required for SYNC_BLOB_URL.';
             GOTO ResultSection;
        END

        UPDATE sn_media_files
        SET blob_url = REPLACE(blob_url, @p_remark1, @p_blob_url),
            updated_at = SYSUTCDATETIME(),
            updated_by = @p_userid
        WHERE blob_url LIKE @p_remark1 + '%';

        SET @msg = N'Media URLs synchronized.';
        GOTO ResultSection;
    END

    SET @err_code = 99; SET @err_flag = 1;
    SET @msg = N'Unknown action.';

ResultSection:
    -- Result Set 1: Status (Always)
    SELECT @err_code AS err_code, @err_flag AS err_flag, @msg AS msg;

    -- Result Set 2: Data (Depends on Action)
    IF @err_flag = 0 
    BEGIN
        IF @p_action IN ('CREATE','UPDATE','GET_BY_ID', 'REPLACE_FILE', 'REPLACE_USAGE')
        BEGIN
            SELECT TOP 1 media_id,media_uuid,file_name,display_name,blob_url,duration_sec,ratio,file_size_kb
				,supplier_code,remark1,remark2,storage_provider,file_hash
				,created_at as UploadedAt,created_by as UploadedBy,updated_at,updated_by,is_deleted,deleted_at,deleted_by
				,row_version,dateadd(HH,+7,end_date) end_date 
			FROM sn_media_files
            WHERE media_id = @p_media_id OR media_uuid = @p_media_uuid;
        END

        IF @p_action = 'GET_ALL'
        BEGIN
            SELECT media_id,media_uuid,file_name,display_name,blob_url,duration_sec,ratio,file_size_kb
				,supplier_code,remark1,remark2,storage_provider,file_hash
				,created_at as UploadedAt,created_by as UploadedBy,updated_at,updated_by,is_deleted,deleted_at,deleted_by
				,row_version,dateadd(HH,+7,end_date) end_date
				, CASE WHEN is_deleted = 1 THEN 'N' ELSE 'Y' END AS Active
            FROM sn_media_files
            WHERE 
                (@p_filter_status IS NULL OR
                 (@p_filter_status = 'Y' AND is_deleted = 0) OR
                 (@p_filter_status = 'N' AND is_deleted = 1) OR
                 (@p_filter_status = '') 
                )
              AND (@p_supplier_code IS NULL OR supplier_code = @p_supplier_code)
              AND (@p_remark1 IS NULL OR remark1 LIKE '%' + @p_remark1 + '%')
              AND (@p_remark2 IS NULL OR remark2 LIKE '%' + @p_remark2 + '%')
              AND (
                    @p_search_term IS NULL
                    OR file_name LIKE '%' + @p_search_term + '%'
                    OR display_name LIKE '%' + @p_search_term + '%'
                    OR supplier_code LIKE '%' + @p_search_term + '%'
                    OR remark1 LIKE '%' + @p_search_term + '%'
                    OR remark2 LIKE '%' + @p_search_term + '%'
              )
              AND (
                    @p_media_type IS NULL
                    OR (@p_media_type = 'video' AND file_name LIKE '%.mp4')
                    OR (@p_media_type = 'image' AND (
                            file_name LIKE '%.jpg' OR
                            file_name LIKE '%.jpeg' OR
                            file_name LIKE '%.png' OR
                            file_name LIKE '%.webp'
                    ))
              )
            ORDER BY updated_at DESC, created_at DESC;
        END

        IF @p_action = 'GET_ACTIVE'
        BEGIN
            SELECT media_id,media_uuid,file_name,display_name,blob_url,duration_sec,ratio,file_size_kb
				,supplier_code,remark1,remark2,storage_provider,file_hash
				,created_at as UploadedAt,created_by as UploadedBy,updated_at,updated_by,is_deleted,deleted_at,deleted_by
				,row_version,dateadd(HH,+7,end_date) end_date
            FROM sn_media_files
            WHERE is_deleted = 0
              AND (@p_supplier_code IS NULL OR supplier_code = @p_supplier_code)
              AND (
                    @p_search_term IS NULL
                    OR file_name LIKE '%' + @p_search_term + '%'
                    OR display_name LIKE '%' + @p_search_term + '%'
                    OR supplier_code LIKE '%' + @p_search_term + '%'
                    OR remark1 LIKE '%' + @p_search_term + '%'
                    OR remark2 LIKE '%' + @p_search_term + '%'
              )
              AND (
                    @p_media_type IS NULL
                    OR (@p_media_type = 'video' AND (
                            file_name LIKE '%.mp4' OR
                            file_name LIKE '%.webm'
                    ))
                    OR (@p_media_type = 'image' AND (
                            file_name LIKE '%.jpg' OR
                            file_name LIKE '%.jpeg' OR
                            file_name LIKE '%.png' OR
                            file_name LIKE '%.webp'
                    ))
              )
            ORDER BY created_at DESC;
        END

        IF @p_action = 'GET_USAGE'
        BEGIN
             SELECT
                p.playlist_id,
                p.playlist_name,
                CASE WHEN p.status = 'active' THEN 'Y' ELSE 'N' END AS Active,
                COUNT(pi.playlist_item_id) AS usage_count,
                (SELECT ISNULL(SUM(ISNULL(pi2.duration_override, m2.duration_sec)), 0) 
                 FROM sn_playlist_items pi2 
                 JOIN sn_media_files m2 ON pi2.media_id = m2.media_id 
                 WHERE pi2.playlist_id = p.playlist_id AND pi2.is_deleted = 0) AS duration_sec,
                (SELECT COUNT(*) FROM sn_devices d WHERE d.current_playlist_id = p.playlist_id AND d.is_deleted = 0) AS device_count
            FROM sn_playlist_items pi
            JOIN sn_playlists p ON pi.playlist_id = p.playlist_id
            WHERE pi.media_id = @p_media_id
              AND pi.is_deleted = 0
            GROUP BY p.playlist_id, p.playlist_name, p.status;
        END
    END
END
GO
