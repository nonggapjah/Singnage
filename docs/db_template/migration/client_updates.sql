/************************************************************/
/*  VERSION 2.3.1 - CLIENT UPDATE CONFIGURATION             */
/*  Run this script to force Client Auto-Update             */
/************************************************************/

USE [SignageUnicornDB];
GO

-- 1. Force Update Trigger (Bump version > 2.3.0)
-- This will make all clients (even 2.3.0) see an update available.
UPDATE sn_system_settings
SET config_value = '2.3.0', updated_at = GETDATE()
WHERE config_key = 'LatestClientVersion';

-- 2. Update Download URL (Corrected filename with underscores)
-- IMPORTANT: Put this file in 'src/signage-unicorn-web/public/setup/' 
-- (Frontend Public Folder) so the URL is accessible.
UPDATE sn_system_settings 
SET config_value = 'https://signage.aith123.com/setup/Signage_Unicorn_Setup_2.3.0.exe', 
    updated_at = GETDATE()
WHERE config_key = 'ClientDownloadUrl';

GO