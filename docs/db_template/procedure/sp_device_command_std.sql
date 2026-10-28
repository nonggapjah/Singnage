USE [SignageUnicornDB]
GO

/****** Object:  StoredProcedure [dbo].[sp_device_command_std]    Script Date: 2026-01-13 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE OR ALTER PROCEDURE [dbo].[sp_device_command_std]
    @p_action NVARCHAR(50),
    @p_command_id BIGINT = NULL,
    @p_command_uuid NVARCHAR(36) = NULL,
    @p_device_id BIGINT = NULL,
    @p_device_uuid NVARCHAR(36) = NULL,
    @p_command_type NVARCHAR(50) = NULL,
    @p_payload NVARCHAR(MAX) = NULL,
    @p_status NVARCHAR(20) = NULL,
    @p_userid BIGINT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @err_code INT = 0;
    DECLARE @err_flag BIT = 0;
    DECLARE @msg NVARCHAR(4000) = N'';


    -- =============================================
    -- VALIDATION
    -- =============================================
    IF @p_action IS NULL
    BEGIN
        SET @err_code = 99; SET @err_flag = 1; SET @msg = N'Action required';
        GOTO ResultSection;
    END

    /* =============================================
       CREATE (Enqueue Command)
    ============================================= */
    IF @p_action = 'CREATE'
    BEGIN
        -- Resolve Device ID if UUID is passed
        IF @p_device_id IS NULL AND @p_device_uuid IS NOT NULL
           SELECT @p_device_id = device_id FROM sn_devices WHERE device_uuid = @p_device_uuid;

        IF @p_device_id IS NULL
        BEGIN
            SET @err_code = 2; SET @err_flag = 1; SET @msg = N'Device not found';
            GOTO ResultSection;
        END

        -- Round 4 (#5): a second SYNC_SCHEDULE / FORCE_SYNC is pointless while an identical command
        -- is still UNDELIVERED (PENDING): the device fetches the current schedule when it picks that
        -- one up. A POLLING (already delivered) command must NOT suppress a new one -- it may have
        -- carried the previous schedule, and its later acknowledgement would leave nothing behind
        -- that delivers the change. Reported as success so callers treat it as queued.
        IF @p_command_type IN ('SYNC_SCHEDULE', 'FORCE_SYNC')
           AND EXISTS (SELECT 1 FROM sn_device_commands
                       WHERE device_id = @p_device_id AND command_type = @p_command_type AND status = 'PENDING')
        BEGIN
            SET @msg = N'Command already queued (undelivered)';
            GOTO ResultSection;
        END

        IF @p_command_uuid IS NULL SET @p_command_uuid = NEWID();

        INSERT INTO sn_device_commands (command_uuid, device_id, command_type, payload, status, created_at, created_by)
        VALUES (@p_command_uuid, @p_device_id, @p_command_type, @p_payload, 'PENDING', SYSUTCDATETIME(), @p_userid);

        SET @msg = N'Command queued';
        GOTO ResultSection;
    END

    /* =============================================
       POLL (Get Pending Commands for Device)
    ============================================= */
    IF @p_action = 'POLL_PENDING'
    BEGIN
        -- Used by Device Agent to check for work
        IF @p_device_id IS NULL AND @p_device_uuid IS NOT NULL
           SELECT @p_device_id = device_id FROM sn_devices WHERE device_uuid = @p_device_uuid;

        -- We will capture the output in a table variable to return it AFTER standard status
        DECLARE @OutputTbl TABLE (
            CommandId BIGINT,
            CommandUuid NVARCHAR(36),
            DeviceId BIGINT,
            CommandType NVARCHAR(50),
            Payload NVARCHAR(MAX),
            Status NVARCHAR(20),
            CreatedAt DATETIME2
        );

        -- Contract item 2: delivery is not execution. The command becomes POLLING (leased) and the
        -- device reports EXECUTED/FAILED through ACKNOWLEDGE. It used to be marked EXECUTED here, so
        -- a lost response lost the command for good.
        UPDATE TOP (10) sn_device_commands
        SET status = 'POLLING',
            updated_at = SYSUTCDATETIME()
        OUTPUT
            INSERTED.command_id,
            INSERTED.command_uuid,
            INSERTED.device_id,
            INSERTED.command_type,
            INSERTED.payload,
            INSERTED.status,
            INSERTED.created_at
        INTO @OutputTbl
        WHERE device_id = @p_device_id AND status = 'PENDING';

        GOTO ResultSection;
    END

    /* =============================================
       ACKNOWLEDGE (Mark as Executed/Failed)
    ============================================= */
    IF @p_action = 'ACKNOWLEDGE'
    BEGIN
        -- Contract item 2: the command must belong to the device acknowledging it. The update used
        -- to match on the command alone, so any caller could close any other screen's command.
        IF @p_device_id IS NULL AND @p_device_uuid IS NOT NULL
           SELECT @p_device_id = device_id FROM sn_devices WHERE device_uuid = @p_device_uuid AND is_deleted = 0;

        IF @p_device_id IS NULL
        BEGIN
            SET @err_code = 404; SET @err_flag = 1; SET @msg = N'Device not found';
            GOTO ResultSection;
        END

        DECLARE @ack_status NVARCHAR(20) = UPPER(ISNULL(@p_status, 'EXECUTED'));
        IF @ack_status NOT IN ('EXECUTED', 'FAILED') SET @ack_status = 'EXECUTED';

        UPDATE sn_device_commands
        SET status = @ack_status,
            executed_at = CASE WHEN @ack_status = 'EXECUTED' THEN SYSUTCDATETIME() ELSE executed_at END,
            fail_reason = CASE WHEN @ack_status = 'FAILED' THEN LEFT(ISNULL(@p_payload, N'Reported FAILED by device'), 4000) ELSE fail_reason END,
            updated_at = SYSUTCDATETIME(),
            updated_by = @p_userid
        WHERE (command_id = @p_command_id OR command_uuid = @p_command_uuid)
          AND device_id = @p_device_id;

        IF @@ROWCOUNT = 0
        BEGIN
            SET @err_code = 404; SET @err_flag = 1; SET @msg = N'Command not found for this device';
            GOTO ResultSection;
        END

        SET @msg = N'Command acknowledged';
        GOTO ResultSection;
    END

    /* =============================================
       EXPIRE (Maintenance)
    ============================================= */
    IF @p_action = 'EXPIRE_OLD'
    BEGIN
        -- 1. Mark commands older than 24h as expired if still pending
        UPDATE sn_device_commands
        SET status = 'EXPIRED',
            updated_at = SYSUTCDATETIME()
        WHERE status = 'PENDING'
          AND created_at < DATEADD(HOUR, -24, SYSUTCDATETIME());

        -- 2. Mark commands in POLLING status for more than 2 hours as EXPIRED
        UPDATE sn_device_commands
        SET status = 'EXPIRED',
            updated_at = SYSUTCDATETIME()
        WHERE status = 'POLLING'
          AND updated_at < DATEADD(HOUR, -2, SYSUTCDATETIME());

        -- 3. Delete finished commands older than 30 days
        DELETE FROM sn_device_commands
        WHERE status IN ('EXECUTED', 'EXPIRED', 'FAILED')
          AND created_at < DATEADD(DAY, -30, SYSUTCDATETIME());

        SET @msg = N'Expired old commands and cleaned up logs';
        GOTO ResultSection;
    END

    SET @err_code = 99; SET @err_flag = 1; SET @msg = N'Unknown action';

ResultSection:
    -- 1. Status Result Set
    SELECT @err_code AS err_code, @err_flag AS err_flag, @msg AS msg;

    -- 2. Data Result Set
    IF @err_flag = 0
    BEGIN
        IF @p_action = 'POLL_PENDING'
        BEGIN
            -- Select from captured table variable
             SELECT
                CommandId,
                CommandUuid,
                CommandUuid AS DeviceCommandId, -- Alias for DTO if needed
                DeviceId,
                CommandType,
                Payload,
                Status,
                CreatedAt
            FROM @OutputTbl
            ORDER BY CreatedAt ASC;
        END
    END
END
GO
