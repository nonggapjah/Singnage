SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

-- ส่งคำสั่ง PLAY_PLAYLIST ไปยังเครื่อง Sena All ใหม่ (387,388,389,390)
INSERT INTO sn_device_commands (command_uuid, device_id, command_type, payload, status, created_at)
SELECT NEWID(), device_id, 'PLAY_PLAYLIST:5', '{"playlistId":"5"}', 'PENDING', SYSUTCDATETIME()
FROM sn_devices
WHERE device_id IN (387,388,389,390) AND is_deleted = 0;

-- ส่งคำสั่ง PLAY_PLAYLIST ไปยังเครื่อง Sena Wine ใหม่ (391)
INSERT INTO sn_device_commands (command_uuid, device_id, command_type, payload, status, created_at)
SELECT NEWID(), device_id, 'PLAY_PLAYLIST:6', '{"playlistId":"6"}', 'PENDING', SYSUTCDATETIME()
FROM sn_devices
WHERE device_id = 391 AND is_deleted = 0;
