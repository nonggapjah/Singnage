SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE OR ALTER PROCEDURE [dbo].[sp_system_log_std]
(
    @p_action           NVARCHAR(50),

    -- log data
    @p_log_level        NVARCHAR(20)   = NULL,
    @p_source_system    NVARCHAR(50)   = NULL,
    @p_category         NVARCHAR(50)   = NULL,
    @p_message          NVARCHAR(MAX)  = NULL,
    @p_stack_trace      NVARCHAR(MAX)  = NULL,
    @p_userid           BIGINT         = NULL,
    @p_ip_address       NVARCHAR(50)   = NULL,

    -- query
    @p_log_id           BIGINT         = NULL,
    @p_start_date       DATETIME2      = NULL,
    @p_end_date         DATETIME2      = NULL,
    @p_page             INT            = 1,
    @p_page_size        INT            = 50,
    @p_top              INT            = 100,
    @p_retention_days   INT            = 30,
    @p_created_at       DATETIME2      = NULL
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
    IF @p_start_date IS NOT NULL SET @p_start_date = DATEADD(HOUR, -7, @p_start_date);
    IF @p_end_date IS NOT NULL SET @p_end_date = DATEADD(HOUR, -7, @p_end_date);

    IF @p_action IS NULL
    BEGIN
        SET @err_code = 99;
        SET @err_flag = 1;
        SET @msg = N'Action required';
        GOTO ResultSection;
    END

    /* =============================================
       INSERT
    ============================================= */
    IF @p_action = 'INSERT'
    BEGIN
        INSERT INTO sn_system_logs
        (
            log_level,
            source_system,
            category,
            message,
            stack_trace,
            user_id,
            ip_address,
            created_at
        )
        VALUES
        (
            ISNULL(@p_log_level, 'Info'),
            ISNULL(@p_source_system, 'Backend'),
            @p_category,
            ISNULL(@p_message, 'No message'),
            @p_stack_trace,
            @p_userid,
            @p_ip_address,
            ISNULL(@p_created_at, SYSUTCDATETIME())
        );

        SET @msg = N'Log inserted';
        GOTO ResultSection;
    END

    /* =============================================
       GET_LATEST
    ============================================= */
    IF @p_action = 'GET_LATEST'
    BEGIN
        GOTO ResultSection;
    END

    /* =============================================
       GET_FILTERED + PAGING
    ============================================= */
    IF @p_action = 'GET_FILTERED'
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
       CLEANUP
    ============================================= */
    IF @p_action = 'CLEANUP'
    BEGIN
        DECLARE @DeletedRows INT = 1;
        
        -- Delete in batches of 5000 to prevent long table locks and log growth issues
        WHILE @DeletedRows > 0
        BEGIN
            DELETE TOP (5000) FROM sn_system_logs
            WHERE created_at < DATEADD(DAY, -@p_retention_days, SYSUTCDATETIME());
            
            SET @DeletedRows = @@ROWCOUNT;
            
            -- Small delay if many batches are expected (optional, but keeps system responsive)
            -- IF @DeletedRows > 0 WAITFOR DELAY '00:00:00.100'; 
        END

        SET @msg = N'Old logs cleaned';
        GOTO ResultSection;
    END

ResultSection:
    -- 1. Status Result Set (Always First)
    SELECT @err_code AS err_code, @err_flag AS err_flag, @msg AS msg;
    
    -- 2. Data Result Set
    IF @err_flag = 0 
    BEGIN
        IF @p_action = 'GET_LATEST'
        BEGIN
            SELECT TOP (@p_top) 
                log_id AS LogId, 
                log_level AS LogLevel, 
                source_system AS SourceSystem, 
                category AS Category, 
                message AS Message, 
                stack_trace AS StackTrace, 
                user_id AS UserId, 
                ip_address AS IpAddress, 
                DATEADD(HOUR, 7, created_at) AS CreatedAt
            FROM sn_system_logs
            ORDER BY created_at DESC;
        END

        IF @p_action = 'GET_FILTERED'
        BEGIN
            SELECT 
                log_id AS LogId, 
                log_level AS LogLevel, 
                source_system AS SourceSystem, 
                category AS Category, 
                message AS Message, 
                stack_trace AS StackTrace, 
                user_id AS UserId, 
                ip_address AS IpAddress, 
                DATEADD(HOUR, 7, created_at) AS CreatedAt
            FROM sn_system_logs
            WHERE
                (@p_start_date IS NULL OR created_at >= @p_start_date)
                AND (@p_end_date IS NULL OR created_at <= @p_end_date)
                AND (@p_log_level IS NULL OR log_level = @p_log_level)
                AND (@p_category IS NULL OR @p_category = '' OR category IN (SELECT [value] FROM STRING_SPLIT(@p_category, ',')))
                AND (@p_source_system IS NULL OR source_system = @p_source_system)
            ORDER BY created_at DESC
            OFFSET (@p_page - 1) * @p_page_size ROWS
            FETCH NEXT @p_page_size ROWS ONLY;
        END

        IF @p_action = 'GET_BY_ID'
        BEGIN
            SELECT 
                log_id AS LogId, 
                log_level AS LogLevel, 
                source_system AS SourceSystem, 
                category AS Category, 
                message AS Message, 
                stack_trace AS StackTrace, 
                user_id AS UserId, 
                ip_address AS IpAddress, 
                DATEADD(HOUR, 7, created_at) AS CreatedAt
            FROM sn_system_logs
            WHERE log_id = @p_log_id;
        END
    END
END
GO
