# MSSQL Tables (NVARCHAR-based schema with Active = 'Y'/'N')

## 1. Devices
| Field             | Type            | Description |
|------------------|-----------------|-------------|
| DeviceId         | NVARCHAR(36) PK | GUID string |
| DeviceName       | NVARCHAR(255)   | ชื่ออุปกรณ์ |
| DeviceKey        | NVARCHAR(255)   | Unique Token/HWID |
| BranchCode       | NVARCHAR(100)   | รหัสสาขา |
| IpAddress        | NVARCHAR(50)    | IP ล่าสุด |
| Status           | NVARCHAR(50)    | ONLINE/OFFLINE |
| CurrentPlaylistId| NVARCHAR(36)    | Playlist ที่กำลังเล่น |
| CurrentPlaylistItemId | NVARCHAR(36) | Item ปัจจุบัน |
| CurrentMediaId    | NVARCHAR(36)    | Media ที่กำลังเล่น |
| CurrentPositionSec| INT             | วินาทีที่กำลังเล่น |
| LastCheckIn      | DATETIME        | อัปเดตล่าสุด (Heartbeat) |
| CreatedAt        | DATETIME        | วันที่ลงทะเบียน |
| Active           | NVARCHAR(1)     | Y/N |

---

## 1.1 DeviceCommands
| Field         | Type            | Description |
|---------------|-----------------|-------------|
| CommandId     | NVARCHAR(36) PK | GUID |
| DeviceId      | NVARCHAR(36)    | FK |
| CommandType   | NVARCHAR(50)    | RESTART, REFRESH, UPDATE_PLAYLIST |
| Status        | NVARCHAR(20)    | PENDING, EXECUTED |
| CreatedAt     | DATETIME        | |
| ExecutedAt    | DATETIME        | |

---

## 2. MediaFiles
| Field         | Type            | Description |
|---------------|-----------------|-------------|
| MediaId       | NVARCHAR(36) PK | GUID |
| FileName      | NVARCHAR(255)   | ชื่อไฟล์จริงในระบบ |
| DisplayName   | NVARCHAR(255)   | ชื่อที่แสดงบน Dashboard |
| BlobUrl       | NVARCHAR(MAX)   | Local Server URL (e.g. /media/filename.mp4) |
| DurationSec   | INT             | ความยาว (วินาที) |
| Ratio         | NVARCHAR(50)    | อัตราส่วนภาพ (16:9, 9:16) |
| FileSizeKB    | INT             | ขนาดไฟล์ (KB) |
| FileHash      | NVARCHAR(50)    | MD5 Hash (ใช้ตรวจสอบ Integrity บน Device) |
| Supplier_Code | NVARCHAR(100)   | รหัสคู่ค้า/เจ้าของโฆษณา |
| Remark1       | NVARCHAR(500)   | รายละเอียด/หมายเหตุ 1 |
| Remark2       | NVARCHAR(500)   | หมายเหตุ 2 |
| UploadedBy    | NVARCHAR(100)   | ผู้ส่งข้อมูล |
| UploadedAt    | DATETIME        | วันที่อัปโหลด |
| Active        | NVARCHAR(1)     | Y=Active, N=Inactive, D=Deleted |

---

## 3. Playlists
| Field        | Type            | Description |
|--------------|-----------------|-------------|
| PlaylistId   | NVARCHAR(36) PK | GUID |
| PlaylistName | NVARCHAR(255)   | |
| Description  | NVARCHAR(500)   | |
| CreatedBy    | NVARCHAR(100)   | |
| CreatedAt    | DATETIME        | |
| Active       | NVARCHAR(1)     | Y/N |

---

## 4. PlaylistItems
| Field           | Type            | Description |
|-----------------|-----------------|-------------|
| PlaylistItemId  | NVARCHAR(36) PK | GUID |
| PlaylistId      | NVARCHAR(36)    | FK |
| MediaId         | NVARCHAR(36)    | FK |
| PositionOrder   | INT             | ลำดับการเล่น |
| DurationOverride| INT NULL        | override |
| Active          | NVARCHAR(1)     | Y/N |

---

## 5. DevicePlaylistAssignments
| Field        | Type            | Description |
|--------------|-----------------|-------------|
| AssignmentId | NVARCHAR(36) PK | GUID |
| DeviceId     | NVARCHAR(36)    | FK |
| PlaylistId   | NVARCHAR(36)    | FK |
| AssignedAt   | DATETIME        | |
| StartDate    | DATETIME        | |
| EndDate      | DATETIME NULL   | |
| Active       | NVARCHAR(1)     | Y/N |

---

## 6. PlaybackLogs
| Field        | Type            | Description |
|--------------|-----------------|-------------|
| LogId        | NVARCHAR(36) PK | GUID |
| DeviceId     | NVARCHAR(36)    | FK |
| MediaId      | NVARCHAR(36)    | FK |
| PlayedAt     | DATETIME        | เวลาเริ่มเล่น |
| Duration     | INT             | วินาทีที่เล่นจริง |
| Result       | NVARCHAR(50)    | success/error |
| ErrorMessage | NVARCHAR(500)   | รายละเอียด |

---

## 7. SystemLogs
| Field        | Type              | Description |
|--------------|-------------------|-------------|
| LogId        | NVARCHAR(36) PK   | GUID |
| DeviceId     | NVARCHAR(36) NULL | optional FK |
| LogType      | NVARCHAR(50)      | info/error |
| Message      | NVARCHAR(MAX)     | รายละเอียด |
| CreatedAt    | DATETIME          | |

---

## 8. Users
| Field        | Type            | Description |
|--------------|-----------------|-------------|
| UserId       | NVARCHAR(36) PK | GUID |
| Username     | NVARCHAR(100)   | |
| PasswordHash | NVARCHAR(255)   | |
| FullName     | NVARCHAR(255)   | |
| Role         | NVARCHAR(50)    | admin/editor/viewer |
| Active       | NVARCHAR(1)     | Y/N |
| CreatedAt    | DATETIME        | |

---

## 9. Core Stored Procedures
Key logic is encapsulated in SPs.

### 9.1 sp_devices
*   **Actions**: `REGISTER`, `HEARTBEAT` (Updates status & LastCheckIn), `GET_ALL`, `GET_BY_ID`, `DELETE_DEVICE`, `CLEANUP_ZOMBIES`.
*   **Logic**: Heartbeat handles complex state updates (Playlist, Media, Position).

### 9.2 sp_playback_logs
*   **Actions**: 
    *   `INSERT`: Logs playback & updates Device Status to 'PLAYING'.
    *   `GET_LATEST`: Returns recent logs.
    *   `GET_SUMMARY`: Returns aggregated stats (Total Plays, Duration) by Media. Supports `@StartDate` / `@EndDate` filtering.
    *   `GET_BRANCH_SUMMARY`: Returns aggregated stats by Branch. Supports `@StartDate` / `@EndDate` filtering.
    *   `GET_EXPORT_DATA`: Returns raw, joined data (DeviceName, Branch, MediaName) for CSV export. Supports `@StartDate` / `@EndDate` filtering.
