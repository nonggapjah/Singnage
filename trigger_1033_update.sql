SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

INSERT INTO sn_device_commands (command_uuid, device_id, command_type, payload, status, created_at)
SELECT NEWID(), device_id, 'UPDATE_CLIENT', '{"version":"2.7.4"}', 'PENDING', SYSUTCDATETIME() 
FROM sn_devices 
WHERE branch_code = '1033' AND status IN ('ONLINE', 'PLAYING', 'IDLE');
