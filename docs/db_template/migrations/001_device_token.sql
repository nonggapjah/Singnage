-- Contract item 1: per-device secret. Only the SHA-256 hex of the token is stored.
-- Idempotent: a column that already exists (ad-hoc production change) is left alone.
IF COL_LENGTH('dbo.sn_devices', 'device_token_hash') IS NULL
    ALTER TABLE dbo.sn_devices ADD device_token_hash NVARCHAR(128) NULL;
GO
IF COL_LENGTH('dbo.sn_devices', 'device_token_issued_at') IS NULL
    ALTER TABLE dbo.sn_devices ADD device_token_issued_at DATETIME2(7) NULL;
GO
