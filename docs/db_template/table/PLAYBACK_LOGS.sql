USE [SignageUnicornDB]
GO

/****** Object:  Table [dbo].[PLAYBACK_LOGS]    Script Date: 12/12/2568 22:47:02 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[sn_playback_logs](
    [playback_id] [bigint] IDENTITY(1,1) NOT NULL,
    [device_id] [bigint] NOT NULL,
    [media_id] [bigint] NOT NULL,
    [playlist_id] [bigint] NULL,
    [start_time] [datetime2](7) NOT NULL,
    [end_time] [datetime2](7) NULL,
    [duration_sec] [int] NULL,
	[branch_code] [nvarchar](50) NULL,
	[status] [nvarchar](20) NOT NULL DEFAULT 'completed', -- 'completed', 'interrupted', 'skipped'
	[created_at] [datetime2](7) NOT NULL DEFAULT SYSUTCDATETIME(),
    [error_message] [nvarchar](500) NULL,   
 CONSTRAINT [PK_PLAYBACK_LOGS] PRIMARY KEY CLUSTERED 
(
    [playback_id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO

-- FKs for Data Integrity (Optional: remove if high-throughput is priority)
ALTER TABLE [dbo].[sn_playback_logs]  WITH CHECK ADD  CONSTRAINT [FK_PLAYBACK_LOGS_DEVICES] FOREIGN KEY([device_id])
REFERENCES [dbo].[sn_devices] ([device_id])
GO
ALTER TABLE [dbo].[sn_playback_logs] CHECK CONSTRAINT [FK_PLAYBACK_LOGS_DEVICES]
GO

ALTER TABLE [dbo].[sn_playback_logs]  WITH CHECK ADD  CONSTRAINT [FK_PLAYBACK_LOGS_MEDIA_FILES] FOREIGN KEY([media_id])
REFERENCES [dbo].[sn_media_files] ([media_id])
GO
ALTER TABLE [dbo].[sn_playback_logs] CHECK CONSTRAINT [FK_PLAYBACK_LOGS_MEDIA_FILES]
GO

-- Index for Reporting (Proof of Play)
CREATE NONCLUSTERED INDEX [IX_PLAYBACK_LOGS_Reporting] ON [dbo].[sn_playback_logs]
(
    [device_id] ASC,
    [media_id] ASC,
    [start_time] ASC
)
GO

-- Index for Cleanup and Admin Dashboard Queries
CREATE NONCLUSTERED INDEX [IX_PLAYBACK_LOGS_CreatedAt] ON [dbo].[sn_playback_logs]
(
    [created_at] ASC
)
GO
