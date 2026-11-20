-- Audio player (20-11-2026). A device row is either a screen (today's kiosk client, the default) or
-- an audio-only player (the separate "Signage Unicorn Audio" app). The mode decides which playlist
-- items a device receives -- a screen never gets an audio file (the deployed 2.8.0 kiosk would show
-- it as a broken image), an audio player never gets an image -- and which console actions make
-- sense for it (no screenshot and no OS reboot for an audio player). volume is the last level an
-- operator set from the console (SET_VOLUME, 0-100); NULL = never set.
IF COL_LENGTH('dbo.sn_devices', 'playback_mode') IS NULL
    ALTER TABLE dbo.sn_devices ADD playback_mode NVARCHAR(10) NOT NULL CONSTRAINT DF_sn_devices_playback_mode DEFAULT 'screen';
GO
IF COL_LENGTH('dbo.sn_devices', 'volume') IS NULL
    ALTER TABLE dbo.sn_devices ADD volume INT NULL;
GO
