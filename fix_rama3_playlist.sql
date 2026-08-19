SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

-- ส่งคำสั่ง PLAY_PLAYLIST ไปที่เครื่อง Rama3 ใหม่
INSERT INTO sn_device_commands (command_uuid, device_id, command_type, payload, status, created_at)
SELECT 
    NEWID(), 
    d.device_id, 
    'PLAY_PLAYLIST:' + CAST(d.current_playlist_id AS NVARCHAR(20)), 
    '{"playlistId":"' + CAST(d.current_playlist_id AS NVARCHAR(20)) + '"}', 
    'PENDING', 
    SYSUTCDATETIME()
FROM sn_devices d
WHERE d.device_id IN (392,393,394,395,396,397) 
  AND d.is_deleted = 0 
  AND d.current_playlist_id IS NOT NULL;

SELECT 'Commands queued: ' + CAST(@@ROWCOUNT AS VARCHAR) AS result;
