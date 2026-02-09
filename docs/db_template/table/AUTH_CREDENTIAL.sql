USE [SignageUnicornDB]
GO

/****** Object:  Table [dbo].[AUTH_CREDENTIAL]    Script Date: 12/12/2568 22:47:02 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[sn_auth_credential](
    [credential_id] [bigint] IDENTITY(1,1) NOT NULL,
    [user_id] [bigint] NOT NULL,
    [credential_type] [nvarchar](20) NOT NULL, -- 'password', 'totp', 'oauth'
    [password_hash] [varbinary](512) NULL,
    [password_salt] [varbinary](256) NULL,
    [password_algo] [varchar](50) NULL, -- 'pbkdf2', 'argon2'
    [password_iterations] [int] NULL,
    [password_last_changed_at] [datetime2](7) NULL,
    [provider_name] [nvarchar](50) NULL, -- for oauth
    [provider_key] [nvarchar](255) NULL, -- for oauth
    [created_at] [datetime2](7) NOT NULL DEFAULT SYSUTCDATETIME(),
    [created_by] [bigint] NULL,
    [updated_at] [datetime2](7) NULL,
    [updated_by] [bigint] NULL,
    [is_deleted] [bit] NOT NULL DEFAULT 0,
    [deleted_at] [datetime2](7) NULL,
    [deleted_by] [bigint] NULL,
    [row_version] [timestamp] NOT NULL,
 CONSTRAINT [PK_AUTH_CREDENTIAL] PRIMARY KEY CLUSTERED 
(
    [credential_id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO

ALTER TABLE [dbo].[sn_auth_credential]  WITH CHECK ADD  CONSTRAINT [FK_AUTH_CREDENTIAL_AUTH_USER] FOREIGN KEY([user_id])
REFERENCES [dbo].[sn_auth_user] ([user_id])
GO

ALTER TABLE [dbo].[sn_auth_credential] CHECK CONSTRAINT [FK_AUTH_CREDENTIAL_AUTH_USER]
GO
