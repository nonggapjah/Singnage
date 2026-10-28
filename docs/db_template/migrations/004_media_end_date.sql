-- F15: sp_media_std reads and writes end_date but the table template never declared it.
IF COL_LENGTH('dbo.sn_media_files', 'end_date') IS NULL
    ALTER TABLE dbo.sn_media_files ADD end_date DATETIME2(7) NULL;
GO
