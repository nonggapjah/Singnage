USE [SignageUnicornDB]
GO

/****** Object:  Table [dbo].[MEDIA_FILES]    Script Date: 12/12/2568 22:47:02 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[sn_media_files](
    [media_id] [bigint] IDENTITY(1,1) NOT NULL,
    [media_uuid] [nvarchar](36) NOT NULL,
    [file_name] [nvarchar](255) NOT NULL,
    [display_name] [nvarchar](255) NULL,
    [blob_url] [nvarchar](max) NOT NULL,
    [duration_sec] [int] NOT NULL DEFAULT 0,
    [ratio] [nvarchar](50) NULL,
    [file_size_kb] [int] NULL,
    [supplier_code] [nvarchar](100) NULL,
    [remark1] [nvarchar](500) NULL,
    [remark2] [nvarchar](500) NULL,
    [storage_provider] [nvarchar](20) NOT NULL DEFAULT 'local', -- 'local', 'azure'
    [file_hash] [nvarchar](100) NULL,
    [created_at] [datetime2](7) NOT NULL DEFAULT SYSUTCDATETIME(),
    [created_by] [bigint] NULL,
    [updated_at] [datetime2](7) NULL,
    [updated_by] [bigint] NULL,
    [is_deleted] [bit] NOT NULL DEFAULT 0,
    [deleted_at] [datetime2](7) NULL,
    [deleted_by] [bigint] NULL,
    [row_version] [timestamp] NOT NULL,
 CONSTRAINT [PK_MEDIA_FILES] PRIMARY KEY CLUSTERED 
(
    [media_id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO

CREATE UNIQUE NONCLUSTERED INDEX [IX_MEDIA_FILES_UUID] ON [dbo].[sn_media_files]
(
    [media_uuid] ASC
) WHERE ([is_deleted] = 0)
GO
