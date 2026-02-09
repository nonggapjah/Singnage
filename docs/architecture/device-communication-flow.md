# Signage Unicorn - System Architecture & Device Workflow

## 1. System Overview & Challenge
**Scale**: 40+ Branches, 20+ Screens per branch (~800 Screens total).
**Challenge**: Simultaneous streaming of high-quality video content to 800 screens would cause massive bandwidth saturation and server overload.
**Solution**: **Decentralized Playback with Centralized Control**.
- **Client Side**: Uses "Mini Windows" Set-top boxes running a custom Player Application (Device).
- **Architecture**: "Store & Forward" model. Content is downloaded and cached locally on the device. Playback happens offline/locally to ensure smooth performance and zero network lag during playback.

---

## 2. Device (Client) Workflow
The Player Application triggers automatically upon OS boot.

### 2.1 Startup & Initialization (PWA Standalone)
1.  **PWA Service Worker**: The application uses a Service Worker (`sw.js`) and `manifest.json` to act as a Standalone App.
    *   **App Shell Caching**: HTML/JS/CSS are cached locally, allowing the player to boot even without internet (**No Dinosaur Page**).
2.  **Auto Start**: The application launches immediately when the device powers on (via Windows Startup).
3.  **Jingle Loop**: While initializing (less than 1s), the device displays a **Base64 Safety Jingle** stored in `localStorage`. The screen is never black.

### 2.2 Content Synchronization (Smart Sync)
The device queries the Central Server: *"What Playlist should I play? What is the content list?"*

#### 2.3 Intelligent Caching & Media Hub (Offline Survival)
The device **DOES NOT** stream video. It implements a **Media Hub** using the browser's **Cache API**:
1.  **Automatic Asset Sync**: As soon as a playlist is assigned, the device downloads ALL media files in the background.
2.  **Local Blob Resolution**: 
    *   Before playing any clip, the device checks its local Cache Hub.
    *   If found, it resolves the file to a **Local Blob URL**, ensuring 24/7 playback survival without internet.
3.  **Offline-Ready Playlist**: Even if the device restarts while offline, it retrieves both the Playlist Structure and the Media Blobs from its local storage/cache.

### 2.3 Playback & Logging
*   **Case 2.3.4 (Real-time Progress)**: The device sends its current playback position (Media ID and seconds) in every Heartbeat.
*   **Case 2.3.5 (Proof of Play - Persistent Queue)**: Every time a video clip **completes** playing, the device generates a `PlaybackLog`.
    *   **Offline First Strategy**: Logs are first stored in a **Local Queue** (`localStorage`).
    *   **Auto-Sync Mechanism**: The device attempts to sync the queue immediately after each clip and also during the **15-second heartbeat cycle**.
    *   **Fault Tolerance**: If the network is down or the device reboots, logs remain in `localStorage` and will be uploaded as a batch once connectivity is restored.
    *   This ensures 100% data integrity for auditing, even in unstable network environments.

---

### 2.5 Safety Jingle (Fallback Layer)
To ensure the screen is never black, a "Safety Jingle" is managed centrally.
1. **Central Config**: Admin selects a media item as the Global Safety Jingle.
2. **Offline Base64 Caching**: The device downloads this image and converts it into a **Base64 string**, storing it in `localStorage`.
3. **Instant Display**: This allows the Jingle to be displayed **instantly** during transitions, content loading, or when the device is completely offline and has no playlist data.

---

## 3. Dynamic Control & Hot-Swapping
How the system handles updates from Central Command without interrupting the viewer experience.

### 3.1 Playlist Updates
If the Server assigns a new Playlist to a Device:
1.  **Non-Blocking update**: The device **CONTINUES** playing the current video clip. It does not stop black.
2.  **Background Prep**: In the background, it begins the "Smart Sync" process (Step 2.3) for the *new* playlist.
3.  **Seamless Switch**: Once specific required assets are ready, it switches to the new playlist loop seamlessly.

### 3.2 Media Deletion (Cascade Logic)
When a Media item is deleted from the Library:
1. **Automatic Removal**: The system automatically removes that `MediaID` from all existing Playlists.
2. **Device Continuity**:
    - If a device is currently playing the deleted clip, it will **finish the clip** before skipping it in the next loop.
    - Devices receive an updated playlist manifest on their next sync and skip the deleted item.
    - This ensures no abrupt interruptions or "File Not Found" errors on the screen.

---

## 4. Central Control Dashboard (Server Side)
The Central Dashboard provides a "God View" of the network.

### 4.1 Real-time Visibility
*   **Who is Online?**: See status of all 800 devices immediately.
*   **What is Playing?**: Know exactly which Playlist/Video is currently on screen for any device.

### 4.2 Control & Command
*   **Change Playlist**: Push new content to specific branches or screens instantly or on schedule.
*   **Batch Deployment**: Command center can select multiple devices (by branch or status) and broadcast a playlist assignment in a single operation.
*   **No Downtime**: All commands are processed asynchronously; the screen never goes dark.

### 4.3 Error Handling & Watchdog
*   **Case 4.1 (Offline)**: If the device stops sending Heartbeats -> Mark as **OFFLINE**.
*   **Case 4.2 (Zombie State)**: If the device is ONLINE (sending Heartbeats) but **NOT sending PlaybackLogs** (Video stuck/Player hung):
    *   System flags an "Anomaly".
    *   Server sends a **RESTART COMMAND**.
    *   Device restarts the Player Application and resumes playback from the *last known good position* or specific index (to avoid repetitive loop start).

---

## 5. Device Specifics & Controls
The Player Application runs in Kiosk Mode with specific behaviors.

### 5.1 General Behavior
*   **Auto Login**: Windows Auto-login configured.
*   **Status Check**: Always queryable for "Current Status" and "Queue Position".

### 5.2 Hotkeys / Keyboard Shortcuts
For on-site maintenance and debugging by technicians.

| Key | Action | Description |
|-----|--------|-------------|
| **F1** | `Help` | Show Hud shortcut menu |
| **F2** | `Volume -2%` | Fine-tune volume down. |
| **F3** | `Volume +2%` | Fine-tune volume up. |
| **F4** | `Exit` | Close the Player Application completely. |
| **F5** | `Restart / Refresh` | Restart the app logic and resume the stuck clip. |
| **F6** | `Check Playlist` | Force an immediate sync with Server to check for assigned playlist updates. |
| **F7** | `Device Dashboard` | Open local Technician Dashboard (Stats, Config, Manual Select). |
| **F8** | `Reset Loop` | Force restart playback from Item #1 of the current Playlist. |

### 5.3 Device Dashboard (Local Mode)
Accessed via **F7**, this interface is local to the specific device and allows technicians to:
1.  **View Local Statistics & Readiness**:
    *   **Network Status**: Online/Offline status and local IP.
    *   **Offline Readiness**: 
        *   **READY**: All clips in the current playlist are successfully cached.
        *   **SYNCING (X/Y)**: Number of clips currently downloaded for offline play.
    *   **Playlist Tracking**: Dual progress indicators for Clip (MM:SS) and Playlist Loop (Total Duration).
    *   **Last Sync Timestamp**.
2.  **Manual Playlist Selection (Local Override)**:
    *   Browse a list of **Active Playlists** available on the Server.
    *   Manually select and "Force Play" a specific playlist for testing or ad-hoc changes.
    *   *Note: This overrides the scheduled assignment until reset.*
3.  **Maintenance Actions**:
    *   **Force Sync**: Redownload current playlist.
    *   **Clear Cache**: Delete local media files to force fresh validation.

---

## 6. Native Desktop Client (Standalone Version)
For mission-critical deployments where 100% network independence is required.
*   **Technology**: Built with Electron. Runs as a native Windows/Linux/macOS application.
*   **Embedded Assets**: Includes a hard-coded **Safety Jingle** inside the app bundle. This jingle displays even if the OS has never connected to the internet.
*   **Local Disk Hub**: Uses the physical Hard Drive (not browser cache) to store media files. Allows for TBs of video content storage.
*   **Auto-Update**: Can update itself and the media library in the background.
*   **Boot Resilience**: Since the code resides on the local disk, there is **ZERO chance** of a "Dinosaur Page" appearing during boot.
