const { ipcRenderer } = require('electron');
const path = require('path');
const url = require('url');

let config = null;
let playlist = [];
let currentIndex = 0;
let isPlaying = false;
let heartbeatTimer = null;
let currentItemTimer = null;
let mediaStartTime = 0;
let mediaDuration = 0;
let volume = 50;
let isMuted = true;
let isUpdating = false;
let clockTimer, syncTimer;
let cacheProgress = 0;
let pendingPlaylist = null; // Next playlist waiting for smooth swap
let isSyncing = false;     // Prevent multiple sync loops
let isBootReportSent = false; // Boot Report: send full device info once

// Queues for Offline Sync
let systemLogQueue = JSON.parse(localStorage.getItem('system_log_queue') || '[]');
let playbackLogQueue = JSON.parse(localStorage.getItem('playback_queue') || '[]');

const hudOverlay = document.getElementById('hud-overlay');

const jingleEl = document.getElementById('safety-jingle');
const videoEl = document.getElementById('video-player');
const imageEl = document.getElementById('image-player');
const deviceInfoEl = document.getElementById('device-info');
const statusDot = document.getElementById('status-dot');
const setupScreen = document.getElementById('setup-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const patchHistoryScreen = document.getElementById('patch-history-screen');
const changelogContent = document.getElementById('changelog-content');
const configOverlay = document.getElementById('config-overlay');
const helpScreen = document.getElementById('help-screen');
const playlistSelectScreen = document.getElementById('playlist-select-screen');
const playlistListContainer = document.getElementById('playlist-list-container');

// Dashboard UI Elements
const dashStatus = document.getElementById('dash-status');
const dashDeviceId = document.getElementById('dash-device-id');
const dashDeviceIdInput = document.getElementById('dash-device-id-input');
const dashDeviceNameDisp = document.getElementById('dash-device-name-display');
const dashPlaylistName = document.getElementById('dash-playlist-name');
const dashLoopInfo = document.getElementById('dash-loop-info');
const dashCurrentMedia = document.getElementById('dash-current-media');
const dashPos = document.getElementById('dash-pos');
const dashDur = document.getElementById('dash-dur');
const dashMediaBar = document.getElementById('dash-media-bar');
const dashSyncBar = document.getElementById('dash-sync-bar');
const dashCachedCount = document.getElementById('dash-cached-count');
const dashTotalCount = document.getElementById('dash-total-count');
const dashReadyStatus = document.getElementById('dash-ready-status');
const storageUsed = document.getElementById('storage-used');
const storageTotal = document.getElementById('storage-total');
const storageBar = document.getElementById('storage-bar');
const logContainer = document.getElementById('log-container');

async function init() {
    config = await ipcRenderer.invoke('get-config');
    volume = config.volume ?? 50;
    isMuted = config.isMuted ?? true;
    videoEl.muted = isMuted;
    videoEl.volume = isMuted ? 0 : volume / 100;

    // Inject app version from package.json into all .app-version elements
    const appVersion = await ipcRenderer.invoke('get-app-version');
    document.querySelectorAll('.app-version').forEach(el => el.textContent = `v${appVersion}`);

    // Load Cached Jingle
    const cachedJingle = localStorage.getItem('safety_jingle_data');
    if (cachedJingle) jingleEl.src = cachedJingle;

    if (!config.deviceId) {
        showSetup();
    } else {
        startSync();
        updateStorage();
        syncJingle(); // New in v1.5.0: Sync global jingle
    }
}

// --- Jingle Sync (Matches signage-unicorn-web) ---
async function syncJingle() {
    if (!config.serverIp) return;
    try {
        const res = await fetch(`${config.serverIp}/api/v1/system/settings/safety_jingle_id`);
        const data = await res.json();
        const serverJingleId = data.data;
        const savedJingleId = localStorage.getItem('safety_jingle_id');

        if (serverJingleId && serverJingleId !== savedJingleId) {
            addLog(`Global Jingle Update: ${serverJingleId}`);
            const mediaRes = await fetch(`${config.serverIp}/api/v1/media/${serverJingleId}`);
            const mediaData = await mediaRes.json();

            if (mediaData.success && mediaData.data.blobUrl) {
                const url = mediaData.data.blobUrl;
                const response = await fetch(url);
                const blob = await response.blob();
                const reader = new FileReader();
                reader.onloadend = () => {
                    const base64data = reader.result;
                    localStorage.setItem('safety_jingle_data', base64data);
                    localStorage.setItem('safety_jingle_id', serverJingleId);
                    jingleEl.src = base64data;
                    addLog('System Jingle cached locally');
                };
                reader.readAsDataURL(blob);
            }
        }
    } catch (e) {
        console.warn("Jingle sync failed", e);
    }
}

// --- Logging System ---
function addLog(msg, type = 'info', skipSync = false) {
    const time = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = 'log-line latest';
    line.innerText = `[${time}] ${msg}`;

    if (type === 'error') line.style.color = '#ff4d4d';
    if (type === 'warn') line.style.color = '#f1c40f';

    const previous = logContainer.querySelector('.latest');
    if (previous) previous.classList.remove('latest');

    logContainer.prepend(line);
    while (logContainer.children.length > 50) logContainer.removeChild(logContainer.lastChild);

    if (!skipSync && config && config.deviceId) {
        systemLogQueue.push({
            deviceId: config.deviceId,
            logType: type.toUpperCase(),
            message: msg,
            source: 'Player',
            createdAt: new Date().toISOString()
        });
        saveSystemQueue();
    }
}

function showHUD(msg, duration = 3000) {
    const notice = document.createElement('div');
    notice.className = 'hud-notice';
    notice.innerText = msg;
    hudOverlay.appendChild(notice);
    setTimeout(() => {
        notice.style.opacity = '0';
        notice.style.transform = 'translateY(-20px)';
        notice.style.transition = 'all 0.5s ease-in';
        setTimeout(() => notice.remove(), 500);
    }, duration);
}

function updateCursorVisibility() {
    const shouldShow = !dashboardScreen.classList.contains('hidden') ||
        !setupScreen.classList.contains('hidden') ||
        !playlistSelectScreen.classList.contains('hidden') ||
        !helpScreen.classList.contains('hidden') ||
        !patchHistoryScreen.classList.contains('hidden');

    if (shouldShow) document.body.classList.add('show-cursor');
    else document.body.classList.remove('show-cursor');
}

function highlightShortcut(btnId) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.style.background = '#00f2ff';
    btn.querySelector('.shortcut-key').style.color = '#000';
    setTimeout(() => {
        btn.style.background = '';
        btn.querySelector('.shortcut-key').style.color = '';
    }, 200);
}

function saveSystemQueue() {
    try {
        if (systemLogQueue.length > 500) {
            systemLogQueue = systemLogQueue.slice(-500); // Prevent infinite growth
        }
        localStorage.setItem('system_log_queue', JSON.stringify(systemLogQueue));
    } catch (err) {
        console.error("Local Storage quota exceeded, wiping queue", err);
        systemLogQueue = [];
        localStorage.setItem('system_log_queue', '[]');
    }
}

async function syncSystemLogs() {
    if (systemLogQueue.length === 0 || !config.serverIp) return;

    // Process in batches of 50
    const batchSize = 50;
    const batch = systemLogQueue.slice(0, batchSize);

    try {
        const res = await fetch(`${config.serverIp}/api/v1/logs/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(batch)
        });

        if (res.ok) {
            systemLogQueue.splice(0, batch.length);
            saveSystemQueue();
            console.log(`Synced ${batch.length} system logs (Batch)`);

            // If there's more, sync again soon
            if (systemLogQueue.length > 0) {
                setTimeout(syncSystemLogs, 1000);
            }
        }
    } catch (err) {
        console.warn("System Log Batch Sync failed", err.message);
    }
}

async function recordPlayback(item, duration, result = 'success', error = '') {
    if (item.playlistItemId && item.playlistItemId.startsWith('FALLBACK')) {
        return;
    }
    const log = {
        deviceId: config.deviceId,
        mediaId: item.media.mediaId,
        playlistId: item.playlistId || config.lastPlaylistId || null,
        duration: Math.max(1, Math.floor(duration / 1000)),
        result: result,
        errorMessage: error,
        playedAt: new Date().toISOString()
    };

    // Save to SQLite via Main process
    await ipcRenderer.invoke('db-insert-playback-log', log);

    // Attempt sync
    syncPlaybackLogs();
}

async function syncPlaybackLogs() {
    if (!config || !config.serverIp || !config.deviceId) return;

    try {
        // Fetch up to 100 pending logs at a time
        const pending = await ipcRenderer.invoke('db-get-pending-logs', 100);
        if (!pending || pending.length === 0) return;

        console.log(`SQLite: Syncing ${pending.length} playback logs in batch...`);

        // Prepare batch for API
        const batch = pending.map(row => ({
            deviceId: row.deviceId,
            mediaId: row.mediaId,
            playlistId: row.playlistId,
            duration: row.duration,
            result: row.result,
            errorMessage: row.errorMessage,
            playedAt: row.playedAt
        }));

        const res = await fetch(`${config.serverIp}/api/v1/logs/playback/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(batch)
        });

        if (res.ok) {
            const data = await res.json();
            const syncedIds = pending.map(p => p.id);
            await ipcRenderer.invoke('db-mark-logs-synced', syncedIds);

            console.log(`SQLite Batch Sync SUCCESS: ${data.count} items recorded.`);

            // Clear synced logs from DB to keep it lean
            await ipcRenderer.invoke('db-clear-synced-logs');

            // If we hit the limit, there might be more... call again
            if (pending.length >= 100) {
                setTimeout(syncPlaybackLogs, 1000);
            }
        } else {
            console.warn('SQLite Batch Sync Failed (Server Error)', res.status);
        }
    } catch (err) {
        // Quietly fail during heartbeat if offline
        console.error('SQLite Sync Network Error:', err.message);
    }
}

// --- Sync & Heartbeat ---
async function startSync() {
    const version = await ipcRenderer.invoke('get-app-version');
    dashDeviceId.innerText = config.deviceId;
    dashDeviceNameDisp.innerText = `NAME: ${config.deviceName || 'UNNAMED'}`;
    deviceInfoEl.innerText = `${config.deviceName || 'DEVICE'} • v${version}`;

    addLog(`System initialized. Version ${version}`);

    // Auto-resume last playlist on boot if exists
    if (config.lastPlaylistId) {
        const savedIndex = parseInt(localStorage.getItem('last_playlist_index') || '0');
        addLog(`Auto-resuming last playlist: ${config.lastPlaylistId} at index ${savedIndex}`);
        loadPlaylist(config.lastPlaylistId, savedIndex);
    }

    await sync();
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(sync, 15000);
}

async function sync() {
    try {
        // Build heartbeat payload
        const heartbeatData = {
            deviceId: config.deviceId,
            deviceName: config.deviceName,
            branchCode: config.branchCode,
            status: isPlaying ? 'PLAYING' : 'IDLE',
            currentPlaylistId: (playlist[currentIndex] && playlist[currentIndex].playlistId) ? playlist[currentIndex].playlistId : (config.lastPlaylistId || ''),
            currentMediaId: (playlist[currentIndex] && playlist[currentIndex].media) ? playlist[currentIndex].media.mediaId : '',
            currentPlaylistItemId: (playlist[currentIndex]) ? playlist[currentIndex].playlistItemId : '',
            currentPositionSec: isPlaying ? Math.floor(videoEl.currentTime) : 0,
            cacheProgress: cacheProgress
        };

        // --- AUTO-RETRY LOGIC (v2.3.3) ---
        // If we have a playlist ID but nothing is playing and no items are loaded, retry load.
        // This fixes the "starting morning with jingle only" issue if net was down at boot.
        if (!isPlaying && playlist.length === 0 && config.lastPlaylistId) {
            addLog(`Auto-Retry: No playlist active, attempting to load ${config.lastPlaylistId}...`, 'warn');
            const savedIndex = parseInt(localStorage.getItem('last_playlist_index') || '0');
            loadPlaylist(config.lastPlaylistId, savedIndex);
        }

        // Boot Report: enrich first heartbeat with device metadata
        if (!isBootReportSent) {
            const version = await ipcRenderer.invoke('get-app-version');
            heartbeatData.appVersion = `Client ${version}`;
            heartbeatData.ratio = `${window.screen.width}x${window.screen.height}`;
            console.log(`[Boot Report] Sending: v${version}, ${heartbeatData.ratio}`);
        }

        const res = await fetch(`${config.serverIp}/api/v1/devices/heartbeat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(heartbeatData)
        });

        if (res.ok) {
            const data = await res.json();
            statusDot.style.background = '#00f2ff';
            dashStatus.innerText = 'ONLINE';
            dashStatus.style.color = '#00f2ff';

            if (!isBootReportSent) {
                isBootReportSent = true;
                addLog('Boot Report sent successfully.', 'info', true);
            }

            if (data.data && data.data.length > 0) {
                for (const cmd of data.data) {
                    addLog(`Received command: ${cmd.commandType}`);
                    const type = cmd.commandType;
                    if (type === 'FORCE_SYNC') { showHUD('REMOTE SYNC'); loadPlaylist(config.lastPlaylistId); }
                    if (type === 'RELOAD' || type === 'REFRESH') { showHUD('RELOADING...'); setTimeout(() => window.location.reload(), 1000); }
                    if (type === 'WIPE_CACHE') {
                        showHUD('WIPING CACHE...');
                        ipcRenderer.invoke('clear-cache').then(() => {
                            setTimeout(() => window.location.reload(), 1000);
                        });
                    }
                    if (type === 'REBOOT') { showHUD('SYSTEM REBOOT...'); ipcRenderer.invoke('reboot-device'); }
                    if (type.startsWith('RESTART')) {
                        const parts = type.split(':');
                        if (parts.length >= 3) {
                            localStorage.setItem('resume_media_id', parts[1]);
                            localStorage.setItem('resume_pos_sec', parts[2]);
                            addLog(`Saved resume state: Media ${parts[1]} at ${parts[2]}s`);
                        }
                        showHUD('SYSTEM REBOOT...');
                        ipcRenderer.invoke('reboot-device');
                    }
                    if (type === 'UPDATE_CLIENT') {
                        if (isUpdating) {
                            addLog('Client update already in progress. Skipping duplicate command.', 'warn');
                            continue;
                        }
                        showHUD('UPDATING CLIENT...');
                        addLog('Remote Client Update triggered.', 'info', true);
                        isUpdating = true;
                        try {
                            const dr = await fetch(`${config.serverIp}/api/v1/system/settings/ClientDownloadUrl`).then(r => r.json());
                            if (dr.data) {
                                const dl = await ipcRenderer.invoke('download-update', { url: dr.data });
                                if (dl.success) {
                                    addLog('Update downloaded. Launching installer...', 'warn', true);
                                    ipcRenderer.invoke('launch-installer', dl.path);
                                } else {
                                    addLog(`Download failed: ${dl.error}`, 'error', true);
                                    isUpdating = false;
                                }
                            } else {
                                isUpdating = false;
                            }
                        } catch (e) {
                            addLog(`Update failed to trigger: ${e.message}`, 'error', true);
                            isUpdating = false;
                        }
                    }
                    if (type === 'SYNC_SCHEDULE') {
                        showHUD('REMOTE SCHEDULE');
                        addLog('Remote Schedule Sync triggered.', 'info', true);
                        loadPlaylist('SCHEDULE');
                    }
                    if (type === 'CAPTURE_SCREEN') {
                        addLog('Remote Screen Capture triggered.', 'info', true);
                        try {
                            const result = await ipcRenderer.invoke('capture-screen');
                            if (result.success) {
                                const response = await fetch(`${config.serverIp}/api/v1/devices/${config.deviceId}/screenshot`, {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json'
                                    },
                                    body: JSON.stringify({ base64Image: result.base64 })
                                });
                                if (response.ok) {
                                    addLog('Screen capture uploaded successfully.', 'info', true);
                                } else {
                                    addLog(`Screen capture upload failed: Status ${response.status}`, 'error', true);
                                }
                            } else {
                                addLog(`Screen capture failed: ${result.error}`, 'error', true);
                            }
                        } catch (e) {
                            addLog(`Screen capture exception: ${e.message}`, 'error', true);
                        }
                    }
                    if (type.startsWith('PLAY_PLAYLIST:')) {
                        const pid = type.split(':')[1];
                        if (pid) { showHUD('REMOTE PLAYLIST'); loadPlaylist(pid); }
                    }

                    // --- ACK: Report command as EXECUTED ---
                    try {
                        const ackUrl = `${config.serverIp}/api/v1/devices/${config.deviceId}/command/ack`;
                        await fetch(ackUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                commandId: cmd.deviceCommandId || cmd.commandId,
                                status: 'EXECUTED'
                            })
                        });
                        addLog(`Command ${type} acknowledged.`, 'info', true);
                    } catch (e) {
                        addLog(`Failed to ACK command: ${e.message}`, 'warn', true);
                    }
                }
            }
            syncPlaybackLogs();
            syncSystemLogs();

            // Self-Healing: Check if any playlist items are missing on disk and download them in the background
            if (!isSyncing && playlist && playlist.length > 0) {
                (async () => {
                    let hasMissing = false;
                    for (const item of playlist) {
                        const media = item.media;
                        if (media) {
                            const exists = await ipcRenderer.invoke('check-media-exists', {
                                filename: media.fileName
                            });
                            if (!exists) {
                                hasMissing = true;
                                break;
                            }
                        }
                    }
                    if (hasMissing) {
                        addLog("Self-Healing: Detected missing/corrupted files in cache. Triggering sync...", "warn");
                        const currentHash = localStorage.getItem('playlist_hash') || '';
                        pendingPlaylist = {
                            id: config.lastPlaylistId,
                            name: dashPlaylistName.innerText,
                            items: playlist,
                            hash: currentHash
                        };
                        syncPendingAssets();
                    }
                })();
            }
        } else throw new Error('Status ' + res.status);
    } catch (err) {
        statusDot.style.background = '#ff4d4d';
        dashStatus.innerText = 'OFFLINE';
        dashStatus.style.color = '#ff4d4d';
        addLog(`Heartbeat failed: ${err.message}`, 'error', true);
    }
}

// --- Playlist Management ---
async function loadPlaylist(playlistId, resumeIndex = 0) {
    if (!playlistId) return;
    try {
        dashReadyStatus.innerText = 'SYNCING...';
        dashReadyStatus.style.color = '#f1c40f';
        addLog(`Loading playlist data: ${playlistId}`);

        let items = [];
        let playlistName = 'Standard Loop';

        try {
            const apiPath = playlistId === 'SCHEDULE'
                ? `/api/v1/devices/${config.deviceId}/schedule`
                : `/api/v1/playlists/${playlistId}`;

            const res = await fetch(`${config.serverIp}${apiPath}`);
            const data = await res.json();
            if (data.success && data.data.items) {
                // Ensure items are sorted by positionOrder
                items = data.data.items.filter(i => i.media).sort((a, b) => a.positionOrder - b.positionOrder);
                playlistName = data.data.playlistName || playlistName;

                // --- Cache in SQLite for Offline Survival ---
                await ipcRenderer.invoke('db-save-playlist', {
                    id: playlistId,
                    data: { items, playlistName }
                });
            }
        } catch (fetchErr) {
            addLog(`Server unreachable, trying SQLite cache...`, 'warn');
            const cachedData = await ipcRenderer.invoke('db-get-playlist', playlistId);
            if (cachedData) {
                items = cachedData.items;
                playlistName = cachedData.playlistName;
                addLog(`Offline Mode: Loaded from SQLite cache`);
            } else {
                throw new Error("No local SQLite cache found for this playlist.");
            }
        }

        if (items.length > 0) {
            // --- Content Hashing (Smart Sync) ---
            // Include fileName in hash so renames (like _v2) trigger re-sync
            const contentHash = playlistId + '|' + items.map(i => `${i.mediaId}-${i.media.fileName}-${i.durationOverride || 0}`).join(',');
            const savedHash = localStorage.getItem('playlist_hash');

            dashPlaylistName.innerText = playlistName;
            dashTotalCount.innerText = items.length;

            if (contentHash === savedHash && playlist.length > 0) {
                // Check if all files in the playlist actually exist on disk
                let allFilesExist = true;
                for (const item of items) {
                    const media = item.media;
                    if (media) {
                        const exists = await ipcRenderer.invoke('check-media-exists', {
                            filename: media.fileName
                        });
                        if (!exists) {
                            allFilesExist = false;
                            break;
                        }
                    }
                }
                if (allFilesExist) {
                    addLog("Smart Sync: Hash matches and all files exist. Skipping re-download.");
                    dashReadyStatus.innerText = 'READY';
                    dashReadyStatus.style.color = '#00f2ff';
                    return;
                } else {
                    addLog("Smart Sync: Hash matches but some files are missing. Re-syncing...", "warn");
                }
            }

            // --- Background Smooth Sync ---
            if (pendingPlaylist && pendingPlaylist.hash === contentHash && isSyncing) {
                // If we are already syncing the SAME playlist version, just keep going
                addLog(`Sync already active for ${playlistId} version. Continuing...`);
                return;
            }

            addLog(`Smooth Sync: Queuing ${items.length} items in background...`);
            pendingPlaylist = { id: playlistId, name: playlistName, items, hash: contentHash };

            // Start background sequential download
            syncPendingAssets();
        } else {
            addLog("Playlist contains 0 items. Triggering fallback...", "warn");
            await loadFallbackPlaylist();
        }
    } catch (err) {
        addLog(`Load playlist failed: ${err.message}`, 'error');
        dashReadyStatus.innerText = 'SYNC ERROR';
        dashReadyStatus.style.color = '#ff4d4d';
        await loadFallbackPlaylist();
    }
}

async function loadFallbackPlaylist() {
    addLog("Emergency Mode: Loading local fallback playlist...", "warn");
    try {
        const fallbackItems = await ipcRenderer.invoke('get-fallback-media');
        if (fallbackItems && fallbackItems.length > 0) {
            playlist = fallbackItems;
            currentIndex = 0;
            dashPlaylistName.innerText = "EMERGENCY FALLBACK";
            dashTotalCount.innerText = playlist.length;
            dashReadyStatus.innerText = 'EMERGENCY';
            dashReadyStatus.style.color = '#e74c3c';
            playNext();
        } else {
            addLog("Emergency Mode: No fallback files found in fallback_media folder.", "error");
        }
    } catch (e) {
        addLog(`Emergency Mode failed: ${e.message}`, 'error');
    }
}

async function syncPendingAssets() {
    if (isSyncing || !pendingPlaylist) return;
    isSyncing = true;

    try {
        const items = pendingPlaylist.items;
        let synced = 0;
        cacheProgress = 0;

        for (const item of items) {
            // If user switched to a COMPLETELY DIFFERENT playlist during sync, abort.
            // But if it just swapped to this one as active (pendingPlaylist becomes null), keep going.
            if (pendingPlaylist && pendingPlaylist.items !== items) {
                addLog("Sync aborted: New playlist detected.", "warn");
                break;
            }

            const media = item.media;
            dashReadyStatus.innerText = `SYNCING ${synced + 1}/${items.length}`;
            dashReadyStatus.style.color = '#f1c40f';

            try {
                // console.log(`Downloader: Start Item ${synced + 1}/${items.length} - ${media.fileName}`);
                const res = await ipcRenderer.invoke('download-media', {
                    url: media.blobUrl,
                    filename: media.fileName,
                    fileHash: media.fileHash
                });

                if (res && res.success) {
                    synced++;
                    // console.log(`Downloader: Success Item ${synced}/${items.length}`);
                } else {
                    addLog(`Download failed for ${media.fileName}: ${res?.error || 'Unknown error'}`, 'warn');
                }

                // Update UI progress while moving
                cacheProgress = Math.round((synced / items.length) * 100);
                dashCachedCount.innerText = synced;
                dashSyncBar.style.width = cacheProgress + '%';

                // --- IMMEDIATE START IF IDLE ---
                // If it's the first clip and we aren't playing anything, start NOW
                if (synced === 1 && !isPlaying) {
                    addLog("Idle Player: First clip ready, starting playback.");
                    swapToPending();
                }
            } catch (e) {
                addLog(`Sync error for ${media.fileName}: ${e.message}`, 'warn');
            }
        }

        // Final UI update: Only set to READY if we actually finished downloading everything
        // and we haven't started a NEW sync for a different playlist.
        if (!pendingPlaylist || (pendingPlaylist && pendingPlaylist.items === items)) {
            const isFullySynced = synced === items.length;
            if (isFullySynced) {
                addLog(`Background Sync Complete (${items.length} clips).`);
                dashReadyStatus.innerText = 'READY';
                dashReadyStatus.style.color = '#00f2ff';
            } else {
                addLog(`Sync finished with gaps: ${synced}/${items.length} ready.`, 'warn');
                dashReadyStatus.innerText = 'PARTIAL';
                dashReadyStatus.style.color = '#f1c40f';
            }
        }
    } finally {
        isSyncing = false;
    }
}

async function swapToPending() {
    if (!pendingPlaylist) return;

    addLog(`Swapping to new playlist: '${pendingPlaylist.name}'`);
    playlist = pendingPlaylist.items;
    config.lastPlaylistId = pendingPlaylist.id;
    localStorage.setItem('playlist_hash', pendingPlaylist.hash);
    await ipcRenderer.invoke('save-config', config);

    dashPlaylistName.innerText = pendingPlaylist.name;
    dashTotalCount.innerText = playlist.length;
    // dashReadyStatus.innerText = 'READY'; // BUG: Removed! Don't set READY until syncPendingAssets actually finishes.

    pendingPlaylist = null;
    currentIndex = 0;
    playNext();
}

// --- Playback Engine ---
function formatTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function updatePlaybackHUD() {
    if (!isPlaying) return;
    const elapsed = Date.now() - mediaStartTime;
    const progress = Math.min(100, (elapsed / mediaDuration) * 100);
    dashPos.innerText = formatTime(elapsed);
    dashMediaBar.style.width = progress + '%';
}
setInterval(updatePlaybackHUD, 500);

async function playNext() {
    if (playlist.length === 0) {
        isPlaying = false; jingleEl.classList.remove('hidden');
        dashCurrentMedia.innerText = '▶ IDLE / WAITING'; 
        try {
            videoEl.pause();
            videoEl.removeAttribute('src');
            videoEl.load();
            imageEl.removeAttribute('src');
        } catch (e) {}
        return;
    }
    localStorage.setItem('last_playlist_index', currentIndex);
    isPlaying = true;
    const item = playlist[currentIndex];
    const media = item.media;
    const isFallback = item.playlistItemId && item.playlistItemId.startsWith('FALLBACK');

    // Check if file is physically downloaded to prevent trying to play 0-byte/partial files
    const isReady = isFallback ? true : await ipcRenderer.invoke('check-media-exists', {
        filename: media.fileName
    });
    if (!isReady) {
        addLog(`Skip: ${media.fileName} (still syncing)`, 'warn');
        currentIndex = (currentIndex + 1) % playlist.length;

        // Timeout prevents infinite aggressive looping if 100% of files aren't ready
        setTimeout(playNext, 1000);
        return;
    }

    const localDir = isFallback 
        ? await ipcRenderer.invoke('get-fallback-path')
        : await ipcRenderer.invoke('get-local-path');
    const localFile = url.pathToFileURL(path.join(localDir, media.fileName)).href;

    dashCurrentMedia.innerText = `▶ ${media.displayName || media.fileName}`;
    dashLoopInfo.innerText = `ITEM ${currentIndex + 1} / ${playlist.length}`;

    mediaStartTime = Date.now();
    const rawDuration = item.durationOverride || media.durationSec || 10;
    mediaDuration = Math.max(1, parseInt(rawDuration) || 10) * 1000;
    dashDur.innerText = formatTime(mediaDuration);
    jingleEl.classList.add('hidden');

    addLog(`Playing: ${media.displayName || media.fileName} (${currentIndex + 1}/${playlist.length})`);

    const onComplete = async (skipLog = false) => {
        if (currentItemTimer) clearTimeout(currentItemTimer);
        if (!skipLog) recordPlayback(item, Date.now() - mediaStartTime);

        // --- SMOOTH SWAP LOGIC ---
        if (pendingPlaylist && pendingPlaylist.items.length > 0) {
            const firstMedia = pendingPlaylist.items[0].media;
            const isReady = await ipcRenderer.invoke('check-media-exists', {
                filename: firstMedia.fileName
            });

            if (isReady) {
                swapToPending();
                return;
            } else {
                addLog("Smooth Swap: Next playlist first item not ready yet. Staying on current.", "warn");
            }
        }

        currentIndex = (currentIndex + 1) % playlist.length;
        playNext();
    };

    if (media.fileName.toLowerCase().match(/\.(mp4|webm|mov)$/)) {
        if (currentItemTimer) clearTimeout(currentItemTimer);

        // If same file (1-item loop), reset and play explicitly
        if (videoEl.src === localFile) {
            videoEl.currentTime = 0;
            videoEl.play().catch(e => console.warn("Auto-play blocked or failed", e));
        } else {
            videoEl.src = localFile;
            videoEl.load(); // Ensure fresh load
            videoEl.play().catch(e => console.warn("Auto-play blocked or failed", e));
        }

        videoEl.classList.remove('hidden'); imageEl.classList.add('hidden');
        videoEl.onended = () => {
            if (currentItemTimer) clearTimeout(currentItemTimer);
            onComplete(false);
        };

        // --- WATCHDOG: Force next video if it hangs longer than duration + 60s (SAFE BUFFER) ---
        // Only set watchdog if we actually have a duration > 0
        if (mediaDuration > 0) {
            currentItemTimer = setTimeout(() => {
                addLog(`Watchdog: Video ${media.fileName} hung. Forcing next.`, 'warn');
                onComplete(true); // Treat as error skip
            }, mediaDuration + 60000);
        }

        videoEl.onerror = async () => {
            if (currentItemTimer) clearTimeout(currentItemTimer);
            const err = videoEl.error ? `Code ${videoEl.error.code}: ${videoEl.error.message}` : 'Unknown Playback Error';
            console.error('Video Error:', err, localFile);
            recordPlayback(item, 0, 'error', err);
            
            // Delete corrupt file from local cache for auto-recovery
            addLog(`Error playing ${media.fileName}. Deleting cached file for auto-recovery.`, 'warn');
            await ipcRenderer.invoke('delete-cached-file', media.fileName);

            setTimeout(() => onComplete(true), 2000);
        };
    } else {
        // Clear video element to release hardware decoders/memory
        try {
            videoEl.pause();
            videoEl.removeAttribute('src');
            videoEl.load();
        } catch (e) {}

        imageEl.src = localFile; imageEl.classList.remove('hidden'); videoEl.classList.add('hidden');
        if (currentItemTimer) clearTimeout(currentItemTimer);
        currentItemTimer = setTimeout(() => onComplete(false), mediaDuration);
        imageEl.onerror = () => {
            if (currentItemTimer) clearTimeout(currentItemTimer);
            const err = 'Image Load Failed';
            console.error(err, localFile);
            recordPlayback(item, 0, 'error', err);
            setTimeout(() => onComplete(true), 2000);
        };
    }
}

// --- Interaction & Utils ---
function updateStorage() {
    ipcRenderer.invoke('get-storage-info').then(info => {
        storageUsed.innerText = info.used; storageTotal.innerText = info.total;
        storageBar.style.width = info.percent + '%';
    });
}

function showSetup() {
    setupScreen.classList.remove('hidden');
    document.getElementById('server-ip').value = config.serverIp || 'https://signage.aith123.com';
    document.getElementById('save-settings').onclick = async () => {
        const ip = document.getElementById('server-ip').value.replace(/\/$/, "");
        const name = document.getElementById('device-name').value;
        const branch = document.getElementById('branch-code').value;
        const loc = document.getElementById('location').value;
        if (!ip || !name) return alert('โปรดกรอกข้อมูล');
        try {
            const uuid = await ipcRenderer.invoke('get-machine-uuid');
            const res = await fetch(`${ip}/api/v1/devices/register`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    deviceKey: uuid,
                    deviceName: name,
                    branchCode: branch,
                    location: loc,
                    ipAddress: '127.0.0.1'
                })
            });
            const result = await res.json();
            if (result.success) {
                config.serverIp = ip; config.deviceName = name; config.branchCode = branch; config.location = loc; config.deviceId = result.data.deviceId;
                await ipcRenderer.invoke('save-config', config);
                setupScreen.classList.add('hidden');
                updateCursorVisibility();
                startSync();
            }
        } catch (err) {
            console.error('Registration failed:', err);
            alert(`Connect error: ${ip}\nReason: ${err.message}`);
        }
    };
}

document.getElementById('show-playlists').onclick = () => {
    playlistSelectScreen.classList.remove('hidden');
    playlistListContainer.innerHTML = 'Loading...';
    fetch(`${config.serverIp}/api/v1/playlists/active`).then(r => r.json()).then(data => {
        if (data.success) {
            playlistListContainer.innerHTML = '';
            data.data.forEach(p => {
                const card = document.createElement('div'); card.className = 'playlist-card';
                card.style.cssText = 'background:#111;padding:15px;border:1px solid #333;border-radius:10px;cursor:pointer;';
                card.innerHTML = `<div style="color:#00f2ff;font-weight:900;">${p.playlistName}</div><div style="font-size:10px;color:#555;">${p.itemCount} Items</div>`;
                card.onclick = () => { if (confirm('Change Playlist?')) { loadPlaylist(p.playlistId); playlistSelectScreen.classList.add('hidden'); } };
                playlistListContainer.appendChild(card);
            });
        }
    });
};

document.getElementById('update-settings').onclick = async () => {
    // 1. Gather Values
    const newIp = document.getElementById('dash-server-ip').value.replace(/\/$/, "");
    const newId = document.getElementById('dash-device-id-input').value;
    const newName = document.getElementById('dash-device-name').value;
    const newBranch = document.getElementById('dash-branch-code').value;
    const newLocation = document.getElementById('dash-location').value;

    if (!newIp || !newId || !newName) return alert('Settings cannot be empty.');

    // 2. Warn if ID changed
    const isIdChanged = newId !== config.deviceId;
    if (isIdChanged) {
        if (!confirm('CRITICAL: Changing Device ID will register a NEW device identity.\n\nAre you sure?')) return;
    }

    showHUD('TESTING CONNECTION...');

    // 3. Test Connection / Register
    try {
        const appVer = await ipcRenderer.invoke('get-app-version');

        // Use 'register' to handshake. It handles Create (if new ID) or Update (if existing ID).
        const res = await fetch(`${newIp}/api/v1/devices/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                deviceKey: newId,
                deviceName: newName,
                branchCode: newBranch,
                location: newLocation,
                ipAddress: '127.0.0.1', // Server should detect real IP. We send placeholder.
                appVersion: appVer
            })
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const result = await res.json();

        if (result.success) {
            // 4. Success -> Save Config
            config.serverIp = newIp;
            config.deviceId = newId;
            config.deviceName = newName;
            config.branchCode = newBranch;
            config.location = newLocation;

            await ipcRenderer.invoke('save-config', config);
            showHUD('UPDATED. RESTARTING...');
            setTimeout(() => window.location.reload(), 1500);
        } else {
            alert('Server Rejected Update: ' + (result.message || 'Unknown Error'));
        }
    } catch (err) {
        console.error(err);
        alert(`Connection Failed to ${newIp}\n\nError: ${err.message}\n\nSettings were NOT saved.`);
    }
};

document.getElementById('show-config').onclick = () => {
    configOverlay.classList.remove('hidden');
    document.getElementById('dash-device-id-input').value = config.deviceId || '';
    document.getElementById('dash-server-ip').value = config.serverIp || '';
    document.getElementById('dash-device-name').value = config.deviceName || '';
    document.getElementById('dash-branch-code').value = config.branchCode || '';
    document.getElementById('dash-location').value = config.location || '';
    updateCursorVisibility();
};

document.getElementById('hide-config').onclick = () => {
    configOverlay.classList.add('hidden');
    updateCursorVisibility();
};

document.getElementById('force-sync').onclick = () => {
    showHUD('MANUAL SYNC');
    loadPlaylist(config.lastPlaylistId);
};

document.getElementById('clear-cache-btn').onclick = async () => {
    if (confirm('Wipe all local media cache?')) {
        showHUD('WIPING CACHE...');
        await ipcRenderer.invoke('clear-cache');
        window.location.reload();
    }
};

document.getElementById('refresh-app-btn').onclick = () => {
    showHUD('RELOADING...');
    setTimeout(() => window.location.reload(), 500);
};

document.getElementById('vol-down').onclick = () => adjustVolume(-5);
document.getElementById('vol-up').onclick = () => adjustVolume(5);

document.getElementById('view-patch-history').onclick = async () => {
    patchHistoryScreen.classList.remove('hidden');
    changelogContent.innerText = "Loading history from server...";
    updateCursorVisibility();

    try {
        // 1. Try API first (Best for latest info)
        if (config && config.serverIp) {
            try {
                const res = await fetch(`${config.serverIp}/api/v1/changelog`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.success && data.data) {
                        changelogContent.innerText = data.data;
                        return; // Found on server, we're done
                    }
                }
            } catch (apiErr) {
                console.warn("Changelog API failed, falling back to local file...", apiErr.message);
            }
        }

        // 2. Fallback to Local File (Best for Offline)
        const text = await ipcRenderer.invoke('read-changelog');
        changelogContent.innerText = text;
    } catch (err) {
        changelogContent.innerText = "Failed to load patch history: " + err.message;
    }
};
document.getElementById('close-patch-history').onclick = () => {
    patchHistoryScreen.classList.add('hidden');
    updateCursorVisibility();
};

document.getElementById('close-playlists').onclick = () => {
    playlistSelectScreen.classList.add('hidden');
    updateCursorVisibility();
};

document.getElementById('close-help').onclick = () => {
    helpScreen.classList.add('hidden');
    updateCursorVisibility();
};

document.getElementById('btn-f1').onclick = () => { helpScreen.classList.remove('hidden'); updateCursorVisibility(); };
document.getElementById('btn-f2').onclick = () => adjustVolume(-5);
document.getElementById('btn-f3').onclick = () => adjustVolume(5);
document.getElementById('btn-f4').onclick = async () => {
    isMuted = !isMuted;
    videoEl.muted = isMuted;
    videoEl.volume = isMuted ? 0 : volume / 100;
    config.isMuted = isMuted;
    await ipcRenderer.invoke('save-config', config);
    showHUD(isMuted ? 'MUTED' : 'UNMUTED');
    updateCursorVisibility();
};
document.getElementById('btn-f5').onclick = () => window.location.reload();
document.getElementById('btn-f6').onclick = () => { showHUD('MANUAL SYNC'); sync(); };
document.getElementById('btn-f7').onclick = () => { dashboardScreen.classList.toggle('hidden'); updateCursorVisibility(); };
document.getElementById('btn-f8').onclick = () => { showHUD('RESETTING LOOP'); currentIndex = 0; playNext(); };
document.getElementById('btn-esc').onclick = () => {
    [patchHistoryScreen, helpScreen, configOverlay, dashboardScreen, playlistSelectScreen].forEach(s => s.classList.add('hidden'));
    updateCursorVisibility();
};

async function adjustVolume(delta) {
    volume = Math.max(0, Math.min(100, volume + delta));
    if (isMuted && delta > 0) {
        isMuted = false;
    }
    videoEl.muted = isMuted;
    videoEl.volume = isMuted ? 0 : volume / 100;
    config.volume = volume;
    config.isMuted = isMuted;
    await ipcRenderer.invoke('save-config', config);
    addLog(`Vol: ${volume}%`);
    showHUD(`VOLUME: ${volume}%`);
}

window.addEventListener('keydown', async e => {
    if (e.key === 'F1') { highlightShortcut('btn-f1'); helpScreen.classList.remove('hidden'); }
    if (e.key === 'F2') { highlightShortcut('btn-f2'); adjustVolume(-5); }
    if (e.key === 'F3') { highlightShortcut('btn-f3'); adjustVolume(5); }
    if (e.key === 'F4') {
        highlightShortcut('btn-f4');
        isMuted = !isMuted;
        videoEl.muted = isMuted;
        videoEl.volume = isMuted ? 0 : volume / 100;
        config.isMuted = isMuted;
        await ipcRenderer.invoke('save-config', config);
        showHUD(isMuted ? 'MUTED' : 'UNMUTED');
    }
    if (e.key === 'F5') { highlightShortcut('btn-f5'); showHUD('RELOADING...'); setTimeout(() => window.location.reload(), 500); }
    if (e.key === 'F6') { highlightShortcut('btn-f6'); showHUD('MANUAL SYNC'); sync(); }
    if (e.key === 'F7') { highlightShortcut('btn-f7'); dashboardScreen.classList.toggle('hidden'); }
    if (e.key === 'F8') { highlightShortcut('btn-f8'); showHUD('RESETTING LOOP'); currentIndex = 0; playNext(); }
    if (e.key === 'F11') {
        const isFullscreen = await ipcRenderer.invoke('toggle-fullscreen');
        showHUD(isFullscreen ? 'FULLSCREEN ON' : 'WINDOW MODE');
    }
    if (e.key === 'Escape') {
        document.getElementById('btn-esc').click();
    }

    if (e.key === 'Enter') {
        if (!setupScreen.classList.contains('hidden')) {
            document.getElementById('save-settings').click();
        }
    }

    updateCursorVisibility();
});

document.getElementById('check-update-btn').onclick = async () => {
    if (isUpdating) { alert("An update is already in progress."); return; }
    const msg = document.getElementById('update-status-msg'); msg.innerText = "Checking...";
    const cur = await ipcRenderer.invoke('get-app-version');
    const res = await fetch(`${config.serverIp}/api/v1/system/settings/LatestClientVersion`).then(r => r.json());
    if (res.data && res.data !== cur) {
        msg.innerText = `New: ${res.data}`;
        if (confirm(`Download v${res.data}?`)) {
            isUpdating = true;
            try {
                const dr = await fetch(`${config.serverIp}/api/v1/system/settings/ClientDownloadUrl`).then(r => r.json());
                const downloadUrl = (dr.data && dr.data.startsWith('http'))
                    ? dr.data
                    : `${config.serverIp}${dr.data || '/setup/Signage_Unicorn_Setup_latest.exe'}`;

                const dl = await ipcRenderer.invoke('download-update', { url: downloadUrl });
                if (dl.success) {
                    ipcRenderer.invoke('launch-installer', dl.path);
                } else {
                    alert(`Download failed: ${dl.error}`);
                    isUpdating = false;
                    msg.innerText = "Try again.";
                }
            } catch (err) {
                alert(`Update check failed: ${err.message}`);
                isUpdating = false;
            }
        }
    } else msg.innerText = "Up to date.";
};

init();
