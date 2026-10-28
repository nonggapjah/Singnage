const { app, BrowserWindow, ipcMain, screen, powerSaveBlocker, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const fsp = require('fs/promises');
const https = require('https');
const http = require('http');
const { exec, execFile, spawn } = require('child_process');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const os = require('os');
const { pathToFileURL } = require('url');
const { createRotatingLogger } = require('./src/lib/logger');
const { isSafeName, resolveInside } = require('./src/lib/paths');
const { evaluateHealth } = require('./src/lib/health');
const { checkUpdateUrl, checkRedirectHop } = require('./src/lib/update-url');

// Smoke-test mode (smoke/run-smoke.js): isolated user-data folder, small non-kiosk window, no
// system side effects (autostart, registry, power plan, w32tm, schtasks, diagnostics port), and
// a report written after SIGNAGE_SMOKE_MS followed by a clean exit.
const SMOKE = process.env.SIGNAGE_SMOKE === '1';
if (process.env.SIGNAGE_USER_DATA) app.setPath('userData', process.env.SIGNAGE_USER_DATA);

// The former `ignore-certificate-errors` switch is gone. It was added for kiosks whose clock had
// drifted far enough to break TLS, but it also disabled validation for installer downloads, which
// turned any on-path attacker into a code-execution path. Clock skew is now handled explicitly in
// checkClockSkew() and, for MEDIA downloads only, inside httpGetStream().
// Prevent background timer throttling (keeps intervals/heartbeats active when screen is covered or inactive)
app.commandLine.appendSwitch('disable-background-timer-throttling');
// Prevent GPU process from disabling hardware acceleration after multiple crashes
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');

// --- Native HTTP Download Helper (replaces axios dependency) ---
const CLOCK_SKEW_CERT_CODES = new Set(['CERT_NOT_YET_VALID', 'CERT_HAS_EXPIRED']);
// Smoke test only: trust the self-signed certificate of the local TLS mock so the https->http
// redirect refusal can be exercised end to end. Never set outside SIGNAGE_SMOKE=1.
const SMOKE_EXTRA_CA = (SMOKE && process.env.SIGNAGE_SMOKE_CA_FILE) ? [require('fs').readFileSync(process.env.SIGNAGE_SMOKE_CA_FILE)] : undefined;
const httpsAgent = new https.Agent({ rejectUnauthorized: true, keepAlive: true, ca: SMOKE_EXTRA_CA });
// Used ONLY (a) for media downloads after a clock-skew certificate error and (b) for the clock
// probe, which reads nothing but the Date header. Installers never use it.
const clockSkewAgent = new https.Agent({ rejectUnauthorized: false });
let clockSkewSeconds = 0;
let clockSkewDetected = false;

/**
 * Downloads a URL as a stream using Node's built-in https/http.
 * Returns a promise that resolves to { status, headers, stream }.
 * options: { method, allowClockSkewBypass, insecure, redirectDepth, updatePolicy }
 *   updatePolicy: { allowInsecure } -> every redirect hop must satisfy the update-channel rule
 *   (https, or loopback, or the explicit allowInsecure escape hatch); a violating hop rejects
 *   with err.code = INSECURE_UPDATE_URL instead of being followed (round 3 / Codex #5).
 */
function httpGetStream(url, requestHeaders = {}, timeoutMs = 300000, options = {}) {
    const { method = 'GET', allowClockSkewBypass = false, insecure = false, redirectDepth = 0, updatePolicy = null } = options;
    return new Promise((resolve, reject) => {
        let parsedUrl;
        try {
            parsedUrl = new URL(url);
        } catch (e) {
            reject(new Error(`Invalid URL: ${String(url).slice(0, 120)}`));
            return;
        }
        if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
            reject(new Error(`Unsupported protocol: ${parsedUrl.protocol}`));
            return;
        }
        const isHttps = parsedUrl.protocol === 'https:';
        const lib = isHttps ? https : http;
        const req = lib.request({
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (isHttps ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method,
            headers: requestHeaders,
            agent: isHttps ? (insecure ? clockSkewAgent : httpsAgent) : undefined,
            timeout: timeoutMs
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                let next;
                if (updatePolicy) {
                    // Update channel: the rule is enforced on EVERY hop, not only the first URL.
                    const hop = checkRedirectHop(url, res.headers.location, updatePolicy.allowInsecure === true, redirectDepth);
                    if (!hop.ok) {
                        const err = new Error(hop.reason);
                        err.code = hop.code;
                        console.error(`[UPDATE] Refusing redirect hop ${redirectDepth + 1} from ${url}: ${hop.reason}`);
                        reject(err);
                        return;
                    }
                    if (hop.insecure) console.warn(`[UPDATE] WARN: redirect hop to plain http accepted because allowInsecureUpdates is set: ${hop.url}`);
                    next = hop.url;
                } else {
                    if (redirectDepth >= 5) {
                        reject(new Error('Too many redirects'));
                        return;
                    }
                    try {
                        next = new URL(res.headers.location, parsedUrl).href;
                    } catch (e) {
                        reject(new Error('Invalid redirect location'));
                        return;
                    }
                }
                resolve(httpGetStream(next, requestHeaders, timeoutMs, { ...options, redirectDepth: redirectDepth + 1 }));
                return;
            }
            resolve({ status: res.statusCode, headers: res.headers, stream: res });
        });
        req.on('timeout', () => { req.destroy(new Error('Request timed out')); });
        req.on('error', (err) => {
            if (isHttps && !insecure && allowClockSkewBypass && err && CLOCK_SKEW_CERT_CODES.has(err.code)) {
                clockSkewDetected = true;
                console.error(`[TLS] CLOCK_SKEW: certificate for ${parsedUrl.hostname} rejected with ${err.code} ` +
                    `(local time ${new Date().toISOString()}). Retrying this MEDIA download without certificate ` +
                    'validation. Fix the device clock. Installers are never downloaded this way.');
                resolve(httpGetStream(url, requestHeaders, timeoutMs, { ...options, insecure: true }));
                return;
            }
            reject(err);
        });
        req.end();
    });
}

let mainWindow;
let sleepBlockerId;
let db;
let diagToken = null;
let lastKnownConfig = null;
let playbackState = { playing: false, deviceId: null, updatedAt: 0 };

// Bounded cache of "file name + hash" pairs already verified this process lifetime (F31).
const verifiedFiles = new Set();
const MAX_VERIFIED_ENTRIES = 5000;
function rememberVerified(key) {
    if (verifiedFiles.size >= MAX_VERIFIED_ENTRIES) verifiedFiles.clear();
    verifiedFiles.add(key);
}

// Enforce single instance lock to prevent duplicate instances consuming CPU/GPU and creating duplicate DB entries
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    console.log('Another instance of Signage Unicorn is already running. Exiting.');
    app.quit();
    process.exit(0);
}

app.on('second-instance', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    }
});

const USER_DATA = app.getPath('userData');
const CONFIG_PATH = path.join(USER_DATA, 'config.json');
const CONFIG_BAK_PATH = path.join(USER_DATA, 'config.json.bak');
const MEDIA_DIR = path.join(USER_DATA, 'media_cache');
const FALLBACK_DIR = path.join(USER_DATA, 'fallback_media');
const DB_PATH = path.join(USER_DATA, 'player_offline.db');
const HEALTH_PATH = path.join(USER_DATA, 'health.json');
const UPDATE_LOCK_PATH = path.join(USER_DATA, 'update.lock');
const UPDATE_LOCK_MAX_AGE_MS = 30 * 60 * 1000;
const DEFAULT_CONFIG = { serverIp: 'https://signage.aith123.com', deviceId: null, deviceName: null, branchCode: '1000' };
const LOG_DIR = path.join(USER_DATA, 'logs');

// ---------------------------------------------------------------------------------------------
// Persistent rotating log: <userData>/logs/app-YYYYMMDD.log, 5 MB per file, newest 7 kept.
// Everything main prints goes there too, and renderer addLog() lines arrive over the `log-line`
// IPC. Before this the only trace of a crash was the volatile F7 panel.
// ---------------------------------------------------------------------------------------------
const fileLog = createRotatingLogger({ dir: LOG_DIR, maxBytes: 5 * 1024 * 1024, keepFiles: 7 });
const smokeReport = { registered: false, tokenClaimed: false, tokenReclaimed: 0, capabilitiesProbed: false, heartbeats: 0, commandsAcked: 0, mediaDownloaded: 0, playbackLogsAccepted: 0, healthWritten: false, idleOnEmptySchedule: false, updateRefusedInsecure: false, installerLaunched: false, errors: [] };
(function routeConsoleToFile() {
    const fmt = (args) => args.map(a => {
        if (a instanceof Error) return a.stack || a.message;
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a); } catch (e) { return String(a); }
    }).join(' ');
    for (const level of ['log', 'info', 'warn', 'error']) {
        const orig = console[level].bind(console);
        console[level] = (...args) => {
            orig(...args);
            try {
                const msg = fmt(args);
                fileLog.write(level === 'log' ? 'info' : level, msg);
                if (SMOKE && level === 'error') smokeReport.errors.push(msg.slice(0, 300));
            } catch (e) { /* never let logging fail the player */ }
        };
    }
})();

// ---------------------------------------------------------------------------------------------
// Config: atomic writes, backup, serialized access (F32)
// ---------------------------------------------------------------------------------------------
let configWriteChain = Promise.resolve();

function validateConfigShape(cfg) {
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return 'config must be an object';
    if (cfg.serverIp !== undefined && cfg.serverIp !== null && typeof cfg.serverIp !== 'string') return 'serverIp must be a string';
    if (cfg.deviceId !== undefined && cfg.deviceId !== null &&
        typeof cfg.deviceId !== 'string' && typeof cfg.deviceId !== 'number') return 'deviceId must be a string or number';
    if (cfg.deviceToken !== undefined && cfg.deviceToken !== null && typeof cfg.deviceToken !== 'string') return 'deviceToken must be a string';
    return null;
}

async function readJsonIfValid(p) {
    if (!await fs.pathExists(p)) return null;
    const parsed = await fs.readJson(p);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not a JSON object');
    return parsed;
}

// Reads config.json; falls back to config.json.bak when the main file is missing, unreadable or
// not valid JSON (a crash during a write used to leave the device "unconfigured" and make it
// re-register as a brand new identity).
async function readConfigSafe() {
    try {
        const main = await readJsonIfValid(CONFIG_PATH);
        if (main) return main;
    } catch (e) {
        console.error(`[CONFIG] ${CONFIG_PATH} is unreadable (${e.message}); trying backup.`);
    }
    try {
        const bak = await readJsonIfValid(CONFIG_BAK_PATH);
        if (bak) {
            console.error('[CONFIG] Recovered configuration from config.json.bak');
            return bak;
        }
    } catch (e) {
        console.error(`[CONFIG] Backup is unreadable too (${e.message}).`);
    }
    return null;
}

function writeConfigAtomic(config) {
    const run = async () => {
        await fs.ensureDir(USER_DATA);
        const tmp = `${CONFIG_PATH}.${process.pid}.tmp`;
        await fs.writeJson(tmp, config, { spaces: 2 });
        if (await fs.pathExists(CONFIG_PATH)) {
            try {
                const current = await readJsonIfValid(CONFIG_PATH);
                if (current) await fs.copy(CONFIG_PATH, CONFIG_BAK_PATH, { overwrite: true });
            } catch (e) {
                // A corrupt main file must not overwrite a good backup.
            }
        }
        await fsp.rename(tmp, CONFIG_PATH); // atomic replace on the same volume
        lastKnownConfig = config;
    };
    configWriteChain = configWriteChain.then(run, run);
    return configWriteChain;
}

function randomToken(bytes = 24) {
    return crypto.randomBytes(bytes).toString('base64url');
}

async function loadConfigForStartup() {
    let cfg = await readConfigSafe();
    if (!cfg) cfg = { ...DEFAULT_CONFIG };
    let changed = false;
    if (!cfg.diagToken || typeof cfg.diagToken !== 'string') {
        cfg.diagToken = randomToken(12);
        changed = true;
    }
    if (changed) await writeConfigAtomic(cfg);
    diagToken = cfg.diagToken;
    lastKnownConfig = cfg;
    return cfg;
}

// Media cache path safety (F05) lives in src/lib/paths.js (isSafeName / resolveInside) so it is
// unit-tested; every filesystem IPC below goes through resolveInside().
function mediaDirFor(isFallback) {
    return isFallback ? FALLBACK_DIR : MEDIA_DIR;
}

// ---------------------------------------------------------------------------------------------
// Identity migration across user profiles (unchanged behaviour)
// ---------------------------------------------------------------------------------------------
async function migrateData() {
    const parentRoaming = app.getPath('appData');
    const newUserData = app.getPath('userData');
    const systemUsersDir = 'C:\\Users';

    // 1. Gather all possible parent AppData/Roaming and AppData/Local folders
    let possibleParents = [parentRoaming, path.join(parentRoaming, '..', 'Local')];

    try {
        if (await fs.pathExists(systemUsersDir)) {
            const users = await fs.readdir(systemUsersDir);
            for (const user of users) {
                if (user === 'Public' || user === 'Default' || user === 'Default User') continue;
                possibleParents.push(`C:\\Users\\${user}\\AppData\\Roaming`);
                possibleParents.push(`C:\\Users\\${user}\\AppData\\Local`);
            }
        }
    } catch (e) {
        // Best-effort discovery, but a silent failure here means the migration below finds no
        // candidate profiles and quietly restores nothing.
        console.warn(`[MIGRATION] Could not enumerate user profiles: ${e.message}`);
    }

    possibleParents = [...new Set(possibleParents)];

    // 2. Generate candidates
    const folderNames = ['signage-unicorn-client', 'Signage Unicorn', 'signage-unicorn', 'signage-unicorn-client-updater'];
    const candidates = [];
    for (const parent of possibleParents) {
        for (const fName of folderNames) {
            candidates.push(path.join(parent, fName));
        }
    }

    let hasValidConfig = false;
    const current = await readConfigSafe();
    if (current && current.deviceId && current.serverIp) hasValidConfig = true;

    // Only migrate if we don't have a valid ID in the new location
    if (!hasValidConfig) {
        for (const oldUserData of candidates) {
            const oldConfig = path.join(oldUserData, 'config.json');

            // Skip if this is exactly the current path where we are saving
            if (oldUserData.toLowerCase() === newUserData.toLowerCase()) continue;

            if (await fs.pathExists(oldConfig)) {
                console.log(`MIGRATION: Scrutinizing potential old config in [${oldUserData}]...`);
                try {
                    const oldData = await fs.readJson(oldConfig);
                    const hasValidId = oldData && oldData.deviceId && (String(oldData.deviceId).trim().length > 0);
                    if (oldData && hasValidId && oldData.serverIp) {
                        console.log(`MIGRATION: Valid identity found in [${oldUserData}]. Restoring...`);
                        await writeConfigAtomic(oldData);

                        const oldDb = path.join(oldUserData, 'player_offline.db');
                        if (await fs.pathExists(oldDb)) {
                            await fs.copy(oldDb, DB_PATH, { overwrite: true });
                        }

                        const oldMedia = path.join(oldUserData, 'media_cache');
                        if (await fs.pathExists(oldMedia)) {
                            await fs.copy(oldMedia, MEDIA_DIR, { overwrite: true });
                        }
                        console.log('MIGRATION: Completely recovered identity across profiles.');
                        return; // Done
                    }
                } catch (e) {
                    console.error(`MIGRATION: Error copying from [${oldUserData}]:`, e);
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// SQLite offline store
// ---------------------------------------------------------------------------------------------
const PLAYBACK_LOG_CAP = 50000;

function ensurePlaybackLogSchema() {
    const cols = db.prepare('PRAGMA table_info(playback_logs)').all().map(c => c.name);
    if (!cols.includes('eventId')) {
        db.prepare('ALTER TABLE playback_logs ADD COLUMN eventId TEXT').run();
        console.log('[DB] Added playback_logs.eventId');
    }
    // Legacy rows get an id so the server can deduplicate them too.
    const missing = db.prepare('SELECT id FROM playback_logs WHERE eventId IS NULL OR eventId = \'\'').all();
    if (missing.length > 0) {
        const upd = db.prepare('UPDATE playback_logs SET eventId = ? WHERE id = ?');
        db.transaction((rows) => {
            for (const r of rows) upd.run(crypto.randomUUID(), r.id);
        })(missing);
    }
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_playback_logs_eventId ON playback_logs(eventId)').run();
}

// Keeps the offline log table bounded (F31): oldest synced rows go first, then oldest unsynced
// rows with a warning because that is data the server never received.
function enforcePlaybackLogCap() {
    try {
        const count = db.prepare('SELECT COUNT(*) AS c FROM playback_logs').get().c;
        if (count <= PLAYBACK_LOG_CAP) return;
        let excess = count - PLAYBACK_LOG_CAP;
        const syncedDeleted = db.prepare(
            'DELETE FROM playback_logs WHERE id IN (SELECT id FROM playback_logs WHERE isSynced <> 0 ORDER BY id ASC LIMIT ?)'
        ).run(excess).changes;
        excess -= syncedDeleted;
        if (excess > 0) {
            const lost = db.prepare(
                'DELETE FROM playback_logs WHERE id IN (SELECT id FROM playback_logs WHERE isSynced = 0 ORDER BY id ASC LIMIT ?)'
            ).run(excess).changes;
            console.warn(`[DB] playback_logs over cap (${PLAYBACK_LOG_CAP}): dropped ${lost} UNSYNCED event(s) that the server never received.`);
        }
    } catch (e) {
        console.error('[DB] Cap enforcement failed:', e.message);
    }
}

function initDb() {
    try {
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');

        // Playback Logs Table
        db.prepare(`
            CREATE TABLE IF NOT EXISTS playback_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                deviceId TEXT,
                mediaId TEXT,
                playlistId TEXT,
                duration INTEGER,
                result TEXT,
                errorMessage TEXT,
                playedAt TEXT,
                isSynced INTEGER DEFAULT 0
            )
        `).run();

        // Playlist Data Cache
        db.prepare(`
            CREATE TABLE IF NOT EXISTS playlist_cache (
                key TEXT PRIMARY KEY,
                data TEXT,
                updatedAt TEXT
            )
        `).run();

        ensurePlaybackLogSchema();
        enforcePlaybackLogCap();

        console.log('SQLite Database Initialized at:', DB_PATH);
    } catch (err) {
        console.error('SQLite Initialization Failed:', err);
    }
}

// ---------------------------------------------------------------------------------------------
// Window (F04): sandboxed renderer, preload bridge, no navigation, no popups
// ---------------------------------------------------------------------------------------------
async function createWindow() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.size;

    mainWindow = new BrowserWindow(SMOKE ? {
        width: 480,
        height: 270,
        fullscreen: false,
        kiosk: false,
        frame: true,
        alwaysOnTop: false,
        skipTaskbar: false,
        show: true,
        title: 'Signage Unicorn SMOKE TEST',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
            backgroundThrottling: false,
        },
        backgroundColor: '#000000'
    } : {
        width,
        height,
        fullscreen: true,
        kiosk: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        autoHideMenuBar: true,
        minimizeOnExclusiveFocusLoss: false,
        show: false, // Don't show until we are ready to take over the screen
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
        },
        backgroundColor: '#000000'
    });
    mainWindow.webContents.on('did-finish-load', () => {
        rendererLoadedAt = Date.now();
        rendererReloadDone = false;
        lastRendererReport = { ts: 0, playing: false, position: 0, itemIndex: 0 };
    });

    // The player page must never open windows or navigate away from itself.
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', (event, navUrl) => {
        if (navUrl !== mainWindow.webContents.getURL()) {
            console.warn(`[SECURITY] Blocked navigation to ${navUrl}`);
            event.preventDefault();
        }
    });
    mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());

    // Remove menu completely
    mainWindow.setMenu(null);
    mainWindow.setMenuBarVisibility(false);

    if (!SMOKE) {
        // Force top-most level even above system dialogs and taskbars
        mainWindow.setAlwaysOnTop(true, 'screen-saver');

        mainWindow.once('ready-to-show', () => {
            // Slight delay to ensure Windows Taskbar has finished its own initialization during boot
            setTimeout(() => {
                mainWindow.show();
                mainWindow.focus();
                mainWindow.setKiosk(true);
                mainWindow.setAlwaysOnTop(true, 'screen-saver');
                mainWindow.setFullScreen(true);
            }, 1000);
        });
    }

    mainWindow.loadFile('index.html');

    // Create media directory
    await fs.ensureDir(MEDIA_DIR);

    if (SMOKE) return; // no power/autostart/registry changes on a developer machine

    // Prevent Sleep & Force Disable Windows Screensaver via Registry
    sleepBlockerId = powerSaveBlocker.start('prevent-display-sleep');
    try {
        // Use Official Electron API for Auto-Start (more reliable, less likely to be blocked by AV)
        app.setLoginItemSettings({
            openAtLogin: true,
            path: process.execPath,
            args: []
        });

        exec('reg add "HKEY_CURRENT_USER\\Control Panel\\Desktop" /v ScreenSaveActive /t REG_SZ /d 0 /f');
        // Fallback Force Auto-Start on Boot (Keep this as requested just in case)
        exec(`reg add "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "SignageUnicorn" /d "\\"${process.execPath}\\"" /f`);

        // Disable monitor timeout, standby timeout, and disk sleep on AC power
        exec('powercfg /change monitor-timeout-ac 0');
        exec('powercfg /change standby-timeout-ac 0');
        exec('powercfg /change disk-timeout-ac 0');

        console.log('Windows Screensaver disabled. Auto-Start registered. Windows Power Plan optimized.');
    } catch (e) {
        console.error('Failed to configure power/startup settings:', e);
    }
    console.log('Power save blocker started:', sleepBlockerId);
}

// ---------------------------------------------------------------------------------------------
// Clock skew (F03): the real reason certificate validation used to be disabled.
// ---------------------------------------------------------------------------------------------
async function checkClockSkew(config) {
    try {
        if (!config || !config.serverIp) return;
        const probeUrl = `${String(config.serverIp).replace(/\/$/, '')}/api/v1/system/settings/LatestClientVersion`;
        // The probe deliberately tolerates a certificate error: a skewed clock is exactly what makes
        // certificates fail. Nothing from the response is trusted beyond its Date header, and the
        // only consequences are a log line and a best-effort time resync.
        const res = await httpGetStream(probeUrl, {}, 15000, { method: 'HEAD', insecure: true });
        res.stream.resume();
        const serverDate = res.headers && res.headers.date ? new Date(res.headers.date) : null;
        if (!serverDate || isNaN(serverDate.getTime())) return;
        clockSkewSeconds = Math.round((Date.now() - serverDate.getTime()) / 1000);
        if (Math.abs(clockSkewSeconds) > 300) {
            clockSkewDetected = true;
            console.error(`[CLOCK] CLOCK_SKEW: local time ${new Date().toISOString()} differs from server time ` +
                `${serverDate.toISOString()} by ${clockSkewSeconds}s. TLS validation will fail until the clock is ` +
                "fixed. Attempting 'w32tm /resync' once.");
            exec('w32tm /resync', (err, stdout) => {
                if (err) console.error(`[CLOCK] w32tm /resync failed (needs admin rights / Windows Time service): ${err.message}`);
                else console.log(`[CLOCK] w32tm /resync: ${String(stdout || '').trim()}`);
            });
        } else {
            console.log(`[CLOCK] Skew vs server: ${clockSkewSeconds}s`);
        }
    } catch (e) {
        console.warn(`[CLOCK] Skew probe failed: ${e.message}`);
    }
}

// ---------------------------------------------------------------------------------------------
// Update lock + health file (F30)
// ---------------------------------------------------------------------------------------------
async function cleanupStaleUpdateLock() {
    try {
        if (!await fs.pathExists(UPDATE_LOCK_PATH)) return;
        let lock = null;
        try { lock = await fs.readJson(UPDATE_LOCK_PATH); } catch (e) { /* unreadable: treat as stale */ }
        const started = lock && lock.startedAt ? Date.parse(lock.startedAt) : NaN;
        const age = isNaN(started) ? Infinity : Date.now() - started;
        const finished = lock && lock.version && lock.version === app.getVersion();
        if (finished || age > UPDATE_LOCK_MAX_AGE_MS) {
            await fs.remove(UPDATE_LOCK_PATH);
            console.log(`[UPDATE] Removed ${finished ? 'completed' : 'stale'} update.lock`);
        }
    } catch (e) {
        console.warn(`[UPDATE] Could not inspect update.lock: ${e.message}`);
    }
}

async function writeUpdateLock(version, installerPath) {
    const tmp = `${UPDATE_LOCK_PATH}.tmp`;
    await fs.writeJson(tmp, { version: version || null, startedAt: new Date().toISOString(), installer: installerPath, pid: process.pid, source: 'client' });
    await fsp.rename(tmp, UPDATE_LOCK_PATH);
}

// Health (Codex 22): main's own timer proves nothing about a frozen renderer, so health.json is
// derived from the renderer's periodic `report-health` IPC. No report for 60 s -> rendererStale
// (the watchdog treats that as unhealthy); no report for 3 min -> one renderer reload, logged.
let lastRendererReport = { ts: 0, playing: false, position: 0, itemIndex: 0 };
let rendererLoadedAt = 0;
let rendererReloadDone = false;
const HEALTH_STALE_MS = 60 * 1000;
const HEALTH_RELOAD_MS = 3 * 60 * 1000;

async function writeHealth() {
    try {
        const verdict = evaluateHealth({
            lastReportTs: lastRendererReport.ts,
            rendererLoadedAt,
            now: Date.now(),
            staleAfterMs: HEALTH_STALE_MS,
            reloadAfterMs: HEALTH_RELOAD_MS,
            reloadAlreadyDone: rendererReloadDone,
        });
        const payload = {
            ts: new Date().toISOString(),
            rendererReportTs: lastRendererReport.ts ? new Date(lastRendererReport.ts).toISOString() : null,
            rendererStale: verdict.rendererStale,
            playing: !!lastRendererReport.playing,
            position: lastRendererReport.position || 0,
            itemIndex: lastRendererReport.itemIndex || 0,
            deviceId: playbackState.deviceId ?? (lastKnownConfig ? lastKnownConfig.deviceId : null),
            pid: process.pid,
            version: app.getVersion(),
        };
        const tmp = `${HEALTH_PATH}.tmp`;
        await fs.writeJson(tmp, payload);
        await fsp.rename(tmp, HEALTH_PATH);
        smokeReport.healthWritten = true;

        if (verdict.needsReload && mainWindow && !mainWindow.isDestroyed()) {
            rendererReloadDone = true;
            console.error(`[HEALTH] Renderer silent for ${Math.round((verdict.silenceMs || 0) / 1000)}s: reloading the page once (self-heal). If this repeats the watchdog restarts the player.`);
            mainWindow.webContents.reloadIgnoringCache();
        }
    } catch (e) {
        console.warn(`[HEALTH] Could not write health.json: ${e.message}`);
    }
}

function startHealthWriter() {
    writeHealth();
    setInterval(writeHealth, 30000);
}

// ---------------------------------------------------------------------------------------------
// Watchdog self-registration (best effort): the scripts ship inside app.asar where Task Scheduler
// cannot run them, so a plain copy is kept under userData and a per-user ONLOGON task points at
// it. config.watchdogAutoRegister = false disables this.
// ---------------------------------------------------------------------------------------------
const WATCHDOG_TASK = 'SignageUnicornWatchdog';

function runTool(file, args, timeoutMs = 20000) {
    return new Promise((resolve) => {
        execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
            resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || ''), err });
        });
    });
}

async function registerWatchdogTask(config) {
    if (SMOKE) return;
    if (config && config.watchdogAutoRegister === false) return;
    if (process.platform !== 'win32') return;
    try {
        const src = path.join(app.getAppPath(), 'Watchdog.ps1');
        const destDir = path.join(USER_DATA, 'watchdog');
        const dest = path.join(destDir, 'Watchdog.ps1');
        const content = await fs.readFile(src, 'utf8'); // readable through asar
        await fs.ensureDir(destDir);
        let current = null;
        try { current = await fs.readFile(dest, 'utf8'); } catch (e) { /* first run */ }
        if (current !== content) {
            await fs.writeFile(dest, content, 'utf8');
            console.log(`[WATCHDOG] Script copied to ${dest}`);
        }
        const query = await runTool('schtasks', ['/Query', '/TN', WATCHDOG_TASK]);
        if (query.code === 0) {
            console.log(`[WATCHDOG] Scheduled task '${WATCHDOG_TASK}' already registered.`);
            return;
        }
        const tr = `powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File "${dest}"`;
        const create = await runTool('schtasks', ['/Create', '/SC', 'ONLOGON', '/TN', WATCHDOG_TASK, '/TR', tr, '/F', '/RL', 'LIMITED']);
        if (create.code === 0) console.log(`[WATCHDOG] Scheduled task '${WATCHDOG_TASK}' registered (ONLOGON): ${create.stdout.trim()}`);
        else console.warn(`[WATCHDOG] Could not register scheduled task (code ${create.code}): ${(create.stderr || create.stdout).trim()}. Run StartWatchdog.bat manually or set up the task by hand.`);
    } catch (e) {
        console.warn(`[WATCHDOG] Self-registration skipped: ${e.message}`);
    }
}

// Smoke report (smoke/run-smoke.js): written after SIGNAGE_SMOKE_MS, then the app quits.
async function finishSmokeRun() {
    try {
        const reportPath = path.join(USER_DATA, 'smoke-report.json');
        await fs.writeJson(reportPath, Object.assign({ version: app.getVersion(), finishedAt: new Date().toISOString() }, smokeReport), { spaces: 2 });
        console.log(`[SMOKE] Report written to ${reportPath}`);
    } catch (e) {
        console.error(`[SMOKE] Could not write report: ${e.message}`);
    }
    app.isQuitting = true;
    app.exit(0);
}

// ---------------------------------------------------------------------------------------------
app.whenReady().then(async () => {
    // --- Global Crash Recovery Engine ---
    process.on('uncaughtException', (err) => {
        console.log('FATAL SYSTEM ERROR:', err);
        if (process.uptime() > 10) {
            app.relaunch();
        }
        app.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
        console.error('Unhandled Promise Rejection:', reason);
        // Do not crash for promise errors, just log them to prevent exit
    });

    app.on('render-process-gone', (event, webContents, details) => {
        console.error('RENDERER CRASHED (OOM or UI Fatal):', details.reason);
        app.relaunch();
        app.exit(1);
    });

    app.on('child-process-gone', (event, details) => {
        console.warn('Sub-Process Failed:', details.type, details.reason);
        if (details.type === 'GPU' && details.reason !== 'clean-exit') {
            console.error('GPU KERNEL PANIC. Restarting player.');
            app.relaunch();
            app.exit(1);
        }
    });

    if (!SMOKE) await migrateData();
    initDb();
    await cleanupStaleUpdateLock();
    const config = await loadConfigForStartup();
    console.log(`[BOOT] Signage Unicorn v${app.getVersion()} starting; logs in ${LOG_DIR}${SMOKE ? ' (SMOKE MODE)' : ''}`);
    createWindow();
    startHealthWriter();
    if (SMOKE) {
        const ms = Number(process.env.SIGNAGE_SMOKE_MS) || 45000;
        setTimeout(finishSmokeRun, ms);
        return;
    }
    startDiagnosticServer(config);
    checkClockSkew(config);
    registerWatchdogTask(config);

    // Schedule automatic restart at 4:00 AM daily to prevent memory leaks and ensure freshness
    setInterval(async () => {
        const now = new Date();
        if (now.getHours() === 4 && now.getMinutes() < 5) {
            if (app.isQuitting) return; // Already shutting down
            if (await fs.pathExists(UPDATE_LOCK_PATH)) return; // never relaunch under an installer
            console.log('Daily maintenance: Scheduled relaunch at 4:00 AM.');
            app.relaunch();
            app.exit(0);
        }
    }, 300000); // Check every 5 minutes
});

// --- IPC Handlers for Settings & Management ---
ipcMain.handle('get-config', async () => {
    const cfg = await readConfigSafe();
    if (cfg) {
        if (!cfg.diagToken) {
            cfg.diagToken = diagToken || randomToken(12);
            diagToken = cfg.diagToken;
            await writeConfigAtomic(cfg);
        }
        lastKnownConfig = cfg;
        return cfg;
    }
    return { ...DEFAULT_CONFIG, diagToken: diagToken || undefined };
});

ipcMain.handle('save-config', async (event, incoming) => {
    const err = validateConfigShape(incoming);
    if (err) return { success: false, error: err };
    try {
        const current = (await readConfigSafe()) || {};
        // Merge so a renderer that holds an older snapshot cannot silently drop keys written by
        // main (diagToken). Explicit nulls from the renderer still win (identity change clears a token).
        const merged = { ...current, ...incoming };
        if (!merged.diagToken && diagToken) merged.diagToken = diagToken;
        await writeConfigAtomic(merged);
        if (merged.deviceId !== undefined) playbackState.deviceId = merged.deviceId;
        return { success: true };
    } catch (e) {
        console.error('[CONFIG] Save failed:', e.message);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('get-app-version', () => {
    return app.getVersion(); // Reads from package.json "version"
});

ipcMain.handle('get-diagnostics-info', () => {
    const bind = (lastKnownConfig && typeof lastKnownConfig.diagnosticsBind === 'string' && lastKnownConfig.diagnosticsBind) || '127.0.0.1';
    return {
        diagToken,
        portalUrl: `http://${bind === '0.0.0.0' ? '127.0.0.1' : bind}:8088`,
        bind,
        clockSkewSeconds,
        clockSkewDetected,
        version: app.getVersion(),
        logDir: LOG_DIR,
        smoke: SMOKE,
    };
});

// Renderer liveness (Codex 22): the renderer calls this every 15 s with its playback state.
ipcMain.handle('report-health', (event, state) => {
    const s = (state && typeof state === 'object') ? state : {};
    lastRendererReport = {
        ts: Date.now(),
        playing: !!s.playing,
        position: Number(s.position) || 0,
        itemIndex: Number(s.itemIndex) || 0,
    };
    if (s.deviceId !== undefined) playbackState.deviceId = s.deviceId;
    playbackState = { playing: !!s.playing, deviceId: playbackState.deviceId, updatedAt: Date.now() };
    return { success: true };
});

// Renderer log lines land in the rotating file too (the F7 panel is volatile).
ipcMain.handle('log-line', (event, entry) => {
    const e = (entry && typeof entry === 'object') ? entry : { message: String(entry) };
    const level = ['info', 'warn', 'error'].includes(String(e.level)) ? String(e.level) : 'info';
    fileLog.write(level, `[renderer] ${String(e.message || '').slice(0, 2000)}`);
    if (SMOKE && level === 'error') smokeReport.errors.push(`[renderer] ${String(e.message || '').slice(0, 300)}`);
    if (SMOKE && String(e.message || '').includes('is empty on the server: stopping playback')) smokeReport.idleOnEmptySchedule = true;
    return { success: true };
});

// Smoke-test progress events from the renderer; ignored outside smoke mode.
ipcMain.handle('smoke-event', (event, name, value) => {
    if (!SMOKE) return { success: true };
    const n = String(name);
    if (n in smokeReport) {
        if (typeof smokeReport[n] === 'number') smokeReport[n] += (typeof value === 'number' ? value : 1);
        else if (typeof smokeReport[n] === 'boolean') smokeReport[n] = value === undefined ? true : !!value;
    }
    return { success: true };
});

ipcMain.handle('set-playback-state', (event, state) => {
    if (state && typeof state === 'object') {
        playbackState = {
            playing: !!state.playing,
            deviceId: state.deviceId !== undefined ? state.deviceId : playbackState.deviceId,
            updatedAt: Date.now(),
        };
    }
    return { success: true };
});

// BUG-03: the fleet reported a blank MAC on 292 of 292 devices, because the client never sent
// one -- the server side of the pipe (DTO, repository parameter, sn_devices.mac_address) was
// already in place and simply never received a value. Without a stable hardware identifier the
// server cannot merge a screen's old and new rows when it upgrades, so every upgrade spawns a
// duplicate that the maintenance worker has to retire after the fact.
//
// Picks the first physical adapter: skips loopback/internal, all-zero addresses, and the
// virtual adapters that Hyper-V, VirtualBox, VMware and Docker leave behind (their MACs are
// not stable across reinstalls, which would defeat the whole point). Sorted by interface name
// so the same machine keeps returning the same MAC when it has several NICs.
ipcMain.handle('get-mac-address', async () => {
    try {
        const VIRTUAL = /(virtual|vmware|vbox|hyper-v|docker|loopback|tap|tunnel|bluetooth|wsl)/i;
        const candidates = [];

        for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
            if (VIRTUAL.test(name)) continue;
            for (const a of addrs || []) {
                if (a.internal) continue;
                const mac = (a.mac || '').toUpperCase();
                if (!mac || mac === '00:00:00:00:00:00') continue;
                candidates.push({ name, mac });
                break;
            }
        }

        if (candidates.length === 0) {
            console.warn('[MAC] No physical adapter found - sending null, server keeps its stored value');
            return null;
        }

        candidates.sort((a, b) => a.name.localeCompare(b.name));
        return candidates[0].mac;
    } catch (err) {
        // Never let identity collection break the heartbeat.
        console.error('[MAC] Lookup failed:', err.message);
        return null;
    }
});

ipcMain.handle('get-machine-uuid', async () => {
    return new Promise((resolve) => {
        exec('wmic csproduct get uuid', (err, stdout) => {
            const fallback = 'WIN-' + (process.env.COMPUTERNAME || Math.random().toString(36).substr(2, 6).toUpperCase());
            if (err) {
                resolve(fallback);
                return;
            }
            const lines = stdout.split('\n').map(line => line.trim()).filter(line => line.length > 0);
            // Note: WMIC output is typically 'UUID' on first line, followed by the uuid value
            if (lines.length >= 2 && lines[1] !== 'Value' && lines[1] !== '' && !lines[1].includes('UUID')) {
                const uuid = lines[1].toUpperCase();
                const genericUuids = [
                    '03000200-0400-0500-0006-000700080009',
                    '00020003-0004-0005-0006-000700080009',
                    '00000000-0000-0000-0000-000000000000',
                    'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF',
                    '11111111-1111-1111-1111-111111111111'
                ];
                if (genericUuids.includes(uuid)) {
                    resolve(fallback);
                } else {
                    // Resolve the uppercased value, not the raw line: the guard above compares `uuid`
                    // (uppercased) but resolving `lines[1]` let the same machine register under two casings.
                    resolve(uuid);
                }
            } else {
                resolve(fallback);
            }
        });
    });
});

ipcMain.handle('read-changelog', async () => {
    // Try to find changelog in common locations
    const possiblePaths = [
        path.join(app.getAppPath(), 'CHANGELOG.md'),
        path.join(process.resourcesPath, 'CHANGELOG.md'),
        path.join(__dirname, 'CHANGELOG.md'),
        path.join(__dirname, '..', '..', 'docs', 'CHANGELOG.md')
    ];

    for (const p of possiblePaths) {
        try {
            if (await fs.pathExists(p)) {
                return await fs.readFile(p, 'utf8');
            }
        } catch (e) {
            console.error(`Failed to read changelog at ${p}:`, e);
        }
    }
    return "Changelog not found. (System path: " + app.getAppPath() + ")";
});

// Real disk numbers (F40): the previous implementation returned constants.
async function getStorageInfo() {
    try {
        await fs.ensureDir(MEDIA_DIR);
        const st = await fsp.statfs(MEDIA_DIR);
        const total = Number(st.blocks) * Number(st.bsize);
        const free = Number(st.bavail) * Number(st.bsize);
        const used = Math.max(0, total - free);
        const gb = (n) => (n / (1024 * 1024 * 1024)).toFixed(1);
        return { used: gb(used), total: gb(total), percent: total > 0 ? Math.round((used / total) * 100) : 0, usedBytes: used, totalBytes: total, freeBytes: free };
    } catch (err) {
        console.warn('[STORAGE] statfs unavailable:', err.message);
        return { used: 'n/a', total: 'n/a', percent: 0, error: err.message };
    }
}

ipcMain.handle('get-storage-info', async () => getStorageInfo());

ipcMain.handle('clear-cache', async () => {
    try {
        await fs.emptyDir(MEDIA_DIR);
        verifiedFiles.clear();
        return { success: true };
    } catch (err) {
        console.error('Clear cache failed', err);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('delete-cached-file', async (event, arg) => {
    try {
        const name = (arg && typeof arg === 'object') ? arg.cacheName : arg;
        const isFallback = !!(arg && typeof arg === 'object' && arg.isFallback);
        if (isFallback) return { success: false, error: 'Fallback media is never deleted automatically' };
        const filePath = resolveInside(MEDIA_DIR, name, false);
        if (await fs.pathExists(filePath)) {
            await fs.remove(filePath);
            console.log(`Deleted cached file: ${name} (was corrupted)`);
        }
        return { success: true };
    } catch (err) {
        console.error('Delete cached file failed:', err.message);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('capture-screen', async () => {
    try {
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: 960, height: 540 }
        });
        if (sources.length > 0) {
            const primarySource = sources[0];
            const base64Data = primarySource.thumbnail.toJPEG(70).toString('base64');
            return { success: true, base64: base64Data };
        }
        return { success: false, error: 'No screens found' };
    } catch (err) {
        console.error('Screen capture failed:', err);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('get-fallback-media', async () => {
    try {
        await fs.ensureDir(FALLBACK_DIR);

        const files = await fs.readdir(FALLBACK_DIR);
        const mediaFiles = files.filter(f => f.match(/\.(mp4|webm|mov|jpg|jpeg|png|gif)$/i) && isSafeName(f, false));

        return mediaFiles.map((file, idx) => ({
            playlistItemId: `FALLBACK-${idx}`,
            mediaId: `FALLBACK-MEDIA-${idx}`,
            positionOrder: idx + 1,
            durationOverride: 10,
            media: {
                mediaId: `FALLBACK-MEDIA-${idx}`,
                fileName: file,
                cacheName: file,
                isFallback: true,
                blobUrl: '',
                fileHash: '',
                displayName: `Fallback: ${file}`,
                durationSec: 10
            }
        }));
    } catch (err) {
        console.error('Error getting fallback media:', err);
        return [];
    }
});

// Returns a file:// URL for a cache entry after validating the name and its location (F05).
ipcMain.handle('resolve-media-url', async (event, arg) => {
    const name = (arg && typeof arg === 'object') ? arg.cacheName : arg;
    const isFallback = !!(arg && typeof arg === 'object' && arg.isFallback);
    const filePath = resolveInside(mediaDirFor(isFallback), name, !isFallback);
    return pathToFileURL(filePath).href;
});

function verifyFileHash(filePath, expectedHash) {
    return new Promise((resolve) => {
        if (!expectedHash) {
            resolve(true); // If no hash provided, assume ok
            return;
        }
        const hash = crypto.createHash('md5');
        const stream = fs.createReadStream(filePath);
        stream.on('data', (data) => hash.update(data));
        stream.on('end', () => {
            const fileHash = hash.digest('hex');
            resolve(fileHash.toLowerCase() === expectedHash.toLowerCase());
        });
        stream.on('error', () => resolve(false));
    });
}

ipcMain.handle('check-media-exists', async (event, arg) => {
    try {
        let name, fileHash, isFallback = false;
        if (typeof arg === 'object' && arg !== null) {
            name = arg.cacheName || arg.filename;
            fileHash = arg.fileHash;
            isFallback = !!arg.isFallback;
        } else {
            name = arg;
        }
        const filePath = resolveInside(mediaDirFor(isFallback), name, false);
        if (await fs.pathExists(filePath)) {
            const stats = await fs.stat(filePath);
            if (stats.size > 0) {
                if (fileHash) {
                    const cacheKey = `${name}_${fileHash}`;
                    if (verifiedFiles.has(cacheKey)) {
                        return true;
                    }
                    const isValid = await verifyFileHash(filePath, fileHash);
                    if (isValid) {
                        rememberVerified(cacheKey);
                    }
                    return isValid;
                }
                return true;
            }
        }
    } catch (e) {
        // Falls through as "cache not valid", which triggers a re-download. Worth saying so:
        // a systematic failure here re-downloads media across the whole fleet.
        console.warn(`[CACHE] Validation failed, treating as invalid (will re-download): ${e.message}`);
    }
    return false;
});

ipcMain.handle('download-media', async (event, args) => {
    if (!args || typeof args !== 'object') return { success: false, error: 'Invalid arguments' };
    const { url, fileHash, legacyFilename } = args;
    const cacheName = args.cacheName || args.filename; // `filename` kept for older callers
    let filePath;
    try {
        filePath = resolveInside(MEDIA_DIR, cacheName, true);
    } catch (e) {
        return { success: false, error: e.message };
    }
    const tempPath = filePath + '.tmp';
    const cacheKey = `${cacheName}_${fileHash || ''}`;

    // Check if fully completed file exists and is valid
    if (await fs.pathExists(filePath)) {
        if (verifiedFiles.has(cacheKey)) {
            return { success: true, path: filePath, cached: true };
        }
        try {
            const stats = await fs.stat(filePath);
            if (stats.size > 0) {
                const isValid = await verifyFileHash(filePath, fileHash);
                if (isValid) {
                    rememberVerified(cacheKey);
                    return { success: true, path: filePath, cached: true };
                } else {
                    console.warn(`File ${cacheName} exists but is corrupted (hash mismatch). Deleting and re-downloading.`);
                    await fs.remove(filePath).catch(() => { });
                }
            } else {
                console.warn(`File ${cacheName} exists but is 0 bytes. Re-downloading.`);
                await fs.remove(filePath).catch(() => { });
            }
        } catch (e) {
            console.warn(`[CACHE] Could not inspect cached file, will re-download: ${e.message}`);
        }
    }

    // Legacy migration: older clients cached by the logical file name. If that file is present
    // and its hash matches, adopt it under the new name instead of re-downloading it fleet-wide.
    // Codex round-4 #10: adoption REQUIRES a usable expected hash that verifies. Without a hash
    // (verifyFileHash would return true for "nothing to check") a stale or name-collided file
    // would be renamed and trusted for good, so in that case the stored file is downloaded.
    if (legacyFilename && legacyFilename !== cacheName && isSafeName(legacyFilename, false)) {
        try {
            const legacyPath = resolveInside(MEDIA_DIR, legacyFilename, false);
            if (await fs.pathExists(legacyPath)) {
                const expected = typeof fileHash === 'string' && /^[0-9a-f]{32}$/i.test(fileHash.trim()) ? fileHash.trim() : null;
                if (!expected) {
                    console.log(`[CACHE] Legacy cache file '${legacyFilename}' not adopted: the server sent no usable fileHash; downloading '${cacheName}' instead`);
                } else {
                    const st = await fs.stat(legacyPath);
                    if (st.size > 0 && await verifyFileHash(legacyPath, expected)) {
                        await fsp.rename(legacyPath, filePath);
                        rememberVerified(cacheKey);
                        console.log(`[CACHE] Migrated legacy cache file '${legacyFilename}' -> '${cacheName}' without re-downloading (hash verified)`);
                        return { success: true, path: filePath, cached: true, migrated: true };
                    }
                    console.log(`[CACHE] Legacy cache file '${legacyFilename}' did not match the expected hash; downloading '${cacheName}'`);
                }
            }
        } catch (e) {
            console.warn(`[CACHE] Legacy migration skipped for ${legacyFilename}: ${e.message}`);
        }
    }

    try {
        let startBytes = 0;
        if (await fs.pathExists(tempPath)) {
            const tempStats = await fs.stat(tempPath);
            startBytes = tempStats.size;
        }

        const headers = {};
        if (startBytes > 0) {
            headers['Range'] = `bytes=${startBytes}-`;
        }

        const dlOptions = { allowClockSkewBypass: true };
        let response;
        try {
            response = await httpGetStream(url, headers, 300000, dlOptions);
        } catch (e) {
            // Fallback: If range request fails, reset and download from 0
            if (startBytes > 0) {
                console.warn(`Range download failed. Resetting download for ${cacheName}.`);
                await fs.remove(tempPath).catch(() => {});
                response = await httpGetStream(url, {}, 300000, dlOptions);
                startBytes = 0;
            } else {
                throw e;
            }
        }

        // If status is 416 (Range Not Satisfiable), delete temp file and start over
        if (response.status === 416) {
            console.warn(`Range unsatisfied (416). Resetting download for ${cacheName}.`);
            await fs.remove(tempPath).catch(() => {});
            response = await httpGetStream(url, {}, 300000, dlOptions);
            startBytes = 0;
        }

        if (response.status >= 400) {
            response.stream.resume();
            return { success: false, error: `Server status ${response.status}` };
        }

        const isRange = response.status === 206;
        const writerFlags = isRange ? 'a' : 'w';

        if (!isRange && startBytes > 0) {
            // Server doesn't support ranges, delete partial file
            await fs.remove(tempPath).catch(() => {});
        }

        const writer = fs.createWriteStream(tempPath, { flags: writerFlags });
        response.stream.pipe(writer);

        return new Promise((resolve) => {
            writer.on('finish', async () => {
                try {
                    const isValid = await verifyFileHash(tempPath, fileHash);
                    if (isValid) {
                        await fs.rename(tempPath, filePath);
                        rememberVerified(cacheKey);
                        smokeReport.mediaDownloaded++;
                        resolve({ success: true, path: filePath });
                    } else {
                        writer.close();
                        await fs.remove(tempPath).catch(() => { });
                        resolve({ success: false, error: 'Downloaded file is corrupted (MD5 hash mismatch).' });
                    }
                } catch (e) {
                    resolve({ success: false, error: e.message });
                }
            });
            writer.on('error', async (err) => {
                writer.close();
                // Do NOT delete tempPath on network errors so we can resume
                resolve({ success: false, error: err.message });
            });

            response.stream.on('error', async (err) => {
                writer.close();
                // Do NOT delete tempPath on stream errors so we can resume
                resolve({ success: false, error: 'Download stream broken: ' + err.message });
            });
        });
    } catch (err) {
        console.error('Download failed', err);
        return { success: false, error: err.message };
    }
});

// Deletes cache files that no playlist references any more (F31). `keep` is the list of cache
// names still in use; everything else older than 7 days goes, leftover .tmp parts after 1 day.
ipcMain.handle('prune-cache', async (event, arg) => {
    const keep = new Set(Array.isArray(arg && arg.keep) ? arg.keep.filter(n => typeof n === 'string') : []);
    const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
    const TMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
    let deleted = 0;
    let reclaimedBytes = 0;
    const removed = [];
    try {
        await fs.ensureDir(MEDIA_DIR);
        const names = await fs.readdir(MEDIA_DIR);
        const now = Date.now();
        for (const name of names) {
            if (keep.has(name)) continue;
            let filePath;
            try {
                filePath = resolveInside(MEDIA_DIR, name, false);
            } catch (e) {
                continue;
            }
            try {
                const st = await fs.stat(filePath);
                if (!st.isFile()) continue;
                const isTmp = name.endsWith('.tmp');
                if (isTmp && keep.has(name.slice(0, -4))) continue; // a resumable part of a wanted file
                const age = now - st.mtimeMs;
                if (age < (isTmp ? TMP_MAX_AGE_MS : MAX_AGE_MS)) continue;
                await fs.remove(filePath);
                deleted++;
                reclaimedBytes += st.size;
                removed.push(name);
            } catch (e) {
                console.warn(`[PRUNE] Could not remove ${name}: ${e.message}`);
            }
        }
        if (deleted > 0) console.log(`[PRUNE] Removed ${deleted} unreferenced cache file(s), ${(reclaimedBytes / 1048576).toFixed(1)} MB: ${removed.slice(0, 10).join(', ')}${removed.length > 10 ? ', ...' : ''}`);
        return { success: true, deleted, reclaimedBytes, removed };
    } catch (err) {
        return { success: false, error: err.message, deleted, reclaimedBytes };
    }
});

// Installer download (F03 / contract 7): TLS always validated, SHA-256 verified when the server
// published one. The clock-skew bypass never applies here.
ipcMain.handle('download-update', async (event, args) => {
    const url = args && args.url;
    const expectedSha = args && typeof args.sha256 === 'string' && args.sha256.trim() ? args.sha256.trim().toLowerCase() : null;
    // Contract T13: installer bytes only ever travel over TLS. config.allowInsecureUpdates = true
    // is the documented UNSAFE escape hatch for an isolated test network.
    const allowInsecure = !!(lastKnownConfig && lastKnownConfig.allowInsecureUpdates === true);
    const rule = checkUpdateUrl(url, allowInsecure);
    if (!rule.ok) {
        console.error(`[UPDATE] Refusing installer download: ${rule.reason}`);
        return { success: false, error: `${rule.code}: ${rule.reason}`, code: rule.code };
    }
    if (rule.insecure) console.warn(`[UPDATE] WARN: ${rule.reason}`);
    const tempDir = app.getPath('temp');
    // Use unique name to avoid file lock conflicts if multiple downloads are triggered
    const filePath = path.join(tempDir, `SignageUnicornSetup_${Date.now()}.exe`);

    // Hard total-time timeout (10 minutes) — prevents IPC from hanging forever
    const HARD_TIMEOUT_MS = 10 * 60 * 1000;

    try {
        // updatePolicy: a redirect to a non-TLS target is refused on the hop, not followed.
        const response = await httpGetStream(url, {}, HARD_TIMEOUT_MS, { allowClockSkewBypass: false, updatePolicy: { allowInsecure } });
        if (response.status !== 200) {
            response.stream.resume();
            return { success: false, error: `Server status ${response.status}` };
        }

        const hash = crypto.createHash('sha256');
        response.stream.on('data', (chunk) => hash.update(chunk));
        const writer = fs.createWriteStream(filePath);
        response.stream.pipe(writer);

        const downloadPromise = new Promise((resolve) => {
            writer.on('finish', async () => {
                const actualSha = hash.digest('hex');
                if (expectedSha && actualSha !== expectedSha) {
                    await fs.remove(filePath).catch(() => { });
                    console.error(`[UPDATE] SHA-256 mismatch for ${url}: expected ${expectedSha}, got ${actualSha}. Installer deleted.`);
                    resolve({ success: false, error: 'SHA256_MISMATCH: installer does not match the hash published by the server', sha256: actualSha });
                    return;
                }
                if (!expectedSha) console.warn('[UPDATE] WARN: unverified installer (server has no ClientDownloadSha256)');
                resolve({ success: true, path: filePath, sha256: actualSha, verified: !!expectedSha });
            });
            writer.on('error', async (err) => {
                writer.close();
                await fs.remove(filePath).catch(() => { });
                resolve({ success: false, error: 'Write error: ' + err.message });
            });
            response.stream.on('error', async (err) => {
                writer.close();
                await fs.remove(filePath).catch(() => { });
                resolve({ success: false, error: 'Download stream broken: ' + err.message });
            });
        });

        const timeoutPromise = new Promise((resolve) =>
            setTimeout(() => {
                writer.close();
                response.stream.destroy();
                resolve({ success: false, error: 'Download timed out after 10 minutes.' });
            }, HARD_TIMEOUT_MS)
        );

        return await Promise.race([downloadPromise, timeoutPromise]);
    } catch (err) {
        if (err && (err.code === 'INSECURE_UPDATE_URL' || err.code === 'TOO_MANY_REDIRECTS' || err.code === 'INVALID_UPDATE_URL')) {
            if (SMOKE && err.code === 'INSECURE_UPDATE_URL') smokeReport.updateRefusedInsecure = true;
            return { success: false, error: `${err.code}: ${err.message}`, code: err.code };
        }
        return { success: false, error: 'Request failed: ' + err.message };
    }
});

// Update metadata (contract T13, round 3 / Codex #5): the three settings that name the installer
// are fetched HERE, through the same TLS-validated client with the per-hop policy, because the
// renderer's fetch() follows redirects opaquely and cannot see a https->http hop.
function mainDeviceHeaders() {
    const h = { 'Accept': 'application/json', 'X-Client-Protocol': '2' };
    if (lastKnownConfig && lastKnownConfig.deviceToken) h['X-Device-Token'] = String(lastKnownConfig.deviceToken);
    return h;
}

function readStreamJson(stream, capBytes) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        stream.on('data', (c) => {
            size += c.length;
            if (size > capBytes) {
                stream.destroy(new Error('response too large'));
                return;
            }
            chunks.push(c);
        });
        stream.on('error', reject);
        stream.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { resolve(null); }
        });
    });
}

ipcMain.handle('fetch-update-metadata', async () => {
    const serverIp = lastKnownConfig && lastKnownConfig.serverIp ? String(lastKnownConfig.serverIp).replace(/\/$/, '') : null;
    if (!serverIp) return { success: false, code: 'NO_SERVER', error: 'no server configured' };
    const allowInsecure = !!(lastKnownConfig && lastKnownConfig.allowInsecureUpdates === true);
    const rule = checkUpdateUrl(serverIp, allowInsecure);
    if (!rule.ok) {
        if (SMOKE && rule.code === 'INSECURE_UPDATE_URL') smokeReport.updateRefusedInsecure = true;
        return { success: false, code: rule.code, error: `${rule.code}: settings server ${rule.reason}` };
    }
    const out = {};
    for (const key of ['ClientDownloadUrl', 'ClientDownloadSha256', 'LatestClientVersion']) {
        try {
            const res = await httpGetStream(`${serverIp}/api/v1/system/settings/${key}`, mainDeviceHeaders(), 15000, { updatePolicy: { allowInsecure } });
            const body = await readStreamJson(res.stream, 64 * 1024);
            out[key] = (res.status === 200 && body && body.data !== null && body.data !== undefined) ? String(body.data).trim() : null;
        } catch (e) {
            if (e && (e.code === 'INSECURE_UPDATE_URL' || e.code === 'TOO_MANY_REDIRECTS' || e.code === 'INVALID_UPDATE_URL')) {
                if (SMOKE && e.code === 'INSECURE_UPDATE_URL') smokeReport.updateRefusedInsecure = true;
                return { success: false, code: e.code, error: `${e.code}: ${e.message}` };
            }
            console.warn(`[UPDATE] Could not read setting ${key}: ${e.message}`);
            out[key] = null;
        }
    }
    return { success: true, url: out.ClientDownloadUrl || null, sha256: out.ClientDownloadSha256 || null, version: out.LatestClientVersion || null };
});

ipcMain.handle('launch-installer', async (event, filePath, meta) => {
    if (SMOKE) {
        // The smoke test must never start a real installer; it only records that it was asked to.
        smokeReport.installerLaunched = true;
        console.warn('[SMOKE] launch-installer suppressed');
        return { success: true, smoke: true };
    }
    try {
        const tempDir = path.resolve(app.getPath('temp'));
        const resolved = typeof filePath === 'string' ? path.resolve(filePath) : '';
        if (!resolved || !resolved.startsWith(tempDir + path.sep) || path.extname(resolved).toLowerCase() !== '.exe') {
            return { success: false, error: 'Refusing to launch an installer outside the download directory' };
        }
        console.log('Launching Silent Installer:', resolved);

        if (!await fs.pathExists(resolved)) {
            console.error('Installer file not found at path:', resolved);
            return { success: false, error: 'Installer file not found at ' + resolved };
        }

        await writeUpdateLock(meta && meta.version ? String(meta.version) : null, resolved);

        const batPath = path.join(app.getPath('temp'), `update_launcher_${Date.now()}.bat`);
        const appExePath = process.execPath;
        // Default install location for NSIS oneClick (perUser)
        const defaultInstallExe = path.join(
            process.env.LOCALAPPDATA || 'C:\\Users\\Default\\AppData\\Local',
            'Programs', 'Signage Unicorn', 'Signage Unicorn.exe'
        );

        const batContent = `@echo off
echo Waiting for app to close...
ping -n 6 127.0.0.1 >nul
echo Running Installer: "${resolved}"
start /wait "" "${resolved}" /S
if %ERRORLEVEL% NEQ 0 (
    echo Installer failed with code %ERRORLEVEL%. Restarting old version...
    del "${UPDATE_LOCK_PATH}" >nul 2>&1
    start "" "${appExePath}"
    ping -n 6 127.0.0.1 >nul
    exit /b %ERRORLEVEL%
)
echo Installer finished. Starting app again...
ping -n 6 127.0.0.1 >nul
if exist "${defaultInstallExe}" (
    start "" "${defaultInstallExe}"
) else (
    start "" "${appExePath}"
)
del "%~f0"
`;

        await fs.writeFile(batPath, batContent, 'utf8');

        const child = spawn('cmd.exe', ['/c', batPath], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
            shell: false
        });

        if (!child) {
            throw new Error("Failed to spawn update process.");
        }

        child.unref();

        // Delay exit slightly to ensure spawn command is registered by OS
        setTimeout(() => {
            app.isQuitting = true;
            app.quit();
        }, 1000);

        return { success: true };
    } catch (err) {
        console.error('Launch installer failed:', err);
        await fs.remove(UPDATE_LOCK_PATH).catch(() => { });
        return { success: false, error: err.message };
    }
});

ipcMain.handle('toggle-fullscreen', () => {
    const isFS = mainWindow.isFullScreen();
    mainWindow.setFullScreen(!isFS);
    // Explicitly set kiosk if needed, but fullscreen toggle is usually enough
    if (!isFS) mainWindow.setKiosk(false);
    return !isFS;
});

ipcMain.handle('reboot-device', async () => {
    try {
        exec('shutdown /r /t 0', (err) => {
            if (err) console.error('Reboot command failed', err);
        });
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// --- SQLite IPC Handlers ---
ipcMain.handle('db-insert-playback-log', (event, log) => {
    try {
        const eventId = (log && typeof log.eventId === 'string' && log.eventId) ? log.eventId : crypto.randomUUID();
        const stmt = db.prepare(`
            INSERT INTO playback_logs (deviceId, mediaId, playlistId, duration, result, errorMessage, playedAt, eventId)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(log.deviceId, log.mediaId, log.playlistId, log.duration, log.result, log.errorMessage, log.playedAt, eventId);
        enforcePlaybackLogCap();
        return { success: true, eventId };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('db-get-pending-logs', (event, limit = 50) => {
    try {
        return db.prepare('SELECT * FROM playback_logs WHERE isSynced = 0 ORDER BY id ASC LIMIT ?').all(limit);
    } catch (err) {
        console.error('DB Get Pending Failed:', err);
        return [];
    }
});

ipcMain.handle('db-mark-logs-synced', (event, ids) => {
    try {
        if (!ids || ids.length === 0) return { success: true };
        const stmt = db.prepare(`UPDATE playback_logs SET isSynced = 1 WHERE id = ?`);
        const updateMany = db.transaction((rows) => {
            for (const id of rows) stmt.run(id);
        });
        updateMany(ids);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// Rejected events are kept (isSynced = 2) so they stop being re-sent but remain inspectable
// until the cap prunes them.
ipcMain.handle('db-mark-logs-rejected', (event, eventIds) => {
    try {
        if (!eventIds || eventIds.length === 0) return { success: true };
        const stmt = db.prepare(`UPDATE playback_logs SET isSynced = 2 WHERE eventId = ?`);
        db.transaction((rows) => {
            for (const id of rows) stmt.run(id);
        })(eventIds);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('db-delete-logs-by-event-ids', (event, eventIds) => {
    try {
        if (!eventIds || eventIds.length === 0) return { success: true, deleted: 0 };
        const stmt = db.prepare('DELETE FROM playback_logs WHERE eventId = ?');
        let deleted = 0;
        db.transaction((rows) => {
            for (const id of rows) deleted += stmt.run(id).changes;
        })(eventIds);
        return { success: true, deleted };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('db-clear-synced-logs', () => {
    try {
        db.prepare('DELETE FROM playback_logs WHERE isSynced = 1').run();
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('db-save-playlist', (event, { id, data }) => {
    try {
        db.prepare('INSERT OR REPLACE INTO playlist_cache (key, data, updatedAt) VALUES (?, ?, ?)')
            .run(String(id), JSON.stringify(data), new Date().toISOString());
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('db-get-playlist', (event, id) => {
    try {
        const row = db.prepare('SELECT data FROM playlist_cache WHERE key = ?').get(String(id));
        return row ? JSON.parse(row.data) : null;
    } catch (err) {
        return null;
    }
});

// ---------------------------------------------------------------------------------------------
// Local diagnostics portal (F09): loopback only, no wildcard CORS, bounded bodies, redacted
// config, and a per-device token for anything that changes state.
// ---------------------------------------------------------------------------------------------
const DIAG_PORT = 8088;
const DIAG_MAX_BODY = 64 * 1024;

function redactConfig(conf) {
    if (!conf || typeof conf !== 'object') return {};
    return {
        deviceId: conf.deviceId ?? null,
        deviceName: conf.deviceName ?? null,
        branchCode: conf.branchCode ?? null,
        location: conf.location ?? null,
        serverIp: conf.serverIp ?? null,
        lastPlaylistId: conf.lastPlaylistId ?? null,
        hasDeviceToken: !!conf.deviceToken,
    };
}

function diagTokenValid(req) {
    const supplied = req.headers['x-diag-token'];
    if (typeof supplied !== 'string' || !diagToken) return false;
    const a = Buffer.from(supplied);
    const b = Buffer.from(diagToken);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readBodyBounded(req, limit) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > limit) {
                reject(new Error('Request body too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function startDiagnosticServer(config) {
    const bind = (config && typeof config.diagnosticsBind === 'string' && config.diagnosticsBind.trim()) || '127.0.0.1';
    if (bind !== '127.0.0.1' && bind !== 'localhost') {
        console.warn(`[DIAG] diagnosticsBind is '${bind}': the diagnostics portal is reachable from the network. ` +
            'This is UNSAFE on a shared network; prefer the default 127.0.0.1.');
    }

    const server = http.createServer(async (req, res) => {
        // No Access-Control-Allow-Origin header on purpose: browser pages on other origins must not
        // be able to read or drive this portal.
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'no-store');

        const urlParts = (req.url || '/').split('?');
        const pathName = urlParts[0];

        if (pathName === '/api/status') {
            try {
                const conf = await readConfigSafe().catch(() => ({}));
                const cacheFiles = await fs.readdir(MEDIA_DIR).catch(() => []);
                const diskInfo = await getStorageInfo();
                const appVersion = app.getVersion();

                let playLogsCount = 0;
                let playlistCacheCount = 0;
                try {
                    if (db) {
                        playLogsCount = db.prepare('SELECT COUNT(*) as count FROM playback_logs').get().count;
                        playlistCacheCount = db.prepare('SELECT COUNT(*) as count FROM playlist_cache').get().count;
                    }
                } catch (e) {
                    console.error('SQL Diagnostics failed:', e.message);
                }

                let updateLock = null;
                try {
                    if (await fs.pathExists(UPDATE_LOCK_PATH)) updateLock = await fs.readJson(UPDATE_LOCK_PATH);
                } catch (e) { /* ignore */ }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    version: appVersion,
                    config: redactConfig(conf),
                    cacheFileCount: cacheFiles.length,
                    diskInfo: diskInfo,
                    playback: { playing: !!playbackState.playing, updatedAt: playbackState.updatedAt },
                    clock: { skewSeconds: clockSkewSeconds, skewDetected: clockSkewDetected },
                    updateLock,
                    database: {
                        playbackLogsCount: playLogsCount,
                        playlistCacheCount: playlistCacheCount
                    }
                }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: err.message }));
            }
            return;
        }

        if (pathName === '/api/action' && req.method === 'POST') {
            if (!diagTokenValid(req)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Missing or invalid X-Diag-Token (see the F7 dashboard on the player)' }));
                return;
            }
            let body;
            try {
                body = await readBodyBounded(req, DIAG_MAX_BODY);
            } catch (e) {
                res.writeHead(413, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
                return;
            }
            try {
                const data = JSON.parse(body || '{}');
                const { action } = data;

                if (action === 'restart') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, message: 'Restarting player...' }));
                    setTimeout(() => {
                        app.relaunch();
                        app.exit(0);
                    }, 1000);
                    return;
                }

                if (action === 'clear-cache') {
                    await fs.emptyDir(MEDIA_DIR).catch(() => {});
                    verifiedFiles.clear();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, message: 'Cache cleared successfully.' }));
                    return;
                }

                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Unknown action' }));
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: err.message }));
            }
            return;
        }

        if (pathName === '/' || pathName === '/index.html') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(DIAG_PORTAL_HTML);
            return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    });

    server.on('error', (err) => console.error(`[DIAG] Portal failed to start on ${bind}:${DIAG_PORT}: ${err.message}`));
    server.listen(DIAG_PORT, bind, () => {
        console.log(`Local Diagnostic Portal running on http://${bind}:${DIAG_PORT}`);
    });
}

const DIAG_PORTAL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Signage Unicorn | Local Diagnostics Portal</title>
    <style>
        :root { --bg: #0b0f19; --card: #141a28; --border: #273043; --primary: #00c2cc; --danger: #ef4444; --text: #f3f4f6; --muted: #aab2c0; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); padding: 24px; font-size: 15px; }
        header { margin-bottom: 24px; }
        h1 { font-size: 22px; letter-spacing: 1px; }
        header p { color: var(--muted); margin-top: 6px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
        .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 18px; }
        .card-title { font-weight: 700; margin-bottom: 12px; }
        .info-row { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; border-bottom: 1px solid var(--border); }
        .info-label { color: var(--muted); }
        .info-value { font-family: ui-monospace, Consolas, monospace; text-align: right; word-break: break-all; }
        .btn { display: block; width: 100%; padding: 12px; margin-top: 10px; border-radius: 8px; border: 1px solid var(--border); background: #1c2436; color: var(--text); font-size: 15px; font-weight: 600; cursor: pointer; }
        .btn-primary { border-color: var(--primary); }
        .btn-danger { border-color: var(--danger); color: #fca5a5; }
        .footer { margin-top: 24px; color: var(--muted); font-size: 13px; }
        .note { color: var(--muted); font-size: 13px; margin-top: 8px; }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>LOCAL DIAGNOSTICS PORTAL</h1>
            <p>Player: <span id="portal-ip">-</span> &middot; Status: <span id="status-badge">loading</span></p>
        </header>

        <div class="grid">
            <div class="card">
                <div class="card-title">Client Info</div>
                <div class="info-row"><span class="info-label">Version</span><span class="info-value" id="client-version">-</span></div>
                <div class="info-row"><span class="info-label">Device Name</span><span class="info-value" id="device-name">-</span></div>
                <div class="info-row"><span class="info-label">Branch Code</span><span class="info-value" id="branch-code">-</span></div>
                <div class="info-row"><span class="info-label">Device ID</span><span class="info-value" id="device-id">-</span></div>
                <div class="info-row"><span class="info-label">Device token</span><span class="info-value" id="device-token">-</span></div>
                <div class="info-row"><span class="info-label">Clock skew</span><span class="info-value" id="clock-skew">-</span></div>
            </div>

            <div class="card">
                <div class="card-title">Disk &amp; Cache</div>
                <div class="info-row"><span class="info-label">Disk (used / total)</span><span class="info-value" id="disk-storage">-</span></div>
                <div class="info-row"><span class="info-label">Cached files</span><span class="info-value" id="cached-files">-</span></div>
                <div class="info-row"><span class="info-label">Pending playback logs</span><span class="info-value" id="db-logs">-</span></div>
                <div class="info-row"><span class="info-label">Playing</span><span class="info-value" id="playing">-</span></div>
                <div class="info-row"><span class="info-label">Update in progress</span><span class="info-value" id="update-lock">-</span></div>
            </div>

            <div class="card">
                <div class="card-title">Actions</div>
                <button class="btn btn-primary" id="btn-restart">Restart Player App</button>
                <button class="btn btn-danger" id="btn-clear">Clear Cache Files</button>
                <p class="note">Actions require the diagnostics token shown on the player's F7 dashboard.</p>
            </div>
        </div>

        <div class="footer">Signage Unicorn Client Diagnostics Portal</div>
    </div>

    <script>
        document.getElementById('portal-ip').textContent = window.location.host;

        async function fetchStatus() {
            try {
                const res = await fetch('/api/status');
                const data = await res.json();
                if (!data.success) return;
                document.getElementById('status-badge').textContent = 'active';
                document.getElementById('client-version').textContent = 'v' + data.version;
                document.getElementById('device-name').textContent = data.config.deviceName || 'N/A';
                document.getElementById('branch-code').textContent = data.config.branchCode || 'N/A';
                document.getElementById('device-id').textContent = data.config.deviceId || 'N/A';
                document.getElementById('device-token').textContent = data.config.hasDeviceToken ? 'issued' : 'none (legacy)';
                document.getElementById('clock-skew').textContent = (data.clock ? data.clock.skewSeconds : 0) + ' s';
                document.getElementById('disk-storage').textContent = data.diskInfo.used + ' / ' + data.diskInfo.total + ' GB (' + data.diskInfo.percent + '%)';
                document.getElementById('cached-files').textContent = data.cacheFileCount + ' files';
                document.getElementById('db-logs').textContent = data.database.playbackLogsCount + ' rows';
                document.getElementById('playing').textContent = data.playback && data.playback.playing ? 'yes' : 'no';
                document.getElementById('update-lock').textContent = data.updateLock ? ('yes (v' + (data.updateLock.version || '?') + ')') : 'no';
            } catch (e) {
                document.getElementById('status-badge').textContent = 'unreachable';
            }
        }

        function getToken() {
            let t = sessionStorage.getItem('diagToken');
            if (!t) {
                t = window.prompt('Enter the diagnostics token shown on the player (F7 dashboard):') || '';
                if (t) sessionStorage.setItem('diagToken', t.trim());
            }
            return t.trim();
        }

        async function triggerAction(actionName) {
            if (!confirm('Are you sure you want to trigger: ' + actionName + '?')) return;
            const token = getToken();
            if (!token) return;
            try {
                const res = await fetch('/api/action', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Diag-Token': token },
                    body: JSON.stringify({ action: actionName })
                });
                const data = await res.json();
                if (res.status === 401) sessionStorage.removeItem('diagToken');
                alert(data.message || data.error || 'Action executed.');
                fetchStatus();
            } catch (e) {
                alert('Action failed: ' + e.message);
            }
        }

        document.getElementById('btn-restart').addEventListener('click', () => triggerAction('restart'));
        document.getElementById('btn-clear').addEventListener('click', () => triggerAction('clear-cache'));
        fetchStatus();
        setInterval(fetchStatus, 5000);
    </script>
</body>
</html>
`;
