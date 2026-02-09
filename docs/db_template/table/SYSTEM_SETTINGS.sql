USE [SignageUnicornDB]
GO

/****** Object:  Table [dbo].[sn_system_settings]    Script Date: 12/12/2568 22:47:02 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[sn_system_settings](
    [setting_id] [bigint] IDENTITY(1,1) NOT NULL,
    [config_key] [nvarchar](50) NOT NULL,
    [config_value] [nvarchar](max) NULL,
    [description] [nvarchar](255) NULL,
    [updated_at] [datetime2](7) NOT NULL DEFAULT SYSUTCDATETIME(),
    [updated_by] [bigint] NULL,
 CONSTRAINT [PK_sn_system_settings] PRIMARY KEY CLUSTERED 
(
    [setting_id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO

CREATE UNIQUE NONCLUSTERED INDEX [IX_sn_system_settings_Key] ON [dbo].[sn_system_settings]
(
    [config_key] ASC
)
GO
