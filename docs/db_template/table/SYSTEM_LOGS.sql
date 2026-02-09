USE [SignageUnicornDB]
GO

/****** Object:  Table [dbo].[SYSTEM_LOGS]    Script Date: 12/12/2568 22:47:02 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[sn_system_logs](
    [log_id] [bigint] IDENTITY(1,1) NOT NULL,
    [log_level] [nvarchar](20) NOT NULL, -- 'Info', 'Warning', 'Error', 'Critical'
    [source_system] [nvarchar](50) NOT NULL, -- 'Backend', 'Frontend', 'DeviceAgent'
    [category] [nvarchar](50) NULL, -- 'Auth', 'Database', 'Network'
    [message] [nvarchar](max) NOT NULL,
    [stack_trace] [nvarchar](max) NULL,
    [user_id] [bigint] NULL, -- Who caused this log?
    [ip_address] [nvarchar](50) NULL,
    [created_at] [datetime2](7) NOT NULL DEFAULT SYSUTCDATETIME(),
 CONSTRAINT [PK_SYSTEM_LOGS] PRIMARY KEY CLUSTERED 
(
    [log_id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO

-- Auto cleanup index (for deleting old logs > 30 days)
CREATE NONCLUSTERED INDEX [IX_SYSTEM_LOGS_CreatedAt] ON [dbo].[sn_system_logs]
(
    [created_at] ASC
)
GO
