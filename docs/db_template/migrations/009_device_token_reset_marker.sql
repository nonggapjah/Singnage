-- Round 3 (R2 / Codex round-3 finding 7). An operator reset clears device_token_hash; under
-- Security:DeviceAuth = IfIssued the screen is then accepted token-less and, still holding the old
-- token, never claims a new one. This marker records the reset; the heartbeat response of a client
-- that can act on it carries a RECLAIM_TOKEN pseudo-command, and the next successful token write
-- clears the marker (see SpDeviceRepository.TrySetDeviceTokenHashAsync).
IF COL_LENGTH('dbo.sn_devices', 'device_token_reset_at') IS NULL
    ALTER TABLE dbo.sn_devices ADD device_token_reset_at DATETIME2(7) NULL;
GO
