USE [SignageUnicornDB]
GO

/****** Object:  Table [dbo].[AUTH_USER]    Script Date: 12/12/2568 22:47:02 ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[sn_auth_user](
	[user_id] [bigint] IDENTITY(1,1) NOT NULL,
	[display_name] [nvarchar](200) NOT NULL,
	[status] [nvarchar](20) NOT NULL,
	[failed_login_count] [int] NOT NULL,
	[last_failed_login_at] [datetime2](7) NULL,
	[locked_until] [datetime2](7) NULL,
	[created_at] [datetime2](7) NOT NULL,
	[created_by] [bigint] NULL,
	[updated_at] [datetime2](7) NULL,
	[updated_by] [bigint] NULL,
	[is_deleted] [bit] NOT NULL,
	[deleted_at] [datetime2](7) NULL,
	[deleted_by] [bigint] NULL,
	[row_version] [timestamp] NOT NULL,
	[avatar_url] [nvarchar](2048) NULL,
PRIMARY KEY CLUSTERED 
(
	[user_id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO

ALTER TABLE [dbo].[sn_auth_user] ADD  DEFAULT ('active') FOR [status]
GO

ALTER TABLE [dbo].[sn_auth_user] ADD  DEFAULT ((0)) FOR [failed_login_count]
GO

ALTER TABLE [dbo].[sn_auth_user] ADD  DEFAULT (sysutcdatetime()) FOR [created_at]
GO

ALTER TABLE [dbo].[sn_auth_user] ADD  DEFAULT ((0)) FOR [is_deleted]
GO


