# User Role Permissions (RBAC)

This document outlines the permissions and access control matrix for the Signage Unicorn system, based on the backend API controllers.

**Roles defined:** `Admin`, `Editor`, `Viewer` (Default).
**Anonymous:** Unauthenticated devices/users (Player, Kiosk).

## Permission Matrix

| Feature Domain | Action / Endpoint | Anonymous | Viewer | Editor | Admin |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **Authentication** | Login / Register | ✅ | - | - | - |
| **Dashboard** | View Statistics (Live) | ❌ | ✅ | ✅ | ✅ |
| **Devices** | Register (`/register`) | ✅ | - | - | - |
| | Heartbeat (`/heartbeat`) | ✅ | - | - | - |
| | View Device List & Details | ❌ | ✅ | ✅ | ✅ |
| | **Send Command** (Single/Batch) | ❌ | ❌ | ❌ | ✅ |
| | **Manage Device** (Deactivate, Cleanup) | ❌ | ❌ | ❌ | ✅ |
| | Fix Database Schema | ❌ | ❌ | ❌ | ✅ |
| **Media Library** | View Media / Search | ❌ | ✅ | ✅ | ✅ |
| | Get Details (For Player) | ✅ | ✅ | ✅ | ✅ |
| | Get Media Usage | ❌ | ✅ | ✅ | ✅ |
| | **Upload / Update / Replace** | ❌ | ❌ | ✅ | ✅ |
| | **Delete Media** | ❌ | ❌ | ✅ | ✅ |
| **Playlists** | View / Search | ❌ | ✅ | ✅ | ✅ |
| | Get Details (for Player) | ✅ | ✅ | ✅ | ✅ |
| | **Create / Update** | ❌ | ❌ | ✅ | ✅ |
| | **Manage Items** (Add/Remove/Sort) | ❌ | ❌ | ✅ | ✅ |
| | **Delete Playlist** | ❌ | ❌ | ✅ | ✅ |
| **System Settings** | Read Settings (e.g. Jingle) | ✅ | ✅ | ✅ | ✅ |
| | **Update Settings** | ❌ | ❌ | ❌ | ✅ |
| **Users** | View All Users | ❌ | ❌ | ✅ | ✅ |
| | **Manage Users** (Create/Edit/Delete) | ❌ | ❌ | ✅* | ✅ |
| | *Manage Admins* | ❌ | ❌ | ❌ | ✅ |
| **Logs & Analytics** | Create Log (System/Playback) | ✅ | ✅ | ✅ | ✅ |
| | View System Logs | ❌ | ✅ | ✅ | ✅ |
| | View Playback Analytics | ❌ | ✅ | ✅ | ✅ |
| | **Clear Old Logs** | ❌ | ❌ | ❌ | ✅ |
| | **Export Data** | ❌ | ❌ | ❌ | ✅ |

---

## Detailed Role Definitions

### 1. Admin (`admin`)
The Super User. Has unrestricted access to all system functions.
- **Exclusive Rights:**
  - Create/Delete other Admin users.
  - Modify Global System Settings (e.g. Safety Jingle, Config).
  - Execute Remote Commands on Devices (Reboot, Reload, Sync).
  - Perform Database Maintenance (Cleanup, Fix DB).
  - Access sensitive capabilities like Exporting data or Clearing logs.

### 2. Editor (`editor`)
Content Manager. Can manage media and behavior, but cannot touch system infrastructure.
- **Allowed:**
  - Full Media Library management (Upload, Edit, Delete).
  - Full Playlist management (Create, Edit, Schedule).
  - User Management (Can create/edit Viewers and Editors).
- **Restricted:**
  - Cannot manage Devices (Read-only).
  - Cannot change System Settings.
  - Cannot create or modify Admin users.

### 3. Viewer (`viewer`)
Read-only access. Used for monitoring or basic staff access.
- **Allowed:**
  - View Dashboard Stats.
  - Browse Media Library and Playlists.
  - View Logs and Reports.
- **Restricted:**
  - Cannot modify ANY content (Media/Playlist).
  - Cannot change settings or users.

### 4. Player (Anonymous)
Unauthenticated capabilities reserved for Terminal Nodes (Kiosks).
- **Allowed:**
  - Register itself as a new device.
  - Send Heartbeat signals.
  - Fetch assigned Playlist and Media data (Read-only).
  - Upload Logs (System/Playback).
