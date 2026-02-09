USE [SignageUnicornDB]
GO

/****** Object:  Table [dbo].[AUTH_IDENTIFIER]    Script Date: 12/12/2568 22:47:02 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[sn_auth_identifier](
    [identifier_id] [bigint] IDENTITY(1,1) NOT NULL,
    [user_id] [bigint] NOT NULL,
    [identifier_type] [nvarchar](20) NOT NULL, -- 'email', 'phone', 'username'
    [identifier_value] [nvarchar](200) NOT NULL,
    [is_primary] [bit] NOT NULL,
    [is_verified] [bit] NOT NULL,
    [verification_code] [nvarchar](100) NULL,
    [verified_at] [datetime2](7) NULL,
    [created_at] [datetime2](7) NOT NULL DEFAULT SYSUTCDATETIME(),
    [created_by] [bigint] NULL,
    [updated_at] [datetime2](7) NULL,
    [updated_by] [bigint] NULL,
    [is_deleted] [bit] NOT NULL DEFAULT 0,
    [deleted_at] [datetime2](7) NULL,
    [deleted_by] [bigint] NULL,
    [row_version] [timestamp] NOT NULL,
 CONSTRAINT [PK_AUTH_IDENTIFIER] PRIMARY KEY CLUSTERED 
(
    [identifier_id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO

ALTER TABLE [dbo].[sn_auth_identifier]  WITH CHECK ADD  CONSTRAINT [FK_AUTH_IDENTIFIER_AUTH_USER] FOREIGN KEY([user_id])
REFERENCES [dbo].[sn_auth_user] ([user_id])
GO

ALTER TABLE [dbo].[sn_auth_identifier] CHECK CONSTRAINT [FK_AUTH_IDENTIFIER_AUTH_USER]
GO

CREATE NONCLUSTERED INDEX [IX_AUTH_IDENTIFIER_Value] ON [dbo].[sn_auth_identifier]
(
    [identifier_type] ASC,
    [identifier_value] ASC
) WHERE ([is_deleted] = 0)
GO
