SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

INSERT INTO sn_device_commands (command_uuid, device_id, command_type, payload, status, created_at)
SELECT NEWID(), device_id, 'UPDATE_CLIENT', '{"version":"2.7.4"}', 'PENDING', SYSUTCDATETIME()
FROM sn_devices
WHERE device_id IN (64,65,67,68,167) AND is_deleted = 0;
