USE [SignageUnicornDB]
GO

/****** Object:  Table [dbo].[sn_device_commands]    Script Date: 09/01/2026 13:30:00 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[sn_device_commands](
    [command_id] [bigint] IDENTITY(1,1) NOT NULL,
    [command_uuid] [nvarchar](36) NOT NULL,
    [device_id] [bigint] NOT NULL,
    [command_type] [nvarchar](50) NOT NULL, -- 'REFRESH', 'RESTART', 'PLAY_PLAYLIST', 'UPDATE_APP'
    [payload] [nvarchar](max) NULL, -- JSON payload if needed (e.g. playlist_id)
    [status] [nvarchar](20) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'EXECUTED', 'FAILED', 'EXPIRED'
    [created_at] [datetime2](7) NOT NULL DEFAULT SYSUTCDATETIME(),
    [created_by] [bigint] NULL,
    [executed_at] [datetime2](7) NULL,
    [fail_reason] [nvarchar](max) NULL,
    [updated_at] [datetime2](7) NULL,
    [updated_by] [bigint] NULL,
    [is_deleted] [bit] NOT NULL DEFAULT 0,
 CONSTRAINT [PK_sn_device_commands] PRIMARY KEY CLUSTERED 
(
    [command_id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO

-- FK to Device
ALTER TABLE [dbo].[sn_device_commands]  WITH CHECK ADD  CONSTRAINT [FK_sn_device_commands_sn_devices] FOREIGN KEY([device_id])
REFERENCES [dbo].[sn_devices] ([device_id])
GO

ALTER TABLE [dbo].[sn_device_commands] CHECK CONSTRAINT [FK_sn_device_commands_sn_devices]
GO

-- Index for Device Polling (Performance Critical)
CREATE NONCLUSTERED INDEX [IX_sn_device_commands_Pending] ON [dbo].[sn_device_commands]
(
    [device_id] ASC,
    [status] ASC
)
INCLUDE ([command_type], [payload], [created_at])
WHERE ([status] = 'PENDING' AND [is_deleted] = 0)
GO

-- IX_sn_device_commands_Pending above is FILTERED on status = 'PENDING', so it cannot serve the
-- heartbeat dequeue, which reads:
--     WHERE device_id = @actual_id
--       AND (status = 'PENDING' OR (status = 'POLLING' AND updated_at < DATEADD(SECOND,-30,...)))
-- The OR over a second status puts the predicate outside the filter, so every heartbeat scanned
-- the table -- and it scans inside an UPDATE, so it takes update locks on rows it only examined.
-- SQL Server's missing-index DMV reported exactly (device_id, status) INCLUDE (updated_at) with
-- 36.6 million uses. On 20-08-2026 roughly a hundred heartbeat sessions piled up on LCK_M_U here.
--
-- Unfiltered, so it covers both statuses. The filtered index is kept: it is narrower and still
-- the better choice for the PENDING-only reads elsewhere.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sn_device_commands_Dequeue'
               AND object_id = OBJECT_ID('dbo.sn_device_commands'))
BEGIN
    CREATE NONCLUSTERED INDEX [IX_sn_device_commands_Dequeue]
    ON [dbo].[sn_device_commands] ([device_id] ASC, [status] ASC)
    INCLUDE ([updated_at], [command_type], [payload], [created_at], [command_uuid]);
END
GO

-- Also present in production but in no template: the index the daily purge uses
-- (DELETE ... WHERE created_at < ... AND status <> 'PENDING').
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_devcmd_cleanup'
               AND object_id = OBJECT_ID('dbo.sn_device_commands'))
BEGIN
    CREATE NONCLUSTERED INDEX [IX_devcmd_cleanup]
    ON [dbo].[sn_device_commands] ([created_at] ASC, [status] ASC);
END
GO
