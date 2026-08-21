USE [SignageUnicornDB]
GO

/****** Object:  Table [dbo].[sn_device_playlists]    Script Date: 2026-08-20 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- This table had no template at all. Every other table in production had one, so a fresh install
-- driven by "Re-apply Schema" created thirteen tables and silently omitted the one that records
-- which playlist each screen plays -- the system would come up unable to schedule anything.
-- Reconstructed from the live schema on 20-08-2026.
--
-- Guarded with IF NOT EXISTS rather than relying on the caller swallowing an "already exists"
-- error, so a re-apply is a genuine no-op instead of an exception that happens to be ignored.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'sn_device_playlists')
BEGIN
    CREATE TABLE [dbo].[sn_device_playlists](
        [id]          [bigint] IDENTITY(1,1) NOT NULL,
        [device_id]   [bigint] NOT NULL,
        [playlist_id] [bigint] NOT NULL,
        [start_date]  [datetime2](7) NULL,
        [end_date]    [datetime2](7) NULL,
        [is_active]   [bit] NULL DEFAULT ((1)),
        [created_at]  [datetime2](7) NULL DEFAULT (getutcdate()),
        CONSTRAINT [PK_sn_device_playlists] PRIMARY KEY CLUSTERED ([id] ASC)
    );
END
GO

-- Every schedule lookup filters on device_id + is_active, and the table had nothing but the
-- clustered key on id, so each one scanned. SQL Server's missing-index DMV reported this exact
-- pair with 2,293 uses against a table of 377 rows -- small, but it sits on the heartbeat path.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sn_device_playlists_device_active'
               AND object_id = OBJECT_ID('dbo.sn_device_playlists'))
BEGIN
    CREATE NONCLUSTERED INDEX [IX_sn_device_playlists_device_active]
    ON [dbo].[sn_device_playlists] ([device_id] ASC, [is_active] ASC)
    INCLUDE ([playlist_id], [start_date], [end_date]);
END
GO
