// Signage Unicorn — renderer.
//
// This script runs SANDBOXED (contextIsolation + sandbox, no Node integration): there is no
// require() here. Every privileged operation goes through the preload bridge
// window.signage.invoke(channel, ...args) — see preload.js for the channel allowlist.
const ipcRenderer = { invoke: (channel, ...args) => window.signage.invoke(channel, ...args) };

// Pure helpers shared with node:test (src/lib/*.js, loaded by index.html before this file).
const SignageLib = window.SignageLib || {};
const { cacheNameFor: libCacheNameFor, contentHashFor: libContentHashFor } = SignageLib.cacheName;
const { backoffDelay, createRateLimiter } = SignageLib.backoff;
const { createLoadSequencer, decideAfterVerify } = SignageLib.jobQueue;
const { classifyBatchResponse } = SignageLib.playbackBatch;
const { checkUpdateUrl } = SignageLib.updateUrl;
const { classifyClaimResponse, claimRetryDelay, raceRetryDelay } = SignageLib.claim;

const CLIENT_PROTOCOL = '2';                 // contract T5: server leases every command as POLLING for us
const TOKEN_RECLAIM_MIN_MS = 10 * 60 * 1000; // contract T3: one re-claim per 10 minutes at most
const HEALTH_REPORT_MS = 15000;              // Codex 22: renderer liveness report cadence
const EMPTY_RETRY_MIN_MS = 5 * 60 * 1000;    // Codex 7: do not re-ask for an empty schedule every heartbeat
const PLAYBACK_UPLOAD_BACKOFF = { baseMs: 5000, maxMs: 5 * 60 * 1000, jitterMs: 2000 };

let config = null;
let playlist = [];
let currentIndex = 0;
let isPlaying = false;
let heartbeatTimer = null;
let heartbeatRetryTimer = null;
let heartbeatFailures = 0;
let currentItemTimer = null;
let playbackToken = 0;       // increments per item so a stale handler can never advance twice
let mediaStartTime = 0;
let mediaDuration = 0;
let volume = 50;
let isMuted = true;
let isUpdating = false;
let isHeartbeating = false;  // Guard: prevent concurrent heartbeat calls
let isBootReportSent = false; // Boot Report: send full device info once
let cachedMachineUuid = null;
let cachedMacAddress = null;  // BUG-03: stable hardware id so the server can merge identities on upgrade
let cacheProgress = 0;
let tokenRejected = false;
let tokenClaimAttempted = false;
let claimEndpointMissing = false;
let apiCapabilities = null;      // R1: GET /api/v1/system/capabilities (null = not probed, {legacy:true} = old API)
let claimRetryTimer = null;      // Codex #8: boot-claim retries on 429/5xx/network, bounded backoff
let claimRetryFailures = 0;
let claimFirstFailureAt = 0;
let claimRaceRetried = false;    // R3: one short retry after 409 TOKEN_RACE
const tokenReclaimLimiter = createRateLimiter(TOKEN_RECLAIM_MIN_MS, { jitterMs: 60 * 1000 });
let lastReportedPlaying = null;
let isSyncingPlaybackLogs = false;
let isSyncingSystemLogs = false;
let playbackUploadFailures = 0;
let playbackUploadNotBefore = 0;
let skipTimer = null;       // Codex 21: the only missing-file retry timer, cancelled on every transition
let skipStreak = 0;         // consecutive items skipped because their file is not on disk
let healthTimer = null;
let lastEmptyPlaylistAt = 0;
const loadSeq = createLoadSequencer(); // Codex 8: load numbers are taken BEFORE the first await
const inFlightCommandIds = new Set();

// --- Serialized sync worker (F25) ---
// Every loadPlaylist() request becomes a job with an increasing generation id. The worker always
// downloads the NEWEST requested job; a running job checks after every item whether it has been
// superseded and, when a job ends (complete or aborted), the worker immediately picks up the
// newest one. There is no longer a flag that can be left set while a newer playlist waits.
let syncGeneration = 0;
let requestedJob = null;   // newest playlist version asked for
let activeJob = null;      // job whose assets are being downloaded right now
let swapTarget = null;     // job that becomes the playing playlist once its first clip is ready
let syncWorkerRunning = false;
let scheduleRefreshTimer = null;
let pruneTimer = null;

const HEARTBEAT_INTERVAL_MS = 15000;
const SCHEDULE_REFRESH_MS = 15 * 60 * 1000;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const TIMEOUTS = { heartbeat: 15000, playlist: 60000, logs: 30000, settings: 15000, ack: 10000, media: 60000 };

// Queue for Offline Sync (system logs). Playback logs live in SQLite via main.
let systemLogQueue = JSON.parse(localStorage.getItem('system_log_queue') || '[]');

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
const dashIp = document.getElementById('dash-ip');
const dashSecurity = document.getElementById('dash-security');
const dashLogDir = document.getElementById('dash-logdir');
const dashApi = document.getElementById('dash-api');
const storageUsed = document.getElementById('storage-used');
const storageTotal = document.getElementById('storage-total');
const storageBar = document.getElementById('storage-bar');
const logContainer = document.getElementById('log-container');

// =============================================================================================
// Helpers
// =============================================================================================
function serverUrl(apiPath) {
    return `${String(config.serverIp).replace(/\/$/, '')}${apiPath}`;
}

// Every device request carries the protocol version (contract T5) and the device token when one
// has been issued (contract 1).
function deviceHeaders(extra = {}) {
    const headers = { 'Content-Type': 'application/json', 'X-Client-Protocol': CLIENT_PROTOCOL, ...extra };
    if (config && config.deviceToken) headers['X-Device-Token'] = config.deviceToken;
    return headers;
}

// Smoke-test progress (smoke/run-smoke.js); a no-op outside smoke mode.
function smokeEvent(name, value) {
    ipcRenderer.invoke('smoke-event', name, value).catch(() => { });
}

// Bounded fetch (F24 / Codex 20): the deadline covers headers AND body. A server that answers
// headers and then stalls the body used to hold the heartbeat forever once the timer was cleared.
// The timer is released when the body has been consumed (readJsonSafe) or explicitly
// (releaseResponse); if neither happens, the abort only cancels an unread body.
const responseDeadlines = new WeakMap();
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
        res = await fetch(url, { ...options, signal: controller.signal });
    } catch (e) {
        clearTimeout(timer);
        throw e;
    }
    responseDeadlines.set(res, timer);
    return res;
}

function releaseResponse(res) {
    const timer = res ? responseDeadlines.get(res) : null;
    if (timer) {
        clearTimeout(timer);
        responseDeadlines.delete(res);
    }
}

async function readJsonSafe(res) {
    try {
        return await res.json();
    } catch (e) {
        return null;
    } finally {
        releaseResponse(res);
    }
}

// Returns true when a 401 was the server rejecting our device token (contract 1). Pass `body`
// when the JSON has already been read.
async function handleUnauthorized(res, body) {
    if (!res || res.status !== 401) return false;
    const b = body === undefined ? await readJsonSafe(res) : body;
    releaseResponse(res);
    const message = b && b.message ? String(b.message).toUpperCase() : '';
    if (message.includes('DEVICE_TOKEN_INVALID')) {
        markTokenRejected('DEVICE_TOKEN_INVALID');
        scheduleTokenReclaim('401 DEVICE_TOKEN_INVALID');
        return true;
    }
    return false;
}

function markTokenRejected(code) {
    if (!tokenRejected) {
        tokenRejected = true;
        addLog(`DEVICE TOKEN REJECTED by server (${code || 'DEVICE_TOKEN_INVALID'}). The player will try to re-claim at most once per 10 minutes; if that keeps failing an administrator must reset this device token on the server (Devices > Reset token). Keeping the normal heartbeat cadence.`, 'error', true);
    }
    if (dashSecurity) {
        dashSecurity.textContent = 'DEVICE TOKEN REJECTED – reset on server';
        dashSecurity.style.color = '#ff4d4d';
    }
}

function markClaimEvidenceMismatch() {
    addLog('TOKEN CLAIM REFUSED: the server says this screen\'s hardware evidence (machine uuid / MAC) does not match the device it is registered as (CLAIM_EVIDENCE_MISMATCH). Check for a duplicate or re-imaged device row. Continuing without a token.', 'error', true);
    if (dashSecurity) {
        dashSecurity.textContent = 'TOKEN CLAIM REFUSED – evidence mismatch (check device row)';
        dashSecurity.style.color = '#ff4d4d';
    }
}

// Cache file name (contract 3): the sanitized basename of the blobUrl path, which the server
// guarantees unique per stored file version. Never the logical fileName, which is user-chosen.
function cacheNameFor(media) {
    if (!media) return null;
    if (media.isFallback) return media.cacheName || media.fileName;
    return libCacheNameFor(media.blobUrl, media.mediaId, (config && config.serverIp) ? config.serverIp : 'http://localhost');
}

function augmentItems(items) {
    for (const item of items) {
        if (!item.media) continue;
        if (!item.media.isFallback) {
            item.media.legacyFilename = item.media.fileName;
            item.media.cacheName = cacheNameFor(item.media);
        }
    }
    return items;
}

// Codex #16: when the server's answer hashes identically to what is playing, still refresh the
// per-item attribution (playlist / item ids, display name) so proof-of-play and the heartbeat
// name the current campaign. The hash now includes those ids, so this only matters for a list
// that was cached by an older client build.
function refreshAttribution(freshItems) {
    if (!Array.isArray(freshItems) || freshItems.length !== playlist.length) return;
    for (let i = 0; i < playlist.length; i++) {
        const cur = playlist[i];
        const fresh = freshItems[i];
        if (!cur || !fresh || !cur.media || !fresh.media || String(cur.mediaId) !== String(fresh.mediaId)) continue;
        cur.playlistId = fresh.playlistId;
        cur.playlistItemId = fresh.playlistItemId;
        if (fresh.media.displayName) cur.media.displayName = fresh.media.displayName;
    }
}

// Change detection includes the stored-file name and hash, so replacing bytes under the same
// media id or file name is noticed (F21), and each item's playlist/item identity (Codex #16).
function contentHashFor(playlistId, items) {
    return libContentHashFor(playlistId, items);
}

function mediaExists(media) {
    if (!media || !media.cacheName) return Promise.resolve(false);
    return ipcRenderer.invoke('check-media-exists', { cacheName: media.cacheName, fileHash: media.fileHash, isFallback: !!media.isFallback });
}

function mediaFileUrl(media) {
    return ipcRenderer.invoke('resolve-media-url', { cacheName: media.cacheName, isFallback: !!media.isFallback });
}

function isVideoMedia(media) {
    const name = (media && (media.cacheName || media.fileName)) || '';
    return /\.(mp4|webm|mov)$/i.test(name) || /\.(mp4|webm|mov)$/i.test(String(media && media.fileName || ''));
}

function reportPlaybackState() {
    if (lastReportedPlaying === isPlaying) return;
    lastReportedPlaying = isPlaying;
    ipcRenderer.invoke('set-playback-state', { playing: isPlaying, deviceId: config ? config.deviceId : null }).catch(() => { });
}

function setStatus(text, color) {
    dashStatus.textContent = text;
    dashStatus.style.color = color;
    statusDot.style.background = color;
}

// =============================================================================================
// Init
// =============================================================================================
async function init() {
    config = await ipcRenderer.invoke('get-config');
    volume = config.volume ?? 50;
    isMuted = config.isMuted ?? true;
    videoEl.muted = isMuted;
    videoEl.volume = isMuted ? 0 : volume / 100;

    // Inject app version from package.json into all .app-version elements
    const appVersion = await ipcRenderer.invoke('get-app-version');
    document.querySelectorAll('.app-version').forEach(el => el.textContent = `v${appVersion}`);

    await restoreCachedJingle();

    // Liveness report to main (Codex 22) starts before anything else so a screen stuck on the
    // setup page still proves its renderer is alive.
    if (healthTimer) clearInterval(healthTimer);
    healthTimer = setInterval(reportHealth, HEALTH_REPORT_MS);
    reportHealth();

    if (!config.deviceId) {
        showSetup();
    } else {
        startSync();
        updateStorage();
        syncJingle(); // Sync global jingle
    }
}

function reportHealth() {
    ipcRenderer.invoke('report-health', {
        playing: isPlaying,
        position: isPlaying ? Math.floor((Date.now() - mediaStartTime) / 1000) : 0,
        itemIndex: currentIndex,
        deviceId: config ? config.deviceId : null,
        ts: Date.now()
    }).catch(() => { });
}

async function restoreCachedJingle() {
    const cacheName = localStorage.getItem('safety_jingle_cache');
    if (cacheName) {
        try {
            jingleEl.src = await ipcRenderer.invoke('resolve-media-url', { cacheName });
            return;
        } catch (e) {
            localStorage.removeItem('safety_jingle_cache');
        }
    }
    // Older clients cached the jingle as a base64 data URL; keep using it until the file copy exists.
    const legacy = localStorage.getItem('safety_jingle_data');
    if (legacy && legacy.startsWith('data:')) jingleEl.src = legacy;
}

// --- Jingle Sync (downloaded by main, so no renderer fetch of media is needed) ---
async function syncJingle() {
    if (!config.serverIp) return;
    try {
        const res = await fetchWithTimeout(serverUrl('/api/v1/system/settings/safety_jingle_id'), { headers: deviceHeaders() }, TIMEOUTS.settings);
        const data = await readJsonSafe(res);
        const serverJingleId = data && data.data ? String(data.data) : '';
        const savedJingleId = localStorage.getItem('safety_jingle_id');
        const savedCache = localStorage.getItem('safety_jingle_cache');

        if (serverJingleId && (serverJingleId !== savedJingleId || !savedCache)) {
            addLog(`Global Jingle Update: ${serverJingleId}`);
            const mediaRes = await fetchWithTimeout(serverUrl(`/api/v1/media/${encodeURIComponent(serverJingleId)}`), { headers: deviceHeaders() }, TIMEOUTS.settings);
            const mediaData = await readJsonSafe(mediaRes);

            if (mediaData && mediaData.success && mediaData.data && mediaData.data.blobUrl) {
                const m = mediaData.data;
                const cacheName = 'jingle_' + cacheNameFor(m);
                const dl = await ipcRenderer.invoke('download-media', { url: m.blobUrl, cacheName, fileHash: m.fileHash });
                if (dl && dl.success) {
                    jingleEl.src = await ipcRenderer.invoke('resolve-media-url', { cacheName });
                    localStorage.setItem('safety_jingle_cache', cacheName);
                    localStorage.setItem('safety_jingle_id', serverJingleId);
                    localStorage.removeItem('safety_jingle_data');
                    addLog('System Jingle cached locally');
                } else {
                    addLog(`Jingle download failed: ${dl && dl.error ? dl.error : 'unknown'}`, 'warn');
                }
            }
        }
    } catch (e) {
        console.warn("Jingle sync failed", e);
    }
}

// =============================================================================================
// Logging System
// =============================================================================================
function addLog(msg, type = 'info', skipSync = false) {
    const time = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = 'log-line latest';
    line.textContent = `[${time}] ${msg}`;

    if (type === 'error') line.style.color = '#ff4d4d';
    if (type === 'warn') line.style.color = '#f1c40f';

    const previous = logContainer.querySelector('.latest');
    if (previous) previous.classList.remove('latest');

    logContainer.prepend(line);
    while (logContainer.children.length > 50) logContainer.removeChild(logContainer.lastChild);

    // Persistent copy in <userData>/logs (the panel above only keeps 50 lines in memory).
    ipcRenderer.invoke('log-line', { level: type, message: msg }).catch(() => { });

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
    notice.textContent = msg;
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
    const key = btn.querySelector('.shortcut-key');
    if (key) key.style.color = '#000';
    setTimeout(() => {
        btn.style.background = '';
        if (key) key.style.color = '';
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
    if (systemLogQueue.length === 0 || !config || !config.serverIp) return;
    if (isSyncingSystemLogs) return;
    isSyncingSystemLogs = true;

    // Process in batches of 50
    const batchSize = 50;
    const batch = systemLogQueue.slice(0, batchSize);

    try {
        const res = await fetchWithTimeout(serverUrl('/api/v1/logs/batch'), {
            method: 'POST',
            headers: deviceHeaders(),
            body: JSON.stringify(batch)
        }, TIMEOUTS.logs);

        if (res.status === 401) {
            await handleUnauthorized(res);
            return;
        }
        if (!res.ok) {
            releaseResponse(res);
            return;
        }
        if (res.ok) {
            const data = await readJsonSafe(res);
            if (data && data.success === false) return; // keep the batch
            systemLogQueue.splice(0, batch.length);
            saveSystemQueue();
            const stored = data && data.data && typeof data.data.stored === 'number' ? ` (${data.data.stored} stored, ${data.data.dropped || 0} dropped)` : '';
            console.log(`Synced ${batch.length} system logs (Batch)${stored}`);

            // If there's more, sync again soon
            if (systemLogQueue.length > 0) {
                setTimeout(syncSystemLogs, 1000);
            }
        }
    } catch (err) {
        console.warn("System Log Batch Sync failed", err.message);
    } finally {
        isSyncingSystemLogs = false;
    }
}

async function recordPlayback(item, duration, result = 'success', error = '') {
    if (item.playlistItemId && String(item.playlistItemId).startsWith('FALLBACK')) {
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

    // Save to SQLite via Main process (main assigns the eventId)
    await ipcRenderer.invoke('db-insert-playback-log', log);

    // Attempt sync
    syncPlaybackLogs();
}

// Proof-of-play upload (contract 4 / T6): one in-flight batch; only `accepted` events are deleted,
// `rejected` ones are parked; a 503 RETRY_LATER, any 5xx, a 4xx or a network failure keeps every
// event and backs off (a transient database problem must never destroy the only copy).
async function syncPlaybackLogs() {
    if (!config || !config.serverIp || !config.deviceId) return;
    if (isSyncingPlaybackLogs) return;
    if (Date.now() < playbackUploadNotBefore) return;
    isSyncingPlaybackLogs = true;

    try {
        // Fetch up to 100 pending logs at a time
        const pending = await ipcRenderer.invoke('db-get-pending-logs', 100);
        if (!pending || pending.length === 0) return;

        console.log(`SQLite: Syncing ${pending.length} playback logs in batch...`);

        const batch = pending.map(row => ({
            eventId: row.eventId,
            deviceId: row.deviceId,
            mediaId: row.mediaId,
            playlistId: row.playlistId,
            duration: row.duration,
            result: row.result,
            errorMessage: row.errorMessage,
            playedAt: row.playedAt
        }));

        let res = null;
        let body = null;
        let networkError = false;
        try {
            res = await fetchWithTimeout(serverUrl('/api/v1/logs/playback/batch'), {
                method: 'POST',
                headers: deviceHeaders(),
                body: JSON.stringify(batch)
            }, TIMEOUTS.logs);
            body = await readJsonSafe(res);
        } catch (e) {
            networkError = true;
        }

        const verdict = classifyBatchResponse({ status: res ? res.status : 0, body, networkError });
        if (verdict.action === 'unauthorized') {
            await handleUnauthorized(res, body);
            playbackUploadFailures++;
            playbackUploadNotBefore = Date.now() + backoffDelay(playbackUploadFailures, PLAYBACK_UPLOAD_BACKOFF);
            return;
        }
        if (verdict.action === 'retry') {
            playbackUploadFailures++;
            const wait = backoffDelay(playbackUploadFailures, PLAYBACK_UPLOAD_BACKOFF);
            playbackUploadNotBefore = Date.now() + wait;
            console.warn(`Playback log sync: ${verdict.reason}; keeping ${pending.length} event(s), retrying in ${Math.round(wait / 1000)}s.`);
            return;
        }
        playbackUploadFailures = 0;
        playbackUploadNotBefore = 0;

        if (verdict.action === 'apply') {
            const accepted = verdict.accepted;
            const rejected = verdict.rejected;
            if (accepted.length > 0) await ipcRenderer.invoke('db-delete-logs-by-event-ids', accepted);
            if (rejected.length > 0) {
                const reasons = rejected.slice(0, 3).map(r => r.reason || 'unknown').join('; ');
                addLog(`Server rejected ${rejected.length} playback log(s): ${reasons}`, 'warn', true);
                await ipcRenderer.invoke('db-mark-logs-rejected', rejected.map(r => r.eventId));
            }
            // verdict.retry (retryable per-event failures) simply stays pending.
            if (accepted.length > 0) smokeEvent('playbackLogsAccepted', accepted.length);
            console.log(`Playback logs: ${accepted.length} accepted, ${rejected.length} rejected, ${verdict.retry.length} to retry.`);
        } else {
            // Legacy API: no per-event result. HTTP 200 + success means the batch was stored.
            await ipcRenderer.invoke('db-mark-logs-synced', pending.map(p => p.id));
            await ipcRenderer.invoke('db-clear-synced-logs');
            smokeEvent('playbackLogsAccepted', pending.length);
            console.log(`SQLite Batch Sync SUCCESS (legacy API): ${pending.length} items recorded.`);
        }

        // If we hit the limit, there might be more... call again
        if (pending.length >= 100) {
            setTimeout(syncPlaybackLogs, 1000);
        }
    } catch (err) {
        console.error('SQLite Sync Error:', err.message);
    } finally {
        isSyncingPlaybackLogs = false;
    }
}

// =============================================================================================
// Sync & Heartbeat
// =============================================================================================
async function refreshSecurityPanel() {
    try {
        const diag = await ipcRenderer.invoke('get-diagnostics-info');
        if (dashIp) dashIp.textContent = `DIAG PORTAL ${diag.portalUrl}  •  TOKEN ${diag.diagToken || '-'}`;
        if (dashLogDir) dashLogDir.textContent = `LOGS ${diag.logDir || '-'}`;
        if (dashApi) dashApi.textContent = describeApi();
        if (dashSecurity && !tokenRejected) {
            const skew = diag.clockSkewDetected ? `  •  CLOCK SKEW ${diag.clockSkewSeconds}s` : '';
            dashSecurity.textContent = `DEVICE TOKEN: ${config && config.deviceToken ? 'OK' : 'NONE (legacy)'}${skew}`;
            dashSecurity.style.color = diag.clockSkewDetected ? '#f1c40f' : '#9a9a9a';
        }
    } catch (e) {
        // diagnostics are optional
    }
}

async function startSync() {
    cachedMachineUuid = await ipcRenderer.invoke('get-machine-uuid');
    cachedMacAddress = await ipcRenderer.invoke('get-mac-address');
    const version = await ipcRenderer.invoke('get-app-version');
    dashDeviceId.textContent = config.deviceId;
    dashDeviceNameDisp.textContent = `NAME: ${config.deviceName || 'UNNAMED'}`;
    deviceInfoEl.textContent = `${config.deviceName || 'DEVICE'} • v${version}`;

    addLog(`System initialized. Version ${version}`);
    refreshSecurityPanel();
    reportPlaybackState();
    probeApiCapabilities();

    // The heartbeat cadence is installed BEFORE the first request so a stalled first request can
    // never leave the device without a heartbeat loop (F24).
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(sync, HEARTBEAT_INTERVAL_MS);

    // Schedules are time-based: re-read the server's resolution periodically so campaigns start
    // and stop without waiting for a command or a restart (F17). The content hash makes this a
    // no-op when nothing changed.
    if (scheduleRefreshTimer) clearInterval(scheduleRefreshTimer);
    scheduleRefreshTimer = setInterval(() => {
        if (config && config.lastPlaylistId === 'SCHEDULE' && !syncWorkerRunning) {
            addLog('Periodic schedule refresh.', 'info', true);
            loadPlaylist('SCHEDULE');
        }
    }, SCHEDULE_REFRESH_MS);

    if (pruneTimer) clearInterval(pruneTimer);
    pruneTimer = setInterval(pruneCache, PRUNE_INTERVAL_MS);

    await ensureDeviceToken();

    // Auto-resume last playlist on boot if exists
    if (config.lastPlaylistId) {
        const savedIndex = parseInt(localStorage.getItem('last_playlist_index') || '0', 10) || 0;
        addLog(`Auto-resuming last playlist: ${config.lastPlaylistId} at index ${savedIndex}`);
        loadPlaylist(config.lastPlaylistId, savedIndex);
    } else {
        // No locally remembered playlist (e.g. fresh install or reinstall with reset config).
        // Ask the server what this device should play instead of forcing a manual selection.
        resolveServerPlaylist();
    }

    sync();
}

// Device token claim (contract T2). Uses the dedicated claim endpoint keyed by the STORED device
// id with hardware evidence (machine uuid + MAC). It never calls `register`: register resolves by
// hardware key and, for a screen whose stored identity had drifted, created a duplicate device row
// that then owned the token while this screen was locked out (Codex 4).
//
// Returns the claim outcome (see src/lib/claim.js): ok | legacy | mismatch | issued | race |
// retryable | invalid. Network failures resolve to 'retryable' instead of throwing.
async function claimDeviceToken(reason) {
    if (!config || !config.deviceId || !config.serverIp) return 'invalid';
    const storedId = String(config.deviceId);
    const appVer = await ipcRenderer.invoke('get-app-version');
    const deviceKey = cachedMachineUuid || await ipcRenderer.invoke('get-machine-uuid');
    const macAddress = cachedMacAddress || await ipcRenderer.invoke('get-mac-address');

    let res;
    let body;
    try {
        res = await fetchWithTimeout(serverUrl(`/api/v1/devices/${encodeURIComponent(storedId)}/token/claim`), {
            method: 'POST',
            headers: deviceHeaders(),
            body: JSON.stringify({ deviceKey, macAddress, appVersion: appVer })
        }, TIMEOUTS.settings);
        body = await readJsonSafe(res);
    } catch (e) {
        addLog(`Token claim (${reason}): network error (${e.message}); will retry later.`, 'warn', true);
        return 'retryable';
    }
    const { outcome } = classifyClaimResponse(res.status, body && body.message, body);

    switch (outcome) {
        case 'legacy':
            if (!claimEndpointMissing) {
                claimEndpointMissing = true;
                addLog(`Token claim (${reason}): the server has no claim endpoint for device ${storedId} (older API, or unknown id). Continuing without a device token.`, 'info', true);
            }
            return outcome;
        case 'mismatch':
            markClaimEvidenceMismatch();
            return outcome;
        case 'issued':
            markTokenRejected('TOKEN_ALREADY_ISSUED');
            return outcome;
        case 'race': {
            // R3: another claim won the server's conditional update a moment ago; one short,
            // jittered retry, then fall back to the normal retry schedule.
            if (!claimRaceRetried) {
                claimRaceRetried = true;
                const delay = raceRetryDelay();
                addLog(`Token claim (${reason}): TOKEN_RACE, retrying once in ${Math.round(delay / 1000)} s.`, 'warn', true);
                await new Promise(r => setTimeout(r, delay));
                const again = await claimDeviceToken(reason + '/race-retry');
                claimRaceRetried = false;
                return again;
            }
            claimRaceRetried = false;
            addLog(`Token claim (${reason}): TOKEN_RACE again; giving up for now.`, 'warn', true);
            return 'retryable';
        }
        case 'retryable':
            addLog(`Token claim (${reason}): server responded ${res.status || 'network error'}${body && body.message ? ' ' + body.message : ''}; will retry later.`, 'warn', true);
            return outcome;
        case 'invalid':
            addLog(`Token claim (${reason}): unexpected response ${res.status}${body && body.message ? ' ' + body.message : ''}. Continuing without a device token.`, 'warn', true);
            return outcome;
        default:
            break;
    }

    const data = body.data;
    const returnedIds = [data.deviceId, data.deviceUuid].filter(v => v !== undefined && v !== null).map(String);
    if (returnedIds.length > 0 && !returnedIds.includes(storedId)) {
        addLog(`TOKEN CLAIM ABORTED: server answered for a different device identity (${returnedIds.join('/')}) than this screen's ${storedId}. Config left untouched.`, 'error', true);
        return 'invalid';
    }
    config.deviceToken = String(data.deviceToken);
    await ipcRenderer.invoke('save-config', config);
    tokenRejected = false;
    stopClaimRetries();
    addLog(`Device token ${reason === 'boot' ? 'issued' : 're-issued'} by server and stored.`, 'info', true);
    smokeEvent('tokenClaimed', true);
    if (reason !== 'boot') smokeEvent('tokenReclaimed');
    refreshSecurityPanel();
    return 'ok';
}

// One boot-time claim for devices that have no token yet (Codex #8: a claim that fails for a
// transient reason -- 429, 5xx, network -- is retried on its own bounded schedule, independently
// of heartbeat authorization, because tokenless heartbeats succeed under IfIssued and would never
// trigger the 401-driven re-claim).
async function ensureDeviceToken() {
    if (!config || !config.deviceId || config.deviceToken || tokenClaimAttempted) return;
    tokenClaimAttempted = true;
    tokenReclaimLimiter.tryAcquire();
    await attemptBootClaim();
}

async function attemptBootClaim() {
    let outcome = 'retryable';
    try {
        outcome = await claimDeviceToken(claimRetryFailures === 0 ? 'boot' : `boot-retry-${claimRetryFailures}`);
    } catch (e) {
        addLog(`Token claim failed: ${e.message}`, 'warn', true);
    }
    if (outcome === 'retryable' && !config.deviceToken) scheduleClaimRetry();
    else stopClaimRetries();
}

// 1 min, 2, 4, 8, 16, then every 30 min (jittered), for at most 24 h.
function scheduleClaimRetry() {
    if (claimRetryTimer) return;
    if (!claimFirstFailureAt) claimFirstFailureAt = Date.now();
    claimRetryFailures++;
    const delay = claimRetryDelay(claimRetryFailures, { firstFailureAt: claimFirstFailureAt });
    if (delay === null) {
        addLog('Token claim: retry window (24 h) exhausted; an administrator must reset this device token on the server.', 'error', true);
        return;
    }
    addLog(`Token claim: retry #${claimRetryFailures} in ${Math.max(1, Math.round(delay / 60000))} min.`, 'info', true);
    claimRetryTimer = setTimeout(() => {
        claimRetryTimer = null;
        attemptBootClaim();
    }, delay);
}

function stopClaimRetries() {
    if (claimRetryTimer) clearTimeout(claimRetryTimer);
    claimRetryTimer = null;
    claimRetryFailures = 0;
    claimFirstFailureAt = 0;
}

// R2: the server asked for a fresh claim (RECLAIM_TOKEN pseudo-command, e.g. after an admin reset
// under IfIssued where no 401 would ever arrive). Bypasses the 10-minute throttle once.
async function reclaimTokenNow(reason) {
    tokenReclaimLimiter.reset();
    tokenReclaimLimiter.tryAcquire();
    try {
        const outcome = await claimDeviceToken(reason);
        if (outcome === 'retryable' && !config.deviceToken) scheduleClaimRetry();
        return outcome;
    } catch (e) {
        addLog(`Token re-claim (${reason}) failed: ${e.message}`, 'warn', true);
        return 'retryable';
    }
}

// R1: one bounded probe of GET /api/v1/system/capabilities; display only (the client keeps its
// "send if available" behaviour whatever the answer). 404 = API older than 2.8.
async function probeApiCapabilities() {
    if (!config || !config.serverIp) return;
    try {
        const res = await fetchWithTimeout(serverUrl('/api/v1/system/capabilities'), { headers: deviceHeaders() }, TIMEOUTS.settings);
        const body = await readJsonSafe(res);
        if (res.status === 404) apiCapabilities = { legacy: true };
        else if (res.ok && body && body.success && body.data) apiCapabilities = Object.assign({ legacy: false }, body.data);
        else apiCapabilities = { legacy: false, unknown: true, status: res.status };
    } catch (e) {
        apiCapabilities = { unreachable: true, error: e.message };
    }
    addLog(`API capabilities: ${describeApi()}`, 'info', true);
    smokeEvent('capabilitiesProbed', true);
    refreshSecurityPanel();
}

function describeApi() {
    const c = apiCapabilities;
    if (!c) return 'API ---';
    if (c.legacy) return 'API legacy (pre-2.8: no device tokens, protocol 1)';
    if (c.unreachable) return `API unreachable (${c.error || 'network'})`;
    if (c.unknown) return `API unknown (HTTP ${c.status})`;
    return `API ${c.apiVersion || '?'}  •  protocol ${c.protocol || '?'}  •  tokens ${c.deviceToken ? 'on' : 'off'}`;
}

// Recovery (contract T3): after a 401 DEVICE_TOKEN_INVALID (admin reset the token on the server,
// or the stored one is stale) try to claim again, at most once per 10 minutes with jitter. The
// stored token is never cleared automatically: a successful claim replaces it.
function scheduleTokenReclaim(trigger) {
    if (!config || !config.deviceId || claimEndpointMissing) return;
    if (!tokenReclaimLimiter.tryAcquire()) return;
    addLog(`Token re-claim scheduled (${trigger}).`, 'warn', true);
    setTimeout(() => {
        claimDeviceToken('reclaim').catch(e => addLog(`Token re-claim failed: ${e.message}`, 'warn', true));
    }, 1500);
}

// Resolve the playlist a device should play from the server when nothing is cached locally
// (e.g. after a reinstall or config reset). Loads the device's assigned schedule so it does
// not sit idle waiting for a manual selection.
async function resolveServerPlaylist() {
    if (!config.serverIp || !config.deviceId) return;
    addLog('No local playlist found. Loading device assigned SCHEDULE from server...');
    loadPlaylist('SCHEDULE');
}

function scheduleHeartbeatRetry() {
    if (heartbeatRetryTimer) clearTimeout(heartbeatRetryTimer);
    const base = Math.min(HEARTBEAT_INTERVAL_MS, 2000 * Math.pow(2, Math.max(0, heartbeatFailures - 1)));
    const jitter = Math.floor(Math.random() * 1000);
    heartbeatRetryTimer = setTimeout(() => {
        heartbeatRetryTimer = null;
        sync();
    }, base + jitter);
}

async function sync() {
    if (!config || !config.deviceId) return;
    // Prevent concurrent heartbeat calls (e.g. server slow + 15s interval fires again)
    if (isHeartbeating) {
        console.warn('[Heartbeat] Skipped: previous heartbeat still in progress.');
        return;
    }
    isHeartbeating = true;
    let commands = [];
    let ok = false;
    try {
        const heartbeatData = {
            deviceId: config.deviceId,
            deviceKey: cachedMachineUuid,
            deviceName: config.deviceName,
            branchCode: config.branchCode,
            status: isPlaying ? 'PLAYING' : 'IDLE',
            currentPlaylistId: (playlist[currentIndex] && playlist[currentIndex].playlistId) ? playlist[currentIndex].playlistId : (config.lastPlaylistId || ''),
            currentMediaId: (playlist[currentIndex] && playlist[currentIndex].media) ? playlist[currentIndex].media.mediaId : '',
            currentPlaylistItemId: (playlist[currentIndex]) ? playlist[currentIndex].playlistItemId : '',
            currentPositionSec: isPlaying ? Math.floor(videoEl.currentTime) : 0,
            cacheProgress: cacheProgress,
            // BUG-03: sent on every heartbeat, not just the boot report. Null is safe: the stored
            // procedure applies ISNULL(@p_mac_address, mac_address).
            macAddress: cachedMacAddress
        };
        if (config.deviceToken) heartbeatData.deviceToken = config.deviceToken;

        // Boot Report: enrich first heartbeat with device metadata
        if (!isBootReportSent) {
            const version = await ipcRenderer.invoke('get-app-version');
            heartbeatData.appVersion = `Client ${version}`;
            heartbeatData.ratio = `${window.screen.width}x${window.screen.height}`;
            console.log(`[Boot Report] Sending: v${version}, ${heartbeatData.ratio}`);
        }

        const res = await fetchWithTimeout(serverUrl('/api/v1/devices/heartbeat'), {
            method: 'POST',
            headers: deviceHeaders(),
            body: JSON.stringify(heartbeatData)
        }, TIMEOUTS.heartbeat);

        if (res.status === 401 && await handleUnauthorized(res)) throw new Error('Device token rejected (401)');
        if (!res.ok) {
            releaseResponse(res);
            throw new Error('Status ' + res.status);
        }

        const data = await readJsonSafe(res);
        commands = data && Array.isArray(data.data) ? data.data : [];
        ok = true;
        smokeEvent('heartbeats');

        setStatus('ONLINE', '#00f2ff');
        if (!isBootReportSent) {
            isBootReportSent = true;
            addLog('Boot Report sent successfully.', 'info', true);
        }
    } catch (err) {
        setStatus('OFFLINE', '#ff4d4d');
        heartbeatFailures++;
        addLog(`Heartbeat failed: ${err.message}`, 'error', true);
        scheduleHeartbeatRetry();
    } finally {
        isHeartbeating = false; // Released as soon as the response is parsed; commands run outside the guard.
    }

    if (!ok) return;
    heartbeatFailures = 0;
    if (heartbeatRetryTimer) {
        clearTimeout(heartbeatRetryTimer);
        heartbeatRetryTimer = null;
    }

    if (commands.length > 0) {
        await processCommands(commands);
    }

    syncPlaybackLogs();
    syncSystemLogs();
    selfHealMissingFiles();

    // AUTO-RETRY: nothing playing but a playlist is remembered and no sync is queued. A playlist the
    // server reported as EMPTY is authoritative (Codex 7) and is only re-asked after a while.
    if (!isPlaying && playlist.length === 0 && config.lastPlaylistId && !syncPending() &&
        (Date.now() - lastEmptyPlaylistAt) > EMPTY_RETRY_MIN_MS) {
        addLog(`Auto-Retry: No playlist active, attempting to load ${config.lastPlaylistId}...`, 'warn');
        const savedIndex = parseInt(localStorage.getItem('last_playlist_index') || '0', 10) || 0;
        loadPlaylist(config.lastPlaylistId, savedIndex);
    }
}

// Self-Healing: check whether any playlist item is missing on disk and re-download silently.
async function selfHealMissingFiles() {
    if (syncWorkerRunning || syncPending() || !playlist || playlist.length === 0) return;
    try {
        let hasMissing = false;
        for (const item of playlist) {
            if (item.media && !item.media.isFallback && !(await mediaExists(item.media))) {
                hasMissing = true;
                break;
            }
        }
        if (hasMissing) {
            addLog("Self-Healing: Detected missing/corrupted files in cache. Triggering sync...", "warn");
            requestedJob = newJob(config.lastPlaylistId, dashPlaylistName.textContent, playlist, localStorage.getItem('playlist_hash') || '', { silent: true });
            runSyncWorker();
        }
    } catch (e) {
        console.warn('Self-heal check failed:', e.message);
    }
}

// =============================================================================================
// Commands (contract 2)
// =============================================================================================
function isRestartType(type) {
    return type === 'REBOOT' || type.startsWith('RESTART') || type === 'RELOAD' || type === 'REFRESH' ||
        type === 'WIPE_CACHE' || type.startsWith('UPDATE_DEVICE_ID:');
}

async function ackCommand(cmd, status, message) {
    const cmdId = cmd.deviceCommandId ?? cmd.commandId;
    if (!cmdId) return false;
    try {
        const res = await fetchWithTimeout(serverUrl(`/api/v1/devices/${encodeURIComponent(config.deviceId)}/command/ack`), {
            method: 'POST',
            headers: deviceHeaders(),
            body: JSON.stringify({ commandId: cmdId, status, message: message || undefined })
        }, TIMEOUTS.ack);
        if (res.status === 401) await handleUnauthorized(res);
        else releaseResponse(res);
        if (res.ok) {
            addLog(`Command ${cmd.commandType} acknowledged (${status}).`, 'info', true);
            smokeEvent('commandsAcked');
        }
        return res.ok;
    } catch (e) {
        addLog(`Failed to ACK command ${cmd.commandType}: ${e.message}`, 'warn', true);
        return false;
    }
}

async function processCommands(commands) {
    for (const cmd of commands) {
        const type = String(cmd.commandType || '');
        const cmdId = String(cmd.deviceCommandId ?? cmd.commandId ?? '');
        if (!type) continue;
        if (type === 'RECLAIM_TOKEN') {
            // R2: pseudo-command (the server marks it EXECUTED itself; it is never acked).
            addLog('Server requested a device-token re-claim.', 'warn', true);
            await reclaimTokenNow('reclaim-command');
            continue;
        }
        if (cmdId && inFlightCommandIds.has(cmdId)) {
            addLog(`Command ${type} (${cmdId}) is still being executed; ignoring duplicate delivery.`, 'warn', true);
            continue;
        }
        if (cmdId) inFlightCommandIds.add(cmdId);
        addLog(`Received command: ${type}`);
        try {
            await executeCommand(cmd, type);
        } catch (e) {
            addLog(`Command ${type} failed: ${e.message}`, 'error', true);
            await ackCommand(cmd, 'FAILED', e.message);
        } finally {
            if (cmdId) inFlightCommandIds.delete(cmdId);
        }
    }
}

async function executeCommand(cmd, type) {
    if (isRestartType(type)) {
        // The process is about to go away: acknowledge first (bounded), then act.
        await ackCommand(cmd, 'EXECUTED');
        if (type === 'RELOAD' || type === 'REFRESH') {
            showHUD('RELOADING...');
            setTimeout(() => window.location.reload(), 1000);
        } else if (type === 'WIPE_CACHE') {
            showHUD('WIPING CACHE...');
            await ipcRenderer.invoke('clear-cache');
            setTimeout(() => window.location.reload(), 1000);
        } else if (type === 'REBOOT') {
            showHUD('SYSTEM REBOOT...');
            await ipcRenderer.invoke('reboot-device');
        } else if (type.startsWith('RESTART')) {
            const parts = type.split(':');
            if (parts.length >= 3) {
                localStorage.setItem('resume_media_id', parts[1]);
                localStorage.setItem('resume_pos_sec', parts[2]);
                addLog(`Saved resume state: Media ${parts[1]} at ${parts[2]}s`);
            }
            showHUD('SYSTEM REBOOT...');
            await ipcRenderer.invoke('reboot-device');
        } else if (type.startsWith('UPDATE_DEVICE_ID:')) {
            const newDeviceId = type.split(':')[1];
            if (newDeviceId && newDeviceId !== String(config.deviceId)) {
                addLog(`Self-healing: updating config.deviceId from ${config.deviceId} to ${newDeviceId}`, 'info', true);
                config.deviceId = newDeviceId;
                await ipcRenderer.invoke('save-config', config);
                addLog(`Local deviceId updated to ${newDeviceId}. Reloading application...`, 'info', true);
                setTimeout(() => window.location.reload(), 1000);
            }
        }
        return;
    }

    if (type === 'UPDATE_CLIENT') {
        await runClientUpdate(cmd);
        return;
    }

    if (type === 'FORCE_SYNC') {
        showHUD('REMOTE SYNC');
        const okSync = await loadPlaylist(config.lastPlaylistId);
        await ackCommand(cmd, okSync ? 'EXECUTED' : 'FAILED', okSync ? undefined : 'playlist load failed');
        return;
    }

    if (type === 'SYNC_SCHEDULE') {
        showHUD('REMOTE SCHEDULE');
        addLog('Remote Schedule Sync triggered.', 'info', true);
        const okSync = await loadPlaylist('SCHEDULE');
        await ackCommand(cmd, okSync ? 'EXECUTED' : 'FAILED', okSync ? undefined : 'schedule load failed');
        return;
    }

    if (type.startsWith('PLAY_PLAYLIST:')) {
        const pid = type.split(':')[1];
        if (!pid) {
            await ackCommand(cmd, 'FAILED', 'missing playlist id');
            return;
        }
        showHUD('REMOTE PLAYLIST');
        const okSync = await loadPlaylist(pid);
        await ackCommand(cmd, okSync ? 'EXECUTED' : 'FAILED', okSync ? undefined : 'playlist load failed');
        return;
    }

    if (type === 'CAPTURE_SCREEN') {
        addLog('Remote Screen Capture triggered.', 'info', true);
        const result = await ipcRenderer.invoke('capture-screen');
        if (!result || !result.success) {
            const reason = result && result.error ? result.error : 'capture failed';
            addLog(`Screen capture failed: ${reason}`, 'error', true);
            await ackCommand(cmd, 'FAILED', reason);
            return;
        }
        const response = await fetchWithTimeout(serverUrl(`/api/v1/devices/${encodeURIComponent(config.deviceId)}/screenshot`), {
            method: 'POST',
            headers: deviceHeaders(),
            body: JSON.stringify({ base64Image: result.base64 })
        }, TIMEOUTS.logs);
        if (response.status === 401) await handleUnauthorized(response);
        else releaseResponse(response);
        if (response.ok) {
            addLog('Screen capture uploaded successfully.', 'info', true);
            await ackCommand(cmd, 'EXECUTED');
        } else {
            addLog(`Screen capture upload failed: Status ${response.status}`, 'error', true);
            await ackCommand(cmd, 'FAILED', `upload status ${response.status}`);
        }
        return;
    }

    addLog(`Unsupported command: ${type}`, 'warn', true);
    await ackCommand(cmd, 'FAILED', 'UNSUPPORTED');
}

async function fetchSetting(key) {
    try {
        const res = await fetchWithTimeout(serverUrl(`/api/v1/system/settings/${key}`), { headers: deviceHeaders() }, TIMEOUTS.settings);
        if (!res.ok) return null;
        const body = await readJsonSafe(res);
        return body && body.data ? String(body.data) : null;
    } catch (e) {
        return null;
    }
}

function resolveDownloadUrl(raw) {
    if (!raw) return serverUrl('/setup/Signage_Unicorn_Setup_latest.exe');
    if (/^https?:\/\//i.test(raw)) return raw;
    return serverUrl(raw.startsWith('/') ? raw : '/' + raw);
}

// Client self-update (contract 7): TLS-validated download, SHA-256 check against the hash the
// server published, ack after verification and before the installer takes the process down.
async function runClientUpdate(cmd) {
    if (isUpdating) {
        addLog('Client update already in progress. Skipping duplicate command.', 'warn');
        return false;
    }
    isUpdating = true;
    showHUD('UPDATING CLIENT...');
    addLog(cmd ? 'Remote Client Update triggered.' : 'Manual Client Update triggered.', 'info', true);

    // Safety timeout: reset isUpdating after 15 minutes in case download stalls
    const updateTimeout = setTimeout(() => {
        if (isUpdating) {
            addLog('Update timed out after 15 minutes. Resetting state.', 'error', true);
            isUpdating = false;
        }
    }, 15 * 60 * 1000);

    try {
        // Contract T13: the metadata server AND the installer must be https (an on-path attacker on
        // plain http could rewrite both the installer and its "expected" hash).
        const allowInsecure = !!(config && config.allowInsecureUpdates === true);
        const serverRule = checkUpdateUrl(config.serverIp, allowInsecure);
        if (!serverRule.ok) throw new Error(`INSECURE_UPDATE_URL: settings server ${serverRule.reason}`);

        // Round 3 (Codex #5): the metadata is fetched by the main process, whose downloader applies
        // the https rule to every redirect hop; the renderer's fetch() cannot see a hop.
        const meta = await ipcRenderer.invoke('fetch-update-metadata');
        if (!meta || !meta.success) {
            if (meta && meta.code === 'INSECURE_UPDATE_URL') smokeEvent('updateRefusedInsecure', true);
            throw new Error(meta && meta.error ? meta.error : 'Could not read update settings');
        }
        const urlSetting = meta.url;
        const shaSetting = meta.sha256;
        const versionSetting = meta.version;
        if (!urlSetting) throw new Error('No download URL found in settings.');
        const url = resolveDownloadUrl(urlSetting);
        const urlRule = checkUpdateUrl(url, allowInsecure);
        if (!urlRule.ok) throw new Error(`INSECURE_UPDATE_URL: installer ${urlRule.reason}`);
        if (urlRule.insecure) addLog(`WARN: ${urlRule.reason}`, 'warn', true);
        const expectedSha = shaSetting ? shaSetting.trim().toLowerCase() : null;
        if (!expectedSha) addLog('WARN: unverified installer (server has no ClientDownloadSha256)', 'warn', true);

        addLog(`Downloading update from: ${url}`, 'info', true);
        const dl = await ipcRenderer.invoke('download-update', { url, sha256: expectedSha });
        if (!dl || !dl.success) {
            if (dl && dl.code === 'INSECURE_UPDATE_URL') smokeEvent('updateRefusedInsecure', true);
            throw new Error(dl && dl.error ? dl.error : 'Download failed');
        }

        addLog(`Update downloaded${dl.verified ? ' and SHA-256 verified' : ''}. Launching installer...`, 'warn', true);
        // ACK BEFORE launching (process will restart and can't ACK after)
        if (cmd) await ackCommand(cmd, 'EXECUTED', dl.verified ? 'installer verified' : 'installer unverified');
        clearTimeout(updateTimeout);

        const launched = await ipcRenderer.invoke('launch-installer', dl.path, { version: versionSetting || null });
        if (!launched || !launched.success) throw new Error(launched && launched.error ? launched.error : 'Installer launch failed');
        return true; // isUpdating stays true: the process is about to exit
    } catch (e) {
        clearTimeout(updateTimeout);
        isUpdating = false;
        addLog(`Client update failed: ${e.message}`, 'error', true);
        if (cmd) await ackCommand(cmd, 'FAILED', e.message.startsWith('INSECURE_UPDATE_URL') ? 'INSECURE_UPDATE_URL' : e.message);
        return false;
    }
}

// =============================================================================================
// Playlist Management
// =============================================================================================
function syncPending() {
    return !!(requestedJob && !requestedJob.completed);
}

// Hash of the content that is playing right now (written by swapToJob / applyEmptyPlaylist).
function activeContentHash() {
    return localStorage.getItem('playlist_hash') || '';
}

// Codex round-4 #8: drop a pending/queued job (and the swap it armed) whose content differs from
// the version the server just confirmed as active. Returns true when something was cancelled.
function cancelPendingForOtherVersion(activeHash) {
    let cancelled = false;
    if (requestedJob && !requestedJob.completed && requestedJob.hash !== activeHash) {
        addLog(`Pending playlist '${requestedJob.name}' cancelled: the server confirmed the active content.`, 'info', true);
        requestedJob = null; // a running download job notices it is no longer requested and aborts
        cancelled = true;
    }
    if (swapTarget && swapTarget.hash !== activeHash) {
        swapTarget = null;
        cancelled = true;
    }
    return cancelled;
}

function newJob(id, name, items, hash, opts = {}) {
    return {
        gen: ++syncGeneration,
        id,
        name,
        items,
        hash,
        silent: !!opts.silent,
        resumeIndex: opts.resumeIndex || 0,
        synced: 0,
        completed: false
    };
}

async function allFilesExist(items) {
    for (const item of items) {
        if (item.media && !(await mediaExists(item.media))) return false;
    }
    return true;
}

// A playlist/schedule the server reports as EMPTY is authoritative (Codex 7): stop playing the
// previous content, show the idle jingle, remember the selection, cancel any queued sync.
async function applyEmptyPlaylist(playlistId, playlistName) {
    addLog(`'${playlistName}' (${playlistId}) is empty on the server: stopping playback.`, 'warn');
    lastEmptyPlaylistAt = Date.now();
    requestedJob = null; // a running download job notices it is no longer requested and aborts
    swapTarget = null;
    playlist = [];
    currentIndex = 0;
    config.lastPlaylistId = playlistId;
    localStorage.setItem('playlist_hash', contentHashFor(playlistId, []));
    localStorage.setItem('last_playlist_index', '0');
    await ipcRenderer.invoke('save-config', config);
    dashPlaylistName.textContent = playlistName;
    dashTotalCount.textContent = '0';
    dashCachedCount.textContent = '0';
    dashSyncBar.style.width = '0%';
    dashReadyStatus.textContent = 'IDLE (EMPTY)';
    dashReadyStatus.style.color = '#9a9a9a';
    cacheProgress = 0;
    playNext(); // empty playlist -> idle jingle
}

// Returns true when the playlist data was obtained (sync queued, already up to date, or an
// authoritative empty list was applied).
async function loadPlaylist(playlistId, resumeIndex = 0) {
    if (!playlistId) return false;
    const loadNo = loadSeq.begin(); // Codex 8: taken before the first await
    try {
        dashReadyStatus.textContent = 'SYNCING...';
        dashReadyStatus.style.color = '#f1c40f';
        addLog(`Loading playlist data: ${playlistId}`);

        let items = [];
        let playlistName = 'Standard Loop';
        let fromServer = false;

        try {
            const apiPath = playlistId === 'SCHEDULE'
                ? `/api/v1/devices/${encodeURIComponent(config.deviceId)}/schedule`
                : `/api/v1/playlists/${encodeURIComponent(playlistId)}`;

            const res = await fetchWithTimeout(serverUrl(apiPath), { headers: deviceHeaders() }, TIMEOUTS.playlist);
            const data = await readJsonSafe(res);
            if (res.status === 401) await handleUnauthorized(res, data);
            if (!res.ok || !data) throw new Error(`Status ${res.status}`);
            if (!data.success || !data.data) throw new Error(data.message || `Status ${res.status}`);
            fromServer = true;
            if (Array.isArray(data.data.items)) {
                // Ensure items are sorted by positionOrder
                items = data.data.items.filter(i => i.media).sort((a, b) => a.positionOrder - b.positionOrder);
            }
            playlistName = data.data.playlistName || playlistName;
        } catch (fetchErr) {
            addLog(`Server unreachable, trying SQLite cache...`, 'warn');
            const cachedData = await ipcRenderer.invoke('db-get-playlist', playlistId);
            if (cachedData) {
                items = cachedData.items || [];
                playlistName = cachedData.playlistName || playlistName;
                addLog(`Offline Mode: Loaded from SQLite cache`);
            } else {
                throw new Error("No local SQLite cache found for this playlist.");
            }
        }

        if (!loadSeq.isCurrent(loadNo)) {
            addLog(`Stale playlist response for ${playlistId} discarded (a newer load is in charge).`, 'info', true);
            return true;
        }

        // --- Cache in SQLite for Offline Survival (an empty list is cached too). Written only
        // AFTER the generation check (Codex #10): a superseded response must leave no trace.
        if (fromServer) {
            await ipcRenderer.invoke('db-save-playlist', { id: playlistId, data: { items, playlistName } });
            if (!loadSeq.isCurrent(loadNo)) return true;
        }

        if (items.length === 0) {
            // Both the live server answer and a cached empty answer mean "nothing assigned"; the
            // local fallback folder is only for an unreachable server (see the catch below).
            await applyEmptyPlaylist(playlistId, playlistName);
            return true;
        }

        augmentItems(items);
        const contentHash = contentHashFor(playlistId, items);
        const savedHash = localStorage.getItem('playlist_hash');

        dashPlaylistName.textContent = playlistName;
        dashTotalCount.textContent = String(items.length);

        if (contentHash === savedHash && playlist.length > 0) {
            // Codex round-4 #8 / round-5 #8: this response is the latest authoritative answer and it
            // matches what is playing. A pending job for a DIFFERENT version (e.g. B queued while A
            // played, then A requested again) must not swap in later. Drop it and its download
            // ownership SYNCHRONOUSLY, before the file check below yields -- otherwise B could swap
            // in during that await and we would still report A as ready.
            cancelPendingForOtherVersion(contentHash);
            const complete = await allFilesExist(items);
            if (!loadSeq.isCurrent(loadNo)) return true;
            // A swap that was already in flight when we cancelled can still have completed during
            // the await: re-read the active hash and decide from the real state, not from `savedHash`.
            const decision = decideAfterVerify({ contentHash, activeHashAfterAwait: activeContentHash(), complete });
            if (decision === 'ready') {
                refreshAttribution(items);
                cancelPendingForOtherVersion(contentHash); // idempotent re-check after yielding
                addLog("Smart Sync: Hash matches and all files exist. Skipping re-download.");
                dashReadyStatus.textContent = 'READY';
                dashReadyStatus.style.color = '#00f2ff';
                return true;
            }
            if (decision === 'requeue') {
                addLog(`Active content changed while '${playlistName}' was being verified; re-queuing it as the authoritative version.`, 'warn', true);
            } else {
                addLog("Smart Sync: Hash matches but some files are missing. Re-syncing...", "warn");
            }
        }

        if (requestedJob && requestedJob.hash === contentHash && !requestedJob.completed) {
            addLog(`Sync already active for ${playlistId} version. Continuing...`);
            return true;
        }

        // Same content as what is playing = silent repair; anything else becomes the next
        // playlist once its first clip is ready. Compared against the hash that is active NOW
        // (not `savedHash`, which may predate a swap that finished during the awaits above).
        const silent = playlist.length > 0 && contentHash === activeContentHash();
        addLog(`Smooth Sync: Queuing ${items.length} items in background...`);
        requestedJob = newJob(playlistId, playlistName, items, contentHash, { silent, resumeIndex });
        swapTarget = silent ? null : requestedJob;
        runSyncWorker();
        return true;
    } catch (err) {
        if (!loadSeq.isCurrent(loadNo)) {
            // Codex #10: a superseded load must not change playback, not even to the fallback.
            addLog(`Stale playlist failure for ${playlistId} ignored (${err.message}); a newer load is in charge.`, 'info', true);
            return false;
        }
        addLog(`Load playlist failed: ${err.message}`, 'error');
        dashReadyStatus.textContent = 'SYNC ERROR';
        dashReadyStatus.style.color = '#ff4d4d';
        await loadFallbackPlaylist();
        return false;
    }
}

async function loadFallbackPlaylist() {
    addLog("Emergency Mode: Loading local fallback playlist...", "warn");
    try {
        const fallbackItems = await ipcRenderer.invoke('get-fallback-media');
        if (fallbackItems && fallbackItems.length > 0) {
            playlist = fallbackItems;
            currentIndex = 0;
            dashPlaylistName.textContent = "EMERGENCY FALLBACK";
            dashTotalCount.textContent = String(playlist.length);
            dashReadyStatus.textContent = 'EMERGENCY';
            dashReadyStatus.style.color = '#e74c3c';
            playNext();
        } else {
            addLog("Emergency Mode: No fallback files found in fallback_media folder.", "error");
        }
    } catch (e) {
        addLog(`Emergency Mode failed: ${e.message}`, 'error');
    }
}

async function runSyncWorker() {
    if (syncWorkerRunning) return;
    syncWorkerRunning = true;
    try {
        while (requestedJob && !requestedJob.completed) {
            const job = requestedJob;
            activeJob = job;
            await syncJobAssets(job);
            if (requestedJob !== job) continue; // superseded: converge on the newest request

            job.completed = true;
            const isFullySynced = job.synced === job.items.length;
            if (isFullySynced) {
                addLog(`Background Sync Complete (${job.items.length} clips).`);
                dashReadyStatus.textContent = 'READY';
                dashReadyStatus.style.color = '#00f2ff';
                pruneCache();
            } else {
                addLog(`Sync finished with gaps: ${job.synced}/${job.items.length} ready.`, 'warn');
                dashReadyStatus.textContent = 'PARTIAL';
                dashReadyStatus.style.color = '#f1c40f';
            }
            if (swapTarget === job && !isPlaying) {
                // Nothing played because the first clip never became ready; try the swap anyway so
                // the device does not sit idle with a partially synced playlist.
                const first = job.items[0] && job.items[0].media;
                if (first && await mediaExists(first)) await swapToJob(job);
            }
            break;
        }
    } finally {
        activeJob = null;
        syncWorkerRunning = false;
        // A request may have arrived in the tail of the loop.
        if (requestedJob && !requestedJob.completed) setTimeout(runSyncWorker, 0);
    }
}

async function syncJobAssets(job) {
    const items = job.items;
    let synced = 0;
    cacheProgress = 0;

    for (const item of items) {
        if (requestedJob !== job) {
            addLog(`Sync aborted: newer playlist requested.`, 'warn');
            job.synced = synced;
            return;
        }

        const media = item.media;
        dashReadyStatus.textContent = `SYNCING ${synced + 1}/${items.length}`;
        dashReadyStatus.style.color = '#f1c40f';

        try {
            const res = await ipcRenderer.invoke('download-media', {
                url: media.blobUrl,
                cacheName: media.cacheName,
                legacyFilename: media.legacyFilename,
                fileHash: media.fileHash
            });

            if (res && res.success) {
                synced++;
            } else {
                addLog(`Download failed for ${media.displayName || media.cacheName}: ${res?.error || 'Unknown error'}`, 'warn');
            }

            job.synced = synced;
            cacheProgress = Math.round((synced / items.length) * 100);
            dashCachedCount.textContent = String(synced);
            dashSyncBar.style.width = cacheProgress + '%';

            // --- IMMEDIATE START IF IDLE ---
            if (synced === 1 && !isPlaying && swapTarget === job) {
                addLog("Idle Player: First clip ready, starting playback.");
                await swapToJob(job);
            }
        } catch (e) {
            addLog(`Sync error for ${media.displayName || media.cacheName}: ${e.message}`, 'warn');
        }
    }
    job.synced = synced;
}

async function swapToJob(job) {
    if (!job) return;
    addLog(`Swapping to new playlist: '${job.name}'`);
    playlist = job.items;
    config.lastPlaylistId = job.id;
    localStorage.setItem('playlist_hash', job.hash);
    await ipcRenderer.invoke('save-config', config);

    dashPlaylistName.textContent = job.name;
    dashTotalCount.textContent = String(playlist.length);
    if (swapTarget === job) swapTarget = null;

    currentIndex = (job.resumeIndex && job.resumeIndex < playlist.length) ? job.resumeIndex : 0;
    job.resumeIndex = 0;
    playNext();
}

// Storage budget (F31): drop cache files no playlist references any more.
async function pruneCache() {
    try {
        const keep = new Set();
        for (const it of playlist) if (it.media && it.media.cacheName && !it.media.isFallback) keep.add(it.media.cacheName);
        for (const job of [requestedJob, activeJob, swapTarget]) {
            if (!job) continue;
            for (const it of job.items) if (it.media && it.media.cacheName) keep.add(it.media.cacheName);
        }
        const jingle = localStorage.getItem('safety_jingle_cache');
        if (jingle) keep.add(jingle);
        const r = await ipcRenderer.invoke('prune-cache', { keep: [...keep] });
        if (r && r.deleted > 0) {
            addLog(`Cache prune: removed ${r.deleted} unused file(s), ${(r.reclaimedBytes / 1048576).toFixed(1)} MB reclaimed.`, 'info', true);
            updateStorage();
        }
    } catch (e) {
        console.warn('Cache prune failed:', e.message);
    }
}

// =============================================================================================
// Playback Engine
// =============================================================================================
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
    dashPos.textContent = formatTime(elapsed);
    dashMediaBar.style.width = progress + '%';
}
setInterval(updatePlaybackHUD, 500);

// Codex 21: a single tracked retry timer, cancelled on every transition and bound to the playback
// token that scheduled it, so a stale callback can never interrupt a clip that started meanwhile.
function skipAfterDelay(delayMs, token) {
    if (skipTimer) clearTimeout(skipTimer);
    skipStreak++;
    const lapped = playlist.length > 0 && skipStreak >= playlist.length;
    if (lapped && isPlaying) {
        // Nothing in this playlist is on disk right now: show the idle jingle instead of a frozen frame.
        isPlaying = false;
        reportPlaybackState();
        jingleEl.classList.remove('hidden');
        dashCurrentMedia.textContent = '▶ WAITING FOR MEDIA';
    }
    currentIndex = (currentIndex + 1) % Math.max(1, playlist.length);
    const wait = lapped ? Math.max(delayMs, 5000) : delayMs; // do not hammer the disk once a full lap failed
    skipTimer = setTimeout(() => {
        skipTimer = null;
        if (token !== playbackToken) return;
        playNext();
    }, wait);
}

// Codex 9: a replacement playlist whose first clip is on disk must be able to start even while
// the current list is skipping through missing files.
async function trySwapIfReady() {
    if (!swapTarget || !swapTarget.items.length) return false;
    const firstMedia = swapTarget.items[0].media;
    if (firstMedia && await mediaExists(firstMedia)) {
        await swapToJob(swapTarget);
        return true;
    }
    return false;
}

async function playNext() {
    const myToken = ++playbackToken;
    if (currentItemTimer) clearTimeout(currentItemTimer);
    if (skipTimer) {
        clearTimeout(skipTimer);
        skipTimer = null;
    }

    if (playlist.length === 0) {
        isPlaying = false;
        reportPlaybackState();
        jingleEl.classList.remove('hidden');
        dashCurrentMedia.textContent = '▶ IDLE / WAITING';
        try {
            videoEl.pause();
            videoEl.removeAttribute('src');
            videoEl.load();
            imageEl.removeAttribute('src');
        } catch (e) { /* ignore */ }
        return;
    }
    if (currentIndex >= playlist.length) currentIndex = 0;
    localStorage.setItem('last_playlist_index', String(currentIndex));
    const item = playlist[currentIndex];
    const media = item.media;
    const isFallback = !!(media && media.isFallback) || !!(item.playlistItemId && String(item.playlistItemId).startsWith('FALLBACK'));

    if (!media || !media.cacheName) {
        addLog('Skip: item without media', 'warn');
        skipAfterDelay(1000, myToken);
        return;
    }

    // Check if file is physically downloaded to prevent trying to play 0-byte/partial files
    const isReady = isFallback ? true : await mediaExists(media);
    if (myToken !== playbackToken) return;
    if (!isReady) {
        // Codex 9: before skipping, let a ready replacement playlist take over.
        if (await trySwapIfReady()) return;
        if (myToken !== playbackToken) return;
        addLog(`Skip: ${media.displayName || media.cacheName} (still syncing)`, 'warn');
        skipAfterDelay(1000, myToken);
        return;
    }

    let localFile;
    try {
        localFile = await mediaFileUrl(media);
    } catch (e) {
        addLog(`Skip: cannot resolve ${media.cacheName}: ${e.message}`, 'warn');
        skipAfterDelay(1000, myToken);
        return;
    }
    if (myToken !== playbackToken) return;

    // Only now is something really on screen (Codex 9): isPlaying never claims readiness early.
    skipStreak = 0;
    isPlaying = true;
    reportPlaybackState();

    dashCurrentMedia.textContent = `▶ ${media.displayName || media.fileName || media.cacheName}`;
    dashLoopInfo.textContent = `ITEM ${currentIndex + 1} / ${playlist.length}`;

    mediaStartTime = Date.now();
    const override = parseInt(item.durationOverride, 10) || 0;
    const rawDuration = override || media.durationSec || 10;
    mediaDuration = Math.max(1, parseInt(rawDuration, 10) || 10) * 1000;
    dashDur.textContent = formatTime(mediaDuration);
    jingleEl.classList.add('hidden');

    addLog(`Playing: ${media.displayName || media.fileName || media.cacheName} (${currentIndex + 1}/${playlist.length})`);

    let completed = false;
    const onComplete = async (skipLog = false) => {
        // Atomic completion: one transition per item, and never from a stale handler.
        if (completed || myToken !== playbackToken) return;
        completed = true;
        if (currentItemTimer) clearTimeout(currentItemTimer);
        if (!skipLog) recordPlayback(item, Date.now() - mediaStartTime);

        // --- SMOOTH SWAP LOGIC ---
        if (swapTarget && swapTarget.items.length > 0) {
            const firstMedia = swapTarget.items[0].media;
            if (firstMedia && await mediaExists(firstMedia)) {
                await swapToJob(swapTarget);
                return;
            }
            addLog("Smooth Swap: Next playlist first item not ready yet. Staying on current.", "warn");
        }

        currentIndex = (currentIndex + 1) % playlist.length;
        playNext();
    };

    if (isVideoMedia(media)) {
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
        videoEl.onended = () => onComplete(false);

        if (override > 0) {
            // F34: the editor's duration override is a hard slot length for videos too.
            currentItemTimer = setTimeout(() => {
                addLog(`Duration override reached (${override}s) for ${media.displayName || media.cacheName}. Advancing.`, 'info', true);
                onComplete(false);
            }, override * 1000);
        } else if (mediaDuration > 0) {
            // --- WATCHDOG: Force next video if it hangs longer than duration + 60s (SAFE BUFFER) ---
            currentItemTimer = setTimeout(() => {
                addLog(`Watchdog: Video ${media.displayName || media.cacheName} hung. Forcing next.`, 'warn');
                onComplete(true); // Treat as error skip
            }, mediaDuration + 60000);
        }

        videoEl.onerror = async () => {
            if (myToken !== playbackToken) return;
            if (currentItemTimer) clearTimeout(currentItemTimer);
            const err = videoEl.error ? `Code ${videoEl.error.code}: ${videoEl.error.message}` : 'Unknown Playback Error';
            console.error('Video Error:', err, localFile);
            recordPlayback(item, 0, 'error', err);

            if (!isFallback) {
                // Delete corrupt file from local cache for auto-recovery
                addLog(`Error playing ${media.displayName || media.cacheName}. Deleting cached file for auto-recovery.`, 'warn');
                await ipcRenderer.invoke('delete-cached-file', { cacheName: media.cacheName });
            }

            setTimeout(() => onComplete(true), 2000);
        };
    } else {
        // Clear video element to release hardware decoders/memory
        try {
            videoEl.pause();
            videoEl.removeAttribute('src');
            videoEl.load();
        } catch (e) { /* ignore */ }

        imageEl.src = localFile; imageEl.classList.remove('hidden'); videoEl.classList.add('hidden');
        currentItemTimer = setTimeout(() => onComplete(false), mediaDuration);
        imageEl.onerror = () => {
            if (myToken !== playbackToken) return;
            if (currentItemTimer) clearTimeout(currentItemTimer);
            const err = 'Image Load Failed';
            console.error(err, localFile);
            recordPlayback(item, 0, 'error', err);
            setTimeout(() => onComplete(true), 2000);
        };
    }
}

function updateStorage() {
    ipcRenderer.invoke('get-storage-info').then(info => {
        storageUsed.textContent = info.used;
        storageTotal.textContent = info.total;
        storageBar.style.width = (info.percent || 0) + '%';
    }).catch(() => { });
}

// =============================================================================================
// Setup / Dashboard UI
// =============================================================================================
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
            const appVer = await ipcRenderer.invoke('get-app-version');
            const res = await fetchWithTimeout(`${ip}/api/v1/devices/register`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Client-Protocol': CLIENT_PROTOCOL },
                body: JSON.stringify({
                    deviceKey: uuid,
                    deviceName: name,
                    branchCode: branch,
                    location: loc,
                    ipAddress: '127.0.0.1',
                    appVersion: appVer,
                    tokenCapable: true // contract T1: only a client that stores the token asks for one
                })
            }, TIMEOUTS.settings);
            const result = await readJsonSafe(res);
            if (result && result.success && result.data) {
                config.serverIp = ip; config.deviceName = name; config.branchCode = branch; config.location = loc; config.deviceId = result.data.deviceId;
                config.deviceToken = result.data.deviceToken ? String(result.data.deviceToken) : null;
                if (result.data.currentPlaylistId) config.lastPlaylistId = result.data.currentPlaylistId;
                await ipcRenderer.invoke('save-config', config);
                setupScreen.classList.add('hidden');
                updateCursorVisibility();
                tokenClaimAttempted = true; // a fresh registration is the claim
                smokeEvent('registered', true);
                startSync();
            } else {
                alert(`Registration rejected: ${(result && result.message) || `HTTP ${res.status}`}`);
            }
        } catch (err) {
            console.error('Registration failed:', err);
            alert(`Connect error: ${ip}\nReason: ${err.message}`);
        }
    };
}

document.getElementById('show-playlists').onclick = () => {
    playlistSelectScreen.classList.remove('hidden');
    playlistListContainer.replaceChildren();
    const loading = document.createElement('div');
    loading.textContent = 'Loading...';
    playlistListContainer.appendChild(loading);

    fetchWithTimeout(serverUrl('/api/v1/playlists/active'), { headers: deviceHeaders() }, TIMEOUTS.settings)
        .then(r => readJsonSafe(r))
        .then(data => {
            playlistListContainer.replaceChildren();
            if (!data || !data.success || !Array.isArray(data.data)) {
                const err = document.createElement('div');
                err.textContent = 'Could not load playlists from server.';
                playlistListContainer.appendChild(err);
                return;
            }
            // Server-provided strings are rendered as text, never as HTML (F04).
            data.data.forEach(p => {
                const card = document.createElement('div');
                card.className = 'playlist-card';
                card.style.cssText = 'background:#111;padding:15px;border:1px solid #333;border-radius:10px;cursor:pointer;';
                const title = document.createElement('div');
                title.style.cssText = 'color:#00f2ff;font-weight:900;font-size:16px;';
                title.textContent = String(p.playlistName || '(unnamed)');
                const meta = document.createElement('div');
                meta.style.cssText = 'font-size:13px;color:#9a9a9a;margin-top:4px;';
                meta.textContent = `${Number(p.itemCount) || 0} Items`;
                card.appendChild(title);
                card.appendChild(meta);
                card.onclick = () => {
                    if (confirm('Change Playlist?')) {
                        loadPlaylist(p.playlistId);
                        playlistSelectScreen.classList.add('hidden');
                        updateCursorVisibility();
                    }
                };
                playlistListContainer.appendChild(card);
            });
        })
        .catch(err => {
            playlistListContainer.replaceChildren();
            const e = document.createElement('div');
            e.textContent = `Could not load playlists: ${err.message}`;
            playlistListContainer.appendChild(e);
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
    const isIdChanged = newId !== String(config.deviceId);
    if (isIdChanged) {
        if (!confirm('CRITICAL: Changing Device ID will register a NEW device identity.\n\nAre you sure?')) return;
    }

    showHUD('TESTING CONNECTION...');

    // 3. Test Connection / Register
    try {
        const appVer = await ipcRenderer.invoke('get-app-version');
        const headers = { 'Content-Type': 'application/json', 'X-Client-Protocol': CLIENT_PROTOCOL };
        if (!isIdChanged && config.deviceToken) headers['X-Device-Token'] = config.deviceToken; // lets the server rotate it

        // Use 'register' to handshake. It handles Create (if new ID) or Update (if existing ID).
        const res = await fetchWithTimeout(`${newIp}/api/v1/devices/register`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                deviceKey: newId,
                deviceName: newName,
                branchCode: newBranch,
                location: newLocation,
                ipAddress: '127.0.0.1', // Server should detect real IP. We send placeholder.
                appVersion: appVer,
                tokenCapable: true // contract T1
            })
        }, TIMEOUTS.settings);

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const result = await readJsonSafe(res);

        if (result && result.success) {
            // 4. Success -> Save Config
            config.serverIp = newIp;
            config.deviceId = newId;
            config.deviceName = newName;
            config.branchCode = newBranch;
            config.location = newLocation;
            if (result.data && result.data.deviceToken) {
                config.deviceToken = String(result.data.deviceToken);
            } else if (isIdChanged) {
                config.deviceToken = null; // the old token belongs to the old identity
            }

            await ipcRenderer.invoke('save-config', config);
            showHUD('UPDATED. RESTARTING...');
            setTimeout(() => window.location.reload(), 1500);
        } else {
            alert('Server Rejected Update: ' + ((result && result.message) || 'Unknown Error'));
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
    changelogContent.textContent = "Loading history from server...";
    updateCursorVisibility();

    try {
        // 1. Try API first (Best for latest info)
        if (config && config.serverIp) {
            try {
                const res = await fetchWithTimeout(serverUrl('/api/v1/changelog'), { headers: deviceHeaders() }, TIMEOUTS.settings);
                if (res.ok) {
                    const data = await readJsonSafe(res);
                    if (data && data.success && data.data) {
                        changelogContent.textContent = String(data.data);
                        return; // Found on server, we're done
                    }
                }
            } catch (apiErr) {
                console.warn("Changelog API failed, falling back to local file...", apiErr.message);
            }
        }

        // 2. Fallback to Local File (Best for Offline)
        const text = await ipcRenderer.invoke('read-changelog');
        changelogContent.textContent = text;
    } catch (err) {
        changelogContent.textContent = "Failed to load patch history: " + err.message;
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

function toggleDashboard() {
    dashboardScreen.classList.toggle('hidden');
    if (!dashboardScreen.classList.contains('hidden')) {
        refreshSecurityPanel();
        updateStorage();
    }
    updateCursorVisibility();
}

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
document.getElementById('btn-f7').onclick = () => toggleDashboard();
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
    if (e.key === 'F7') { highlightShortcut('btn-f7'); toggleDashboard(); }
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
    const msg = document.getElementById('update-status-msg');
    msg.textContent = "Checking...";
    try {
        const cur = await ipcRenderer.invoke('get-app-version');
        const latest = await fetchSetting('LatestClientVersion');
        if (latest && latest !== cur) {
            msg.textContent = `New: ${latest}`;
            if (confirm(`Download v${latest}?`)) {
                const started = await runClientUpdate(null);
                if (!started) msg.textContent = "Update failed. Try again.";
            }
        } else {
            msg.textContent = latest ? "Up to date." : "Could not read LatestClientVersion from server.";
        }
    } catch (err) {
        msg.textContent = `Update check failed: ${err.message}`;
    }
};

init();
