USE [SignageUnicornDB]
GO

/****** Object:  Table [dbo].[sn_devices]    Script Date: 09/01/2026 14:52:21 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[sn_devices](
	[device_id] [bigint] IDENTITY(1,1) NOT NULL,
	[device_uuid] [nvarchar](36) NOT NULL,
	[device_name] [nvarchar](255) NOT NULL,
	[location] [nvarchar](255) NULL,
	[ratio] [nvarchar](50) NULL,
	[status] [nvarchar](20) NOT NULL,
	[last_check_in] [datetime2](7) NULL,
	[current_playlist_id] [bigint] NULL,
	[ip_address] [nvarchar](50) NULL,
	[mac_address] [nvarchar](50) NULL,
	[app_version] [nvarchar](50) NULL,
	[created_at] [datetime2](7) NOT NULL,
	[created_by] [bigint] NULL,
	[updated_at] [datetime2](7) NULL,
	[updated_by] [bigint] NULL,
	[is_deleted] [bit] NOT NULL,
	[deleted_at] [datetime2](7) NULL,
	[deleted_by] [bigint] NULL,
	[row_version] [timestamp] NOT NULL,
	[current_playlist_item_id] [bigint] NULL,
	[current_media_id] [bigint] NULL,
	[current_position_sec] [int] NULL,
	[cache_progress] [int] NULL,
	[last_playback_at] [datetime2](7) NULL,
	[branch_code] [nvarchar](50) NULL,
 CONSTRAINT [PK_DEVICES] PRIMARY KEY CLUSTERED 
(
	[device_id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO

ALTER TABLE [dbo].[sn_devices] ADD  DEFAULT ('offline') FOR [status]
GO

ALTER TABLE [dbo].[sn_devices] ADD  DEFAULT (sysutcdatetime()) FOR [created_at]
GO

ALTER TABLE [dbo].[sn_devices] ADD  DEFAULT ((0)) FOR [is_deleted]
GO



-- These three existed in production but in no template, so a fresh install would have come up
-- without them. IX_sn_devices_uuid in particular is on the heartbeat path: every beat resolves a
-- device by device_uuid, 292 screens every 15 seconds.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sn_devices_uuid'
               AND object_id = OBJECT_ID('dbo.sn_devices'))
BEGIN
    CREATE NONCLUSTERED INDEX [IX_sn_devices_uuid] ON [dbo].[sn_devices] ([device_uuid] ASC);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sn_devices_deleted'
               AND object_id = OBJECT_ID('dbo.sn_devices'))
BEGIN
    CREATE NONCLUSTERED INDEX [IX_sn_devices_deleted] ON [dbo].[sn_devices] ([is_deleted] ASC);
END
GO

-- Sibling inheritance and the admin grouping both look devices up by branch + name.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sn_devices_branch_name'
               AND object_id = OBJECT_ID('dbo.sn_devices'))
BEGIN
    CREATE NONCLUSTERED INDEX [IX_sn_devices_branch_name]
    ON [dbo].[sn_devices] ([branch_code] ASC, [device_name] ASC)
    INCLUDE ([is_deleted], [last_check_in]);
END
GO
