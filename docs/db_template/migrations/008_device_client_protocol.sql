-- Contract T5. Which protocol a screen speaks: 1 = legacy client (restart-type commands are marked
-- EXECUTED when delivered, as the deployed procedure always did), 2+ = lease/ack client. Updated from
-- the X-Client-Protocol header on every heartbeat; the admin console shows it so the operator knows
-- when every screen is ready for Security:DeviceAuth = Required.
IF COL_LENGTH('dbo.sn_devices', 'client_protocol') IS NULL
    ALTER TABLE dbo.sn_devices ADD client_protocol TINYINT NOT NULL
        CONSTRAINT DF_sn_devices_client_protocol DEFAULT 1;
GO
