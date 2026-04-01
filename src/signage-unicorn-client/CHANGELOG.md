# Signage Unicorn - Project Changelog

รายการอัปเดตและประวัติการแก้ไขระบบ (Patch Version History)

---
## [2.5.0] - 2026-03-XX
### Feature: Multi-Playlist Scheduling
- **Dynamic Content Timelines**: The player now supports rendering a mathematically merged sequence of continuous playback combining multiple playlists.
- **Smart Validation**: Gracefully skips expired or inactive content automatically during sync and playback checks without manual intervention.
- **Schedule Sync Engine**: Integrated the `SYNC_SCHEDULE` directive to fetch unified daily playlogs directly from the unified backend infrastructure.

## [2.2.1] - 2026-02-12
### Critical Fixes & Stability
- **Playback Loop Reliability**:
    - **1-Item Loop Fix**: Resolved a critical issue where 1-item playlists would freeze on the last frame. Implemented forced re-mounting (Web) and explicit `.play()` / `currentTime = 0` triggers (Client) to ensure perpetual looping.
- **Client Native Core**:
    - **SQLite Rebuild Engine**: Integrated `@electron/rebuild` into the client build pipeline. This ensures `better-sqlite3` is correctly compiled for any machine, eliminating "Missing SQLite" or "Native Module" errors during installation.
    - **Startup Crash Prevention**: Fixed a critical main process bug where duplicate IPC handlers caused the app to crash upon launch.
- **Diagnostics & Metadata**:
    - **Patch History Recovery**: Improved internal path resolution for the Changelog reader. The Patch History screen now reliably finds and displays update logs across all installation environments.
    - **Boot Report Enrichment**: Ensured consistent reporting of app versions and system metadata during the initial server handshake.

---
## [2.2.0] - 2026-02-09
### Critical Fixes & Enhancements
- **Smooth Transition Engine**:
    - **Graceful Playlist Swap**: Implemented background playlist updates. Swaps now occur only when the current clip finishes and the first item of the new playlist is ready. No more abrupt cuts.
    - **Sequential Background Sync**: Replaced parallel downloads with a prioritized sequential queue (1, 2, 3...).
    - **Play-while-Sync**: Devices now start playing the new playlist as soon as the first item is cached, while remaining items sync in the background.
- **Native Client Stability**:
    - **SQLite Offline Storage**: Replaced `localStorage` with SQLite (`better-sqlite3`) for robust playback log and playlist caching, supporting 100k+ records and preventing data loss during long offline periods.
    - **Batch Log Syncing**: Implemented high-performance batch processing for logs, allowing 100+ records per sync request to handle recovery efficiently.
- **Precision Reporting & UI**:
    - **Playback Synchronization**: Both Web and Native players now capture the exact moment of playback (Precision Timestamps).
    - **24-Hour Format**: Standardized all Date/Time inputs in Statistics and System Logs to a clear 24H format.
    - **Real IP Detection**: Enabled `ForwardedHeaders` support in the API for correct IP detection behind proxies.
- **Backend Optimization**:
    - **Batch Processing API**: Added new specialized endpoints for bulk log ingestion.
    - **Sorting Reliability**: Fixed playlist item sorting by `positionOrder` across all platforms.

## [2.1.3] - 2026-01-13
### Improvements & Fixes
- **Dashboard "Live Mode" Optimization**:
    - **Silent Refresh**: Eliminated full-page flashing during auto-refresh. Data now updates seamlessly in the background.
    - **Interval Sync**: Adjusted update frequency to **15 seconds** to strictly match the device heartbeat cycle, reducing server load.
    - **Performance**: Optimized API calls by caching Playlist Reference data instead of re-fetching it every cycle.
- **Critical Database Fix**:
    - **Command Loop Resolved**: Fixed a bug in `sp_device_command_std` where `POLL_PENDING` returned already-executed commands, causing clients to "Flash" and reload playlists endlessly.
- **Client Diagnostics**:
    - **Detailed Error Codes**: The Player now captures and logs specific HTML5 Media Error Codes (e.g., `MEDIA_ERR_DECODE`) instead of generic messages, aiding in debugging corrupt or incompatible files.
- **API Stability**:
    - **Build Fix**: Resolved missing dependency injection in `MediaService` that caused build failures.

## [2.1.2] - 2026-01-13
### Major Stability & Compliance Update
- **Device Identity Robustness**:
    - **Client-Side Handshake**: The native client refactored the "Update Configuration" flow (F7) to validate the server connection (Verify & Register) *before* saving new settings locally. This prevents "Bricked" clients caused by typos in Server IP.
    - **Real IP Detection**: The backend `DeviceController` now overrides self-reported IPs (often `127.0.0.1` or Proxy IPs) with the actual **Remote Connection IP**. This ensures the Admin Dashboard always displays the reachable LAN IP for Remote Desktop/SSH access.
    - **Identity Protection**: Added CRITICAL warnings when a user attempts to change the `Device ID`, alerting them that this action creates a new device identity on the server.
- **System Logging & Attribution**:
    - **Media & Playlist Logs**: Implemented comprehensive logging for Media Upload/Delete and Playlist Create/Update actions.
    - **User Attribution**: Tracking logic updated to capture and record the `UserID` (from JWT) into System Logs, ensuring full audit trails for Admin actions.
- **Backend Refactoring (Final Polish)**:
    - **UNI-102 Compliance**: Finalized `DashboardController` and `MediaController` refactoring to use strongly-typed `IEnumerable` models instead of legacy `DataTable` logic.
    - **Clean Types**: Resolved `Guid` vs `long` type mismatches in Dashboard DTOs.

## [2.1.1] - 2026-01-13
### Fixed
- **Playlist Media Metadata**: Resolved missing media details (Ratio, FileSize, Remarks, UploadInfo) in Playlist Editor by updating `sp_playlist_std` (Added missing columns to SELECT) and enhancing Backend DTO mapping.
- **Playlist Save Logic**: Fixed "Remove Item -> All Items Lost" bug caused by Hybrid ID/UUID mismatch. Added robust Shadow Property mapping for SnakeCase DB columns.
- **Validation**: Fixed frontend `uploadedAt` validation error (HTTP 400) by sanitizing payload before save.
- **Log Standardization**: Updated `PlaylistService` logs to follow `Pipe-Separated Key-Value` standard for better readability.
- **UI Tweaks**: Improved `MediaSelector` popup z-index and background opacity.

## [2.1.0] - 2026-01-12
### Major Fixes & Enhancements
- **System Stability**: Resolved "Duplicate Key" errors in System Log viewer by implementing composite key generation.
- **Heartbeat & Playback Robustness**:
    - Enhanced backend logic to handle both numeric and UUID-based identifiers for Media and Playlists, resolving "Buffering..." display issues on the Admin Panel.
    - Updated Stored Procedures to accurately record heartbeat data regardless of ID format.
    - List View in Admin Devices now correctly displays "Playlist" and "Current Media" columns without misalignment.
- **Local Network Migration Tools**:
    - Added "Sync Media URL" tool in Media Library, allowing one-click repair of media paths when the Server IP address changes (DHCP).
    - Added backend `SYNC_BLOB_URL` logic to support this migration.
- **Client Unification**: Updated Native Client (Electron) to match Web Player logic/versioning (v2.1.0).

## [2.0.0] - 2026-01-09
### Major Upgrade (Backend Refactor & Compliance)
- **Backend Architecture Overhaul**: Complete refactoring of all Repository implementations (`Media`, `Playlist`, `Device`, `PlaybackLog`, `SystemLog`) to strictly adhere to `UNI-102` standards.
- **Stored Procedure Standardization**: Updated and verified all Stored Procedures (`sp_[domain]_std`) to ensure consistent Parameter Naming (`snake_case` with `p_` prefix), correct Data Types (UUID resolution), and Contract Result Sets.
- **Stability & Safety**:
    - Eliminated critical crashes caused by UUID/ID type mismatches across all modules.
    - Resolved "Lost Update" issues in Device Heartbeat by enforcing correct logic separation (removed auto-command processing).
    - Fixed System Log insertion logic to correctly map parameters and handle Action Routing.
- **Clean Code**: Removed deprecated/dead code from Database Procedures and Legacy Logic from API Repositories.
- **Version Bump**: Synchronized all system components (Client, Web, API) to v2.0.0.

## [1.7.7] - 2026-01-09
### Added
- **User Guide Overhaul**: Complete redesign of the Admin User Guide (`/admin/guide`) into a Gitbook/Notion-style documentation platform.
- **Documentation Expansion**: Added deep-dive technical sections for "Unified Network Config" and "Node Device Client" (Smart Sync, Caching Logic, Hotkeys).
- **Setup & Troubleshooting**: New dedicated tabs for Player Installation (Kiosk Setup) and Basic Troubleshooting guides.
- **Unified Network Config**: Moved network configuration documentation to the Admin tab for better accessibility.

## [1.7.6] - 2026-01-08
### Added
- **System Notifications (Rank 1)**: The Admin Bell icon is now live. It displays the latest 10 system logs (Errors/Warnings) in a premium glass-morphism dropdown, allowing admins to react to system issues instantly.
- **Latency Monitoring (Rank 2)**: Added real-time latency tracking (ms) to the global header. Latency is calculated dynamically based on node heartbeat freshness.
- **Dynamic TX Speed**: The Transmit speed in the header now reflects actual simulated load based on the number of online devices.
- **Global Environment Versioning**: The system version is now managed via `.env` and exposed through a unified API, enabling clients to detect and notify about new updates automatically.
### Changed
- **Header Refactor**: Unified stats display in the Admin Dashboard with Live data integration.
- **Version Bump**: Updated all components (Web, API, Client) to v1.7.6.


## [1.7.5] - 2026-01-08
### Added
- **Dynamic Port Management**: Eliminated hardcoded port (5018) throughout the backend. The system now dynamically detects its running port from active request headers and configuration.
- **SQL Migration Port-Awareness**: The automated media path migration now correctly identifies and replaces legacy URLs using detected ports, ensuring database integrity across custom network environments.
- **Real-time Admin Analytics**: The dashboard header now displays live system stats:
    - Online/Offline device counts.
    - Total Playlists and Media Files.
    - Simulated Transmit (TX) Speed based on active node activity.
- **Device Health Monitor (Zombie Cleanup)**: Added a "Cleanup Zombies" feature to automatically deactivate devices that have been offline for more than 24 hours, keeping the monitoring grid clean.
- **Database Maintenance Tool**: Integrated an "INIT DB" feature in the Admin UI to safely initialize and repair database tables and stored procedures.
- **Improved Device Status Logic**: Updated tracking to classify 'IDLE' and 'PLAYING' states as 'ONLINE', providing more accurate visibility of active terminal nodes.
### Fixed
- **Media Usage Reporting**: Resolved a bug where the Media Usage popup failed to display correctly associated playlists.
- **Port Fallback Reliability**: Standardized port fallback to `5018` for legacy support while prioritizing active environment settings.
### Changed
- **Version Unified**: Set system version to v1.7.5 across Web Dashboard, API, and Desktop Client.

## [1.7.2] - 2026-01-08
### Added
- **Dynamic Port Configuration**: Administrators can now change both the Backend API Port (default 5018) and the Frontend Dashboard Port (default 3000) directly from the System Config settings.
- **Automated Environment Sync**: Saving new network settings now automatically updates the `.env` file for the web dashboard, ensuring seamless connection between frontend and backend regardless of the chosen ports.
- **Port Input UI**: Added new designated input fields for Port configuration in both the Settings page and the Dashboard Config modal.

## [1.7.1] - 2026-01-07
### Added
- **Resume Playback**: Both Client and Browser players now remember the last played media index. When the application restarts or reloads, it will automatically resume from the last played clip instead of starting from the beginning of the playlist.
- **Persistent State**: Progress is stored in `localStorage`, ensuring continuity even after power loss or accidental refreshes.

## [1.7.0] - 2026-01-07
### Added
- **Browser Control Center Config**: Added a Configuration (⚙️) button to the Web Dashboard, allowing administrators to manage system IP settings directly without navigating to the Settings page.
- **Enhanced Log Detail**: The client now transmits its current `PlaylistItemId` in the heartbeat, eliminating "Item: None" entries in system logs for better traceability.
- **Client System Sync Restored**: Re-enabled player-side system log synchronization to ensure all diagnostic events reach the central server.
### Fixed
- **Log Source Consistency**: Native media change events are now explicitly logged by the player as "PLAYER" source events for parity with backend logs.

## [1.6.5] - 2026-01-07
### Added
- **Dynamic Cursor Management**: Mouse cursor now automatically hides during media playback and reappears only when Admin/Setup dashboards are active.
- **Keyboard Accessibility**:
    - Added high-visibility focus rings for better navigation without a mouse.
    - Full support for `TAB` for navigation, `Enter` for submitting forms, and `ESC` for closing all overlays.
- **Version Bumping**: Updated all system version references to v1.6.5.

## [1.6.4] - 2026-01-07
### Fixed
- **Critical Display Sync**: Fixed a layout bug where hidden media elements remained in the flex flow, causing playback to be offset/misaligned. Hidden elements now use `display: none`.
- **Media Scaling Consistency**: Standardized CSS scaling to ensure `object-fit: contain` works reliably across all window sizes.
### Added
- **Fullscreen Toggle (F11)**: Technicians can now toggle between Fullscreen/Kiosk and Windowed mode using F11.
- **Visual HUD Notifications**: Integrated an on-screen HUD (Top-Right) to provide instant feedback for hotkeys (Volume, Sync, Reset) and remote commands.

## [1.6.3] - 2026-01-07
### Fixed
- **Media Scaling Bug**: Fixed CSS selector bug that caused `Fit/Contain` mode to fail, resulting in unwanted zooming/cropping on certain hi-res images and videos.
- **Cursor Management**: Added auto-hide cursor logic to ensure a clean signage experience without visible mouse pointers.
- **Improved Sync Reliability**: Added redundant checks during media synchronization to ensure file integrity.

## [1.6.2] - 2026-01-07
### Changed
- **Media Aspect Ratio (Fit Mode)**: Changed media scaling logic from `Fill/Cover` to `Fit/Contain`. Media will now maintain its original aspect ratio and be centered with a black background (Letterboxing).
- **Log Focus**: Disabled automatic transmission of System Logs to the server to reduce network overhead, focusing exclusively on Playback logs.

## [1.6.1] - 2026-01-07
### Added
- **Sleep Prevention**: Integrated `powerSaveBlocker` to prevent device from sleeping or turning off the screen during playback.
### Improved
- **Robust Offline Logging**: Rewrote Playback and System log synchronization logic to prevent duplicates and ensure data integrity during network outages.
- **Persistent System Logs**: Client-side system logs are now persisted to `localStorage`, allowing them to survive application restarts if not yet synced.

## [1.6.0] - 2026-01-07
### Added
- **System Config Upgrade**: Added advanced "System Infrastructure" panel in Settings.
- **Dynamic IP Management**: Admins can now update the Server IP directly from the UI.
- **Auto-Discovery**: System can now auto-detect the optimal LAN IP address.
- **Auto-Migration**: Updating the IP automatically executes SQL migration to fix existing media URLs.
- **Frontend Sync**: Attempts to update Frontend `.env` configuration automatically.

## [1.5.1] - 2026-01-07
### Fixed
- **Next.js Metadata Warning**: Fixed `Unsupported metadata themeColor` warning by moving `themeColor` to the viewport export in `layout.tsx`.
- **API Build Error**: Fixed `SystemLogController` build error caused by missing return statements.

## [1.5.0] - 2026-01-07
### Added
- **Smart Sync (Content Hashing)**: Added mechanism to skip redundant media downloads if playlist content hash matches local cache (Matches Web Player functionality).
- **Global Safety Jingle Sync**: Implementation of centralized Jingle management. The device now fetches and caches the `safety_jingle_id` from system settings.
- **Enhanced Remote Commands**: Improved heartbeat command processing for `PLAY_PLAYLIST`, `RELOAD`, `REBOOT`, and `FORCE_SYNC`.
- **Advanced Heartbeat Reporting**: Now reports `cacheProgress`, `currentMediaId`, and `currentPositionSec` in every heartbeat cycle for better visibility on Server Admin.
- **Improved Reboot Logic**: Native Windows reboot command integration for remote device maintenance.

## [1.4.0] - 2026-01-07
### Added
- **Full Hotkey Support**: Implemented F1-F8 shortcuts for all essential functions (Help, Volume, Mute, Reload, Sync, Admin, Wipe).
- **Clickable Dashboard Icons**: All shortcut visual cues (F1-F8) are now interactive buttons.
- **System Help Modal**: Pressing F1 or clicking HELP now opens a comprehensive command guide.
- **Server-Side Changelog**: Integration with `.NET API` to fetch patch history directly via Swagger-enabled endpoint.
- **Device ID Management**: Ability to manually update `DeviceID` in configuration with double-confirmation safety checks.
- **Volume Mute**: Added F4 / Mute button functionality with state persistence.

## [1.3.0] - 2026-01-07
### Added
- **Premium Dashboard UI**: Total overhaul with glassmorphism dark theme.
- **Live Monitoring HUD**: Real-time stats for Network, Storage, and Offline Readiness.
- **Sync Progress Tracking**: Visual bars for media download and content readiness.
- **Maintenance Actions**: Force Sync, Clear Cache, and Volume control.
- **Unified Settings Overlay**: Improved configuration management (Server IP, Name, Branch).
- **Patch History**: View recent changes directly from the device dashboard. เข้าถึงได้จากไอคอนเฟือง (⚙️)
### Improved
- **User Experience**: เพิ่มการตอบสนองผ่านแป้นพิมพ์ (Hotkey Cues) และหน้าจอสรุปเหตุการณ์ (System Logs) ภายในเครื่อง
- **Version Bump**: ยกระดับระบบเป็น 1.3.0

## [1.2.1] - 2026-01-07
### Added
- **Feature (Patch History HUD)**: เพิ่มระบบเรียกดูประวัติการอัปเดต (Patch History) ได้จากหน้า Dashboard (F7) ในตัว Client
- **Browser Changelog Page**: เพิ่มหน้าแสดงประวัติการอัปเดตสำหรับฝั่ง Web Admin เข้าถึงได้จากหน้า User Guide
- **API (Changelog Provider)**: พัฒนา API สำหรับอ่านไฟล์บันทึกประวัติเพื่อนำไปแสดงผลบนหน้าเว็บ
### Improved
- **Version Tracking**: ยกระดับระบบติดตามเวอร์ชันเป็น 1.2.1

## [1.2.0] - 2026-01-07
### Added
- **Feature (F7 Dashboard)**: เพิ่มหน้าจอ Dashboard ภายในโปรแกรม Client (Electron) เพื่อตรวจสอบสถานะและแก้ไขการตั้งค่าได้โดยตรง
- **Dynamic Configuration**: สามารถแก้ไข Server IP, Device Name และ Branch Code ได้จากภายในแอป (ไม่ต้องแก้ไฟล์ config)
- **Force Refresh**: เพิ่มปุ่มสำหรับสั่ง Reload แอปพลิเคชัน
### Improved
- **User Interface**: ปรับปรุง UI ของ Dashboard ให้เป็นสไตล์ Glassmorphism (โปร่งแสงและเบลอหลัง)

## [1.1.0] - 2026-01-07
### Added
- **Registration Flow**: เพิ่มขั้นตอนการลงทะเบียน Device กับ Server API ครั้งแรกที่เปิดใช้งาน
- **Device Identity**: เพิ่มช่องกรอก Device Name ในหน้า Setup
### Improved
- **Configuration**: แยกการเก็บ Device ID ที่ได้รับจาก Server (UUID) ข้อมูลจะเสถียรกว่าการสุ่ม ID เอง

## [1.0.1] - 2026-01-07
### Fixed
- **System Logs Filter**: แก้ไขปัญหา Date Filter ในหน้า Admin (System Logs) ที่แสดงข้อมูลไม่ตรงกับวันที่เลือกเนื่องจาก Timezone Mismatch (UTC vs Local Time)
- **Playback Analytics**: แก้ไขการส่งค่าวันที่สำหรับสรุปสถิติให้รองรับช่วงเวลา 00:00 - 23:59 อย่างถูกต้อง

## [1.0.0] - 2025-12-30
### Added
- **Initial Release**: ระบบจัดการ Signage พื้นฐาน (Playlist, Media, Device Management)
- **Player Client**: โปรแกรมเล่นสื่อผ่าน Electron รองรับการเล่นวิดีโอและรูปภาพ
- **Offline Cache**: ระบบดาวน์โหลดไฟล์สื่อมาเก็บไว้ในเครื่องเพื่อเล่นแบบออฟไลน์
