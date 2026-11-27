-- Media integrity (API 2.8.15, 27-11-2026). A media row whose stored hash did not match the file on
-- disk (media 106) made every screen download / verify / delete / re-download it forever and filled the
-- 600 Mbit/s uplink for a day and a half. MediaIntegrityWorker now compares every live row with the file
-- the screens fetch and records the verdict here; rows that are not 'ok' are left out of device
-- schedules (quarantined) until an admin accepts the file on disk or replaces it.
--   integrity_status: NULL/'unknown' (never checked) | 'ok' | 'mismatch' | 'missing' | 'loop-suspect'
IF COL_LENGTH('dbo.sn_media_files', 'integrity_status') IS NULL
    ALTER TABLE dbo.sn_media_files ADD integrity_status NVARCHAR(16) NULL;
GO
IF COL_LENGTH('dbo.sn_media_files', 'integrity_checked_at') IS NULL
    ALTER TABLE dbo.sn_media_files ADD integrity_checked_at DATETIME2(7) NULL;
GO
IF COL_LENGTH('dbo.sn_media_files', 'integrity_note') IS NULL
    ALTER TABLE dbo.sn_media_files ADD integrity_note NVARCHAR(400) NULL;
GO
-- The stored file name (last segment of blob_url) the verdict was made for. A verdict whose file is no
-- longer the row's file (the media was replaced) is stale and ignored, so an old file's quarantine can
-- never attach itself to replacement bytes, whatever the timing of the replace and the checker.
IF COL_LENGTH('dbo.sn_media_files', 'integrity_file') IS NULL
    ALTER TABLE dbo.sn_media_files ADD integrity_file NVARCHAR(255) NULL;
GO
