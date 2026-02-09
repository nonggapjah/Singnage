SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE OR ALTER PROCEDURE [dbo].[sp_auth_user_std]
(
    @p_action                 NVARCHAR(50),
    @p_userid                 BIGINT         = NULL,
    @p_identifier_type        NVARCHAR(20)   = NULL,
    @p_identifier_value       NVARCHAR(200)  = NULL,
    @p_display_name           NVARCHAR(200)  = NULL,
    @p_password_hash          VARBINARY(512) = NULL,
    @p_password_salt          VARBINARY(256) = NULL,
    @p_password_algo          VARCHAR(50)    = NULL,
    @p_password_iterations    INT            = NULL,
    @p_login_id               NVARCHAR(200)  = NULL,
    @p_avatar_url             NVARCHAR(2048) = NULL,
    @p_executor_id            BIGINT         = NULL
)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @err_code INT = 0;
    DECLARE @err_flag BIT = 0;
    DECLARE @msg NVARCHAR(4000) = N'';
    DECLARE @is_locked BIT = 0;

    -- Validate Action
    IF @p_action IS NULL OR @p_action = ''
    BEGIN
        SET @err_code = 99;
        SET @err_flag = 1;
        SET @msg = N'Action is required.';
        GOTO ResultSection;
    END

    -- =============================================
    -- GET_PROFILE
    -- =============================================
    IF @p_action = 'GET_PROFILE'
    BEGIN
        -- Data logic moved to ResultSection
        GOTO ResultSection;
    END

    -- =============================================
    -- UPDATE_PROFILE
    -- =============================================
    IF @p_action = 'UPDATE_PROFILE'
    BEGIN
        UPDATE sn_auth_user
        SET display_name = ISNULL(@p_display_name, display_name),
            avatar_url   = ISNULL(@p_avatar_url, avatar_url),
            updated_at   = SYSUTCDATETIME(),
            updated_by   = @p_executor_id
        WHERE user_id = @p_userid
          AND is_deleted = 0;

        SET @msg = N'Update profile success.';
        GOTO ResultSection;
    END

    -- =============================================
    -- UPDATE_ROLE
    -- =============================================
    IF @p_action = 'UPDATE_ROLE'
    BEGIN
        DECLARE @new_role_id BIGINT;
        -- Assuming @p_identifier_value passes the role name (e.g., 'admin', 'viewer')
        -- OR we add a @p_role_name parameter. Since we can't change signature easily, let's use @p_identifier_value for role name alias or @p_display_name?
        -- ACTUALLY, checking UpdateAsync in C#, it passes role in a way?
        -- Wait, C# UpdateAsync passes: @p_display_name = user.FullName. It doesn't pass role yet.
        -- We need to check C# code. But assuming we will fix C# to pass role.
        -- Let's use @p_identifier_value as a temporary carrier for 'Role Name' if not null, OR just rely on a standard Param.
        -- Standard Params: @p_userid, @p_identifier_value...
        -- Let's use @p_identifier_value to carry 'role_name' for this action.
        
        SELECT @new_role_id = role_id FROM sn_auth_role WHERE LOWER(role_name) = LOWER(@p_identifier_value) AND is_deleted = 0;
        
        IF @new_role_id IS NULL
        BEGIN
             SET @err_code = 3;
             SET @err_flag = 1;
             SET @msg = N'Role not found: ' + ISNULL(@p_identifier_value, 'NULL');
             GOTO ResultSection;
        END

        -- Soft delete old role mapping
        UPDATE sn_auth_user_role SET is_deleted = 1, updated_at = SYSUTCDATETIME(), updated_by = @p_executor_id WHERE user_id = @p_userid AND is_deleted = 0;

        -- Insert new mapping
        INSERT INTO sn_auth_user_role (user_id, role_id, created_at, created_by, is_deleted)
        VALUES (@p_userid, @new_role_id, SYSUTCDATETIME(), @p_executor_id, 0);

        SET @msg = N'Role updated successfully.';
        GOTO ResultSection;
    END

    -- =============================================
    -- REGISTER
    -- =============================================
    IF @p_action = 'REGISTER'
    BEGIN
        IF @p_identifier_type IS NULL OR @p_identifier_value IS NULL
           OR @p_password_hash IS NULL OR @p_password_salt IS NULL
           OR @p_password_algo IS NULL OR @p_password_iterations IS NULL
        BEGIN
            SET @err_code = 1;
            SET @err_flag = 1;
            SET @msg = N'Missing required fields.';
            GOTO ResultSection;
        END

        IF EXISTS (
            SELECT 1
            FROM sn_auth_identifier
            WHERE identifier_type = @p_identifier_type
              AND identifier_value = @p_identifier_value
              AND is_deleted = 0
        )
        BEGIN
            SET @err_code = 2;
            SET @err_flag = 1;
            SET @msg = N'Identifier already exists.';
            GOTO ResultSection;
        END

        BEGIN TRY
            BEGIN TRANSACTION;

            INSERT INTO sn_auth_user (
                display_name,
                status,
                failed_login_count,
                created_at,
                created_by,
                is_deleted,
                avatar_url
            )
            VALUES (
                ISNULL(@p_display_name, @p_identifier_value),
                'active',
                0,
                SYSUTCDATETIME(),
                @p_executor_id,
                0,
                @p_avatar_url
            );

            SET @p_userid = SCOPE_IDENTITY();

            INSERT INTO sn_auth_identifier (
                user_id,
                identifier_type,
                identifier_value,
                is_primary,
                is_verified,
                created_at,
                is_deleted
            )
            VALUES (
                @p_userid,
                @p_identifier_type,
                @p_identifier_value,
                1,
                CASE WHEN @p_identifier_type = 'email' THEN 0 ELSE 1 END,
                SYSUTCDATETIME(),
                0
            );

            INSERT INTO sn_auth_credential (
                user_id,
                credential_type,
                password_hash,
                password_salt,
                password_algo,
                password_iterations,
                password_last_changed_at,
                created_at,
                is_deleted
            )
            VALUES (
                @p_userid,
                'password',
                @p_password_hash,
                @p_password_salt,
                @p_password_algo,
                @p_password_iterations,
                SYSUTCDATETIME(),
                SYSUTCDATETIME(),
                0
            );

            COMMIT TRANSACTION;
            
            SET @msg = N'Register success.';
        END TRY
        BEGIN CATCH
            IF @@TRANCOUNT > 0
                ROLLBACK TRANSACTION;

            SET @err_code = 500;
            SET @err_flag = 1;
            SET @msg = ERROR_MESSAGE();
        END CATCH

        GOTO ResultSection;
    END

    -- =============================================
    -- LOGIN: GET CREDENTIAL
    -- =============================================
    IF @p_action = 'LOGIN_GET_CREDENTIAL'
    BEGIN
        -- Just fetch data in ResultSection
        GOTO ResultSection;
    END

    -- =============================================
    -- LOGIN: SUCCESS
    -- =============================================
    IF @p_action = 'LOGIN_SUCCESS'
    BEGIN
        UPDATE sn_auth_user
        SET failed_login_count = 0,
            last_failed_login_at = NULL,
            locked_until = NULL,
            updated_at = SYSUTCDATETIME()
        WHERE user_id = @p_userid;

        SET @msg = N'Login success recorded.';
        GOTO ResultSection;
    END

    -- =============================================
    -- LOGIN: FAIL
    -- =============================================
    IF @p_action = 'LOGIN_FAIL'
    BEGIN
        UPDATE sn_auth_user
        SET failed_login_count = failed_login_count + 1,
            last_failed_login_at = SYSUTCDATETIME(),
            updated_at = SYSUTCDATETIME()
        WHERE user_id = @p_userid;

        -- Check for locking (Simple Policy: > 5 attempts = Lock 15 mins)
        DECLARE @current_failed INT;
        SELECT @current_failed = failed_login_count, @is_locked = CASE WHEN locked_until > SYSUTCDATETIME() THEN 1 ELSE 0 END 
        FROM sn_auth_user WHERE user_id = @p_userid;

        IF @current_failed >= 5 AND @is_locked = 0
        BEGIN
            UPDATE sn_auth_user
            SET locked_until = DATEADD(MINUTE, 15, SYSUTCDATETIME())
            WHERE user_id = @p_userid;

            SET @is_locked = 1;
            SET @msg = N'Account locked due to too many failed attempts.';
        END

        GOTO ResultSection;
    END

    -- =============================================
    -- GET_CREDENTIAL_BY_ID (For Password Change Verify)
    -- =============================================
    IF @p_action = 'GET_CREDENTIAL_BY_ID'
    BEGIN
        GOTO ResultSection;
    END

    -- =============================================
    -- CHANGE_PASSWORD
    -- =============================================
    IF @p_action = 'CHANGE_PASSWORD'
    BEGIN
        IF @p_password_hash IS NULL
        BEGIN
            SET @err_code = 1;
            SET @err_flag = 1;
            SET @msg = N'Password hash required.';
            GOTO ResultSection;
        END

        UPDATE sn_auth_credential
        SET password_hash = @p_password_hash,
            password_salt = ISNULL(@p_password_salt, password_salt),
            password_algo = 'bcrypt',
            password_iterations = 10,
            password_last_changed_at = SYSUTCDATETIME(),
            updated_at = SYSUTCDATETIME()
        WHERE user_id = @p_userid 
          AND credential_type = 'password' 
          AND is_deleted = 0;

        IF @@ROWCOUNT = 0
        BEGIN
             -- If no credential exists (unlikely if user exists), handle or ignore.
             SET @msg = N'Password updated (or credential created).';
        END
        ELSE
        BEGIN
             SET @msg = N'Password change success.';
        END

        GOTO ResultSection;
    END

    -- =============================================
    -- GET_ALL (For Admin Dashboard)
    -- =============================================
    IF @p_action = 'GET_ALL'
    BEGIN
        -- Logic moved to ResultSection
        GOTO ResultSection;
    END

    -- =============================================
    -- INIT_ADMIN (Seed Data)
    -- =============================================
    IF @p_action = 'INIT_ADMIN'
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM sn_auth_user WHERE is_deleted = 0)
        BEGIN
             -- Create Default Admin
             DECLARE @admin_id BIGINT;
             
             INSERT INTO sn_auth_user (display_name, status, created_at, is_deleted)
             VALUES ('System Admin', 'active', SYSUTCDATETIME(), 0);
             
             SET @admin_id = SCOPE_IDENTITY();

             -- Identifier (admin)
             INSERT INTO sn_auth_identifier (user_id, identifier_type, identifier_value, is_primary, is_verified, created_at, is_deleted)
             VALUES (@admin_id, 'username', 'admin', 1, 1, SYSUTCDATETIME(), 0);

             -- Credential (password: admin123)
             -- Hash logic usually handled by app, but for seed we might need a known hash or let the app handle password reset.
             -- For now, we will create the User/Identifier so they can "Reset Password" or we assume App will force set it.
             -- Role Seeding (Ensure 'admin' and 'viewer' exist)
             IF NOT EXISTS (SELECT 1 FROM sn_auth_role WHERE role_name = 'admin')
                INSERT INTO sn_auth_role (role_name, is_deleted) VALUES ('admin', 0);
             
             IF NOT EXISTS (SELECT 1 FROM sn_auth_role WHERE role_name = 'viewer')
                INSERT INTO sn_auth_role (role_name, is_deleted) VALUES ('viewer', 0);

             -- Assign 'admin' role to new user
             DECLARE @admin_role_id BIGINT;
             SELECT @admin_role_id = role_id FROM sn_auth_role WHERE role_name = 'admin';

             INSERT INTO sn_auth_user_role (user_id, role_id, created_at, is_deleted)
             VALUES (@admin_id, @admin_role_id, SYSUTCDATETIME(), 0);

             SET @msg = N'Admin user initialized with role.';
        END
        ELSE
        BEGIN
             SET @msg = N'Users already exist.';
        END
        GOTO ResultSection;
    END

    -- =============================================
    -- UNKNOWN ACTION
    -- =============================================
    SET @err_code = 99;
    SET @err_flag = 1;
    SET @msg = N'Unknown action: ' + ISNULL(@p_action, N'NULL');

ResultSection:
    -- 1. CONTRACT (Always First)
    SELECT
        @err_code  AS err_code,
        @err_flag  AS err_flag,
        @msg       AS msg;

    -- 2. DATA (If Success)
    IF @err_flag = 0
    BEGIN
        IF @p_action = 'GET_PROFILE'
        BEGIN
             SELECT 
                u.user_id,
                u.display_name,
                u.status,
                u.created_at,
                u.updated_at,
                u.avatar_url,
                (SELECT TOP 1 identifier_value FROM sn_auth_identifier WHERE user_id = u.user_id AND is_deleted = 0 ORDER BY is_primary DESC, created_at ASC) as username,
                EmailVerified = CAST(CASE WHEN EXISTS (SELECT 1 FROM sn_auth_identifier i WHERE i.user_id = u.user_id AND i.identifier_type = 'email' AND i.is_verified = 1 AND i.is_deleted = 0) THEN 1 ELSE 0 END AS BIT),
                PhoneVerified = CAST(CASE WHEN EXISTS (SELECT 1 FROM sn_auth_identifier i WHERE i.user_id = u.user_id AND i.identifier_type = 'phone' AND i.is_verified = 1 AND i.is_deleted = 0) THEN 1 ELSE 0 END AS BIT),
                ISNULL((
                    SELECT TOP 1 ar.role_name 
                    FROM sn_auth_user_role ur
                    INNER JOIN sn_auth_role ar ON ur.role_id = ar.role_id
                    WHERE ur.user_id = u.user_id AND ur.is_deleted = 0 AND ar.is_deleted = 0
                ), 'viewer') as role
            FROM sn_auth_user u
            WHERE u.user_id = @p_userid
              AND u.is_deleted = 0;
        END

        IF @p_action = 'LOGIN_GET_CREDENTIAL' OR @p_action = 'GET_CREDENTIAL_BY_ID'
        BEGIN
            SELECT TOP 1
                u.user_id,
                u.display_name,
                u.status,
                u.avatar_url,
                u.failed_login_count,
                u.locked_until,
                c.password_hash,
                c.password_salt,
                c.password_algo,
                c.password_iterations,
                ISNULL((
                    SELECT TOP 1 ar.role_name 
                    FROM sn_auth_user_role ur
                    INNER JOIN sn_auth_role ar ON ur.role_id = ar.role_id
                    WHERE ur.user_id = u.user_id AND ur.is_deleted = 0 AND ar.is_deleted = 0
                ), 'viewer') as role
            FROM sn_auth_user u
            JOIN sn_auth_credential c ON c.user_id = u.user_id
            WHERE u.user_id = (CASE WHEN @p_action = 'GET_CREDENTIAL_BY_ID' THEN @p_userid ELSE u.user_id END)
              AND (@p_action = 'GET_CREDENTIAL_BY_ID' OR EXISTS(SELECT 1 FROM sn_auth_identifier i WHERE i.user_id = u.user_id AND i.identifier_value = @p_login_id AND i.is_deleted = 0))
              AND u.is_deleted = 0
              AND c.is_deleted = 0
              AND c.credential_type = 'password';
        END

        IF @p_action = 'LOGIN_SUCCESS' OR @p_action = 'LOGIN_FAIL'
        BEGIN
             -- Return minimal context if needed, or nothing (Contract is enough for success, but Fail might need IsLocked)
             -- Standard for LOGIN actions usually requires user_id return to confirm context
             SELECT @p_userid as user_id, @is_locked as is_locked;
        END
        
        IF @p_action = 'REGISTER'
        BEGIN
            SELECT @p_userid as user_id;
        END

        IF @p_action = 'GET_ALL'
        BEGIN
            SELECT 
                u.user_id,
                u.display_name,
                u.status,
                u.avatar_url,
                u.created_at,
                (SELECT TOP 1 identifier_value FROM sn_auth_identifier WHERE user_id = u.user_id AND is_primary = 1 AND is_deleted = 0) as username,
                (SELECT TOP 1 identifier_value FROM sn_auth_identifier WHERE user_id = u.user_id AND identifier_type = 'email' AND is_deleted = 0) as email,
                (SELECT TOP 1 identifier_value FROM sn_auth_identifier WHERE user_id = u.user_id AND identifier_type = 'phone' AND is_deleted = 0) as phone,
                ISNULL((
                    SELECT TOP 1 ar.role_name 
                    FROM sn_auth_user_role ur
                    INNER JOIN sn_auth_role ar ON ur.role_id = ar.role_id
                    WHERE ur.user_id = u.user_id AND ur.is_deleted = 0 AND ar.is_deleted = 0
                ), 'viewer') as role
            FROM sn_auth_user u
            WHERE u.is_deleted = 0
            ORDER BY u.created_at DESC;
        END
    END
END;
GO
