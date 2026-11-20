-- Dayparts and repeating announcements (API 2.8.7, 20-11-2026). An assignment may be limited to a
-- daily time window ('HH:mm' in the store's local time, Schedule:TimeZoneId; an overnight window
-- such as 22:00-02:00 is allowed) and to days of the week (ISO numbers, Monday = 1 ... Sunday = 7,
-- comma separated; NULL = every day). repeat_every_minutes turns the playlist into an interjection
-- for AUDIO players: its items are played once every N minutes between the regular loop's tracks
-- instead of being part of the loop. Screens (kiosk client) ignore the repeat flag and play the
-- playlist in their loop as before.
IF COL_LENGTH('dbo.sn_device_playlists', 'start_time') IS NULL
    ALTER TABLE dbo.sn_device_playlists ADD start_time NVARCHAR(5) NULL;
GO
IF COL_LENGTH('dbo.sn_device_playlists', 'end_time') IS NULL
    ALTER TABLE dbo.sn_device_playlists ADD end_time NVARCHAR(5) NULL;
GO
IF COL_LENGTH('dbo.sn_device_playlists', 'days_of_week') IS NULL
    ALTER TABLE dbo.sn_device_playlists ADD days_of_week NVARCHAR(20) NULL;
GO
IF COL_LENGTH('dbo.sn_device_playlists', 'repeat_every_minutes') IS NULL
    ALTER TABLE dbo.sn_device_playlists ADD repeat_every_minutes INT NULL;
GO
