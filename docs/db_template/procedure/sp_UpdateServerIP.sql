USE [SignageUnicornDB]
GO
/****** Object:  StoredProcedure [dbo].[sp_update_server_ip_std]    Script Date: 09/01/2026 13:22:34 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER OFF
GO
-- =============================================
-- Smart Procedure for Updating Server IP (Standard)
-- Usage: EXEC sp_update_server_ip_std '192.168.31.65'
-- =============================================

CREATE OR ALTER PROCEDURE [dbo].[sp_update_server_ip_std]
    @p_new_ip NVARCHAR(50),
    @p_port INT = 8862
AS
BEGIN
    SET NOCOUNT ON;
    
    -- Format New Base URL (e.g., http://192.168.31.65:8862)
    DECLARE @NewBaseUrl NVARCHAR(100) = 'http://' + @p_new_ip + ':' + CAST(@p_port AS NVARCHAR(10));
    PRINT 'Target Server URL: ' + @NewBaseUrl;

    -- =============================================
    -- 1. Standard Cleanup (Known Localhosts)
    -- =============================================
    UPDATE sn_media_files 
    SET blob_url = REPLACE(blob_url, 'http://localhost:5018', @NewBaseUrl) 
    WHERE blob_url LIKE 'http://localhost:5018%';

    UPDATE sn_media_files 
    SET blob_url = REPLACE(blob_url, 'http://localhost:8862', @NewBaseUrl) 
    WHERE blob_url LIKE 'http://localhost:8862%';

    UPDATE sn_media_files 
    SET blob_url = REPLACE(blob_url, 'http://127.0.0.1:5018', @NewBaseUrl) 
    WHERE blob_url LIKE 'http://127.0.0.1:5018%';

    -- =============================================
    -- 2. SMART MIGRATION (Dynamic IP Detection)
    -- Finds ANY 'http://192.168.x.x:port' that is NOT the new one and replaces it.
    -- =============================================
    DECLARE @OldUrl NVARCHAR(200);
    DECLARE @UpdateCount INT = 0;

    DECLARE url_cursor CURSOR FOR
    SELECT DISTINCT 
        LEFT(blob_url, CHARINDEX('/', blob_url, 8) - 1) -- Extract 'http://ip:port'
    FROM sn_media_files
    WHERE blob_url LIKE 'http://192.168.%:%'  -- Look for Local IP patterns
      AND LEFT(blob_url, CHARINDEX('/', blob_url, 8) - 1) <> @NewBaseUrl; -- Exclude target if already set

    OPEN url_cursor;
    FETCH NEXT FROM url_cursor INTO @OldUrl;

    WHILE @@FETCH_STATUS = 0
    BEGIN
        PRINT 'Found Old IP: ' + @OldUrl + ' -> Migrating to: ' + @NewBaseUrl;
        
        -- Dynamic SQL to Replace
        DECLARE @Sql NVARCHAR(MAX);
        SET @Sql = 'UPDATE sn_media_files SET blob_url = REPLACE(blob_url, ''' + @OldUrl + ''', ''' + @NewBaseUrl + ''') WHERE blob_url LIKE ''' + @OldUrl + '%''';
        
        EXEC sp_executesql @Sql;
        SET @UpdateCount = @UpdateCount + 1;

        FETCH NEXT FROM url_cursor INTO @OldUrl;
    END

    CLOSE url_cursor;
    DEALLOCATE url_cursor;

    -- =============================================
    -- 3. Update System Settings (if exists)
    -- =============================================
    IF EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[sn_system_settings]'))
    BEGIN
        EXEC sp_system_settings_std 'SET', 'ServerBaseUrl', @NewBaseUrl;
    END

    -- =============================================
    -- 4. Summary
    -- =============================================
    IF @UpdateCount > 0
        PRINT 'Migration Completed Successfully.';
    ELSE
        PRINT 'No old IPs found. Database is already up to date.';

END
