-- F18 / contract item 6: 'inherit' = may fall back to a sibling screen's assignments when it has
-- none of its own (fresh installs); 'explicit' = an admin assigned or deliberately cleared this
-- screen, so an empty assignment list means "play nothing", never "copy the neighbour".
IF COL_LENGTH('dbo.sn_devices', 'schedule_mode') IS NULL
    ALTER TABLE dbo.sn_devices ADD schedule_mode NVARCHAR(10) NOT NULL
        CONSTRAINT DF_sn_devices_schedule_mode DEFAULT 'inherit';
GO
