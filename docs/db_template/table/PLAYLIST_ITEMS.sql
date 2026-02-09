USE [SignageUnicornDB]
GO

/****** Object:  Table [dbo].[sn_playlist_items]    Script Date: 12/12/2568 22:47:02 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[sn_playlist_items](
    [playlist_item_id] [bigint] IDENTITY(1,1) NOT NULL,
    [playlist_item_uuid] [nvarchar](36) NOT NULL,
    [playlist_id] [bigint] NOT NULL,
    [media_id] [bigint] NOT NULL,
    [position_order] [int] NOT NULL,
    [duration_override] [int] NULL,
    [created_at] [datetime2](7) NOT NULL DEFAULT SYSUTCDATETIME(),
    [created_by] [bigint] NULL,
    [updated_at] [datetime2](7) NULL,
    [updated_by] [bigint] NULL,
    [is_deleted] [bit] NOT NULL DEFAULT 0,
    [deleted_at] [datetime2](7) NULL,
    [deleted_by] [bigint] NULL,
    [row_version] [timestamp] NOT NULL,
 CONSTRAINT [PK_sn_playlist_items] PRIMARY KEY CLUSTERED 
(
    [playlist_item_id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO

ALTER TABLE [dbo].[sn_playlist_items]  WITH CHECK ADD  CONSTRAINT [FK_sn_playlist_items_sn_playlists] FOREIGN KEY([playlist_id])
REFERENCES [dbo].[sn_playlists] ([playlist_id])
GO

ALTER TABLE [dbo].[sn_playlist_items] CHECK CONSTRAINT [FK_sn_playlist_items_sn_playlists]
GO

ALTER TABLE [dbo].[sn_playlist_items]  WITH CHECK ADD  CONSTRAINT [FK_sn_playlist_items_sn_media_files] FOREIGN KEY([media_id])
REFERENCES [dbo].[sn_media_files] ([media_id])
GO

ALTER TABLE [dbo].[sn_playlist_items] CHECK CONSTRAINT [FK_sn_playlist_items_sn_media_files]
GO

CREATE UNIQUE NONCLUSTERED INDEX [IX_sn_playlist_items_uuid] ON [dbo].[sn_playlist_items]
(
    [playlist_item_uuid] ASC
) WHERE ([is_deleted] = 0)
GO
