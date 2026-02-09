SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[sn_auth_user_role]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[sn_auth_user_role](
        [user_role_id] [bigint] IDENTITY(1,1) NOT NULL,
        [user_id] [bigint] NOT NULL,
        [role_id] [bigint] NOT NULL,
        [created_at] [datetime2](7) NOT NULL DEFAULT SYSUTCDATETIME(),
        [updated_at] [datetime2](7) NULL,
        [is_deleted] [bit] NOT NULL DEFAULT 0,
        CONSTRAINT [PK_sn_auth_user_role] PRIMARY KEY CLUSTERED 
        (
            [user_role_id] ASC
        )
    ) ON [PRIMARY]
    
    -- Foreign Keys
    ALTER TABLE [dbo].[sn_auth_user_role]  WITH CHECK ADD  CONSTRAINT [FK_sn_auth_user_role_user] FOREIGN KEY([user_id])
    REFERENCES [dbo].[sn_auth_user] ([user_id])
    
    ALTER TABLE [dbo].[sn_auth_user_role]  WITH CHECK ADD  CONSTRAINT [FK_sn_auth_user_role_role] FOREIGN KEY([role_id])
    REFERENCES [dbo].[sn_auth_role] ([role_id])
END
GO
