USE [SignageUnicornDB]
GO

/****** Object:  Table [dbo].[PLAYLISTS]    Script Date: 12/12/2568 22:47:02 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[sn_playlists](
    [playlist_id] [bigint] IDENTITY(1,1) NOT NULL,
    [playlist_uuid] [nvarchar](36) NOT NULL,
    [playlist_name] [nvarchar](255) NOT NULL,
    [description] [nvarchar](500) NULL,
    [status] [nvarchar](20) NOT NULL DEFAULT 'active',
    [created_at] [datetime2](7) NOT NULL DEFAULT SYSUTCDATETIME(),
    [created_by] [bigint] NULL,
    [updated_at] [datetime2](7) NULL,
    [updated_by] [bigint] NULL,
    [is_deleted] [bit] NOT NULL DEFAULT 0,
    [deleted_at] [datetime2](7) NULL,
    [deleted_by] [bigint] NULL,
    [row_version] [timestamp] NOT NULL,
 CONSTRAINT [PK_PLAYLISTS] PRIMARY KEY CLUSTERED 
(
    [playlist_id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO

CREATE UNIQUE NONCLUSTERED INDEX [IX_PLAYLISTS_UUID] ON [dbo].[sn_playlists]
(
    [playlist_uuid] ASC
) WHERE ([is_deleted] = 0)
GO
