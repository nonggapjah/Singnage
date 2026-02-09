SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE OR ALTER PROCEDURE [dbo].[sp_system_settings_std]
(
    @p_action    NVARCHAR(50),
    @p_key       NVARCHAR(50)  = NULL, -- Matches config_key length
    @p_value     NVARCHAR(MAX) = NULL, -- Matches config_value length
    @p_userid    BIGINT        = NULL
)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @err_code INT = 0;
    DECLARE @err_flag BIT = 0;
    DECLARE @msg NVARCHAR(4000) = N'';

    IF @p_action IS NULL
    BEGIN
        SET @err_code = 99; SET @err_flag = 1; SET @msg = N'Action required';
        GOTO ResultSection;
    END

    /* =============================================
       GET
    ============================================= */
    IF @p_action = 'GET'
    BEGIN
        -- Logic in ResultSection
        GOTO ResultSection;
    END

    /* =============================================
       SET
    ============================================= */
    IF @p_action = 'SET'
    BEGIN
        IF @p_key IS NULL
        BEGIN
             SET @err_code = 1; SET @err_flag = 1; SET @msg = N'Key required';
             GOTO ResultSection;
        END

        -- Upsert Logic (Merge)
        MERGE sn_system_settings AS target
        USING (SELECT @p_key AS config_key) AS source
        ON (target.config_key = source.config_key)
        WHEN MATCHED THEN
            UPDATE SET 
                config_value = @p_value, 
                updated_at = SYSUTCDATETIME(), 
                updated_by = @p_userid
        WHEN NOT MATCHED THEN
            INSERT (config_key, config_value, updated_at, updated_by)
            VALUES (@p_key, @p_value, SYSUTCDATETIME(), @p_userid);
        
        SET @msg = N'Setting saved.';
        GOTO ResultSection;
    END

    /* =============================================
       GET_ALL
    ============================================= */
    IF @p_action = 'GET_ALL'
    BEGIN
        GOTO ResultSection;
    END

    SET @err_code = 99; SET @err_flag = 1; SET @msg = N'Unknown action';

ResultSection:
    -- 1. Status Result Set
    SELECT @err_code AS err_code, @err_flag AS err_flag, @msg AS msg;

    -- 2. Data Result Set
    IF @err_flag = 0 
    BEGIN
        IF @p_action = 'GET'
        BEGIN
            SELECT config_value 
            FROM sn_system_settings 
            WHERE config_key = @p_key;
        END

        IF @p_action = 'GET_ALL'
        BEGIN
            SELECT config_key, config_value, updated_at
            FROM sn_system_settings;
        END
    END
END
GO
