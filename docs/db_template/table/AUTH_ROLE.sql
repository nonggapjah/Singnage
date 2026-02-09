SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[sn_auth_role]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[sn_auth_role](
        [role_id] [bigint] IDENTITY(1,1) NOT NULL,
        [role_name] [nvarchar](50) NOT NULL,
        [description] [nvarchar](200) NULL,
        [created_at] [datetime2](7) NOT NULL DEFAULT SYSUTCDATETIME(),
        [updated_at] [datetime2](7) NULL,
        [is_deleted] [bit] NOT NULL DEFAULT 0,
        CONSTRAINT [PK_sn_auth_role] PRIMARY KEY CLUSTERED 
        (
            [role_id] ASC
        )
    ) ON [PRIMARY]

    -- Seed default roles
    INSERT INTO [dbo].[sn_auth_role] (role_name, description) VALUES ('admin', 'System Administrator');
    INSERT INTO [dbo].[sn_auth_role] (role_name, description) VALUES ('viewer', 'Read-only User');
    INSERT INTO [dbo].[sn_auth_role] (role_name, description) VALUES ('editor', 'Content Editor');
END
GO
