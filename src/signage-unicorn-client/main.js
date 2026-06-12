const { app, BrowserWindow, ipcMain, screen, shell, powerSaveBlocker, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const https = require('https');
const { exec, spawn } = require('child_process');
const Database = require('better-sqlite3');
const crypto = require('crypto');

// Ignore SSL certificate validation errors (helps bypass player client clock skew issues)
app.commandLine.appendSwitch('ignore-certificate-errors');
// Prevent background timer throttling (keeps intervals/heartbeats active when screen is covered or inactive)
app.commandLine.appendSwitch('disable-background-timer-throttling');
// Prevent GPU process from disabling hardware acceleration after multiple crashes
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');

axios.defaults.httpsAgent = new https.Agent({ rejectUnauthorized: false });

let mainWindow;
let sleepBlockerId;
let db;
const verifiedFiles = new Set();

// Enforce single instance lock to prevent duplicate instances consuming CPU/GPU and creating duplicate DB entries
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    console.log('Another instance of Signage Unicorn is already running. Exiting.');
    app.quit();
    process.exit(0);
}

app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    }
});


const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const MEDIA_DIR = path.join(app.getPath('userData'), 'media_cache');
const DB_PATH = path.join(app.getPath('userData'), 'player_offline.db');

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
    } catch (e) { }

    // Deduplicate array
    possibleParents = [...new Set(possibleParents)];

    // 2. Generate candidates
    const folderNames = ['signage-unicorn-client', 'Signage Unicorn', 'signage-unicorn', 'signage-unicorn-client-updater'];
    let candidates = [];
    for (const parent of possibleParents) {
        for (const fName of folderNames) {
            candidates.push(path.join(parent, fName));
        }
    }

    let hasValidConfig = false;
    try {
        if (await fs.pathExists(CONFIG_PATH)) {
            const current = await fs.readJson(CONFIG_PATH);
            if (current && current.deviceId && current.serverIp) hasValidConfig = true;
        }
    } catch (e) { }

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
                    // Check if it's actually valid data
                    if (oldData && oldData.deviceId && parseInt(oldData.deviceId) > 0 && oldData.serverIp) {
                        console.log(`MIGRATION: Valid identity found in [${oldUserData}]. Restoring...`);
                        await fs.ensureDir(path.dirname(CONFIG_PATH));
                        await fs.copy(oldConfig, CONFIG_PATH);

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

async function initDb() {
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

        console.log('SQLite Database Initialized at:', DB_PATH);
    } catch (err) {
        console.error('SQLite Initialization Failed:', err);
    }
}

async function createWindow() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.size;

    mainWindow = new BrowserWindow({
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
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false,
        },
        backgroundColor: '#000000'
    });

    // Remove menu completely
    mainWindow.setMenu(null);
    mainWindow.setMenuBarVisibility(false);

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

    mainWindow.loadFile('index.html');

    // Create media directory
    await fs.ensureDir(MEDIA_DIR);

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

app.whenReady().then(async () => {
    // --- Global Crash Recovery Engine ---
    process.on('uncaughtException', (err) => {
        console.log('FATAL SYSTEM ERROR:', err);
        if (process.uptime() > 10) {
            app.relaunch();
        }
        app.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
        console.error('Unhandled Promisse Rejection:', reason);
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

    await migrateData();
    initDb();
    createWindow();
    startDiagnosticServer();

    // Schedule automatic restart at 4:00 AM daily to prevent memory leaks and ensure freshness
    setInterval(() => {
        const now = new Date();
        if (now.getHours() === 4 && now.getMinutes() < 5) {
            console.log('Daily maintenance: Scheduled relaunch at 4:00 AM.');
            app.relaunch();
            app.exit(0);
        }
    }, 300000); // Check every 5 minutes
});

app.on('status-bar-style', () => {
    // Hide menu bar
    mainWindow.setMenuBarVisibility(false);
});

// --- IPC Handlers for Settings & Management ---
ipcMain.handle('get-config', async () => {
    if (await fs.pathExists(CONFIG_PATH)) {
        return await fs.readJson(CONFIG_PATH);
    }
    return { serverIp: 'https://signage.aith123.com', deviceId: null, deviceName: null, branchCode: '1000' };
});

ipcMain.handle('get-app-version', () => {
    return app.getVersion(); // Reads from package.json "version"
});

ipcMain.handle('get-machine-uuid', async () => {
    return new Promise((resolve) => {
        exec('wmic csproduct get uuid', (err, stdout) => {
            if (err) {
                const fallback = 'WIN-' + (process.env.COMPUTERNAME || Math.random().toString(36).substr(2, 6).toUpperCase());
                resolve(fallback);
                return;
            }
            const lines = stdout.split('\n').map(line => line.trim()).filter(line => line.length > 0);
            // Note: WMIC output is typically 'UUID' on first line, followed by the uuid value
            if (lines.length >= 2 && lines[1] !== 'Value' && lines[1] !== '' && !lines[1].includes('UUID')) {
                resolve(lines[1]);
            } else {
                const fallback = 'WIN-' + (process.env.COMPUTERNAME || Math.random().toString(36).substr(2, 6).toUpperCase());
                resolve(fallback);
            }
        });
    });
});


ipcMain.handle('save-config', async (event, config) => {
    await fs.writeJson(CONFIG_PATH, config);
    return { success: true };
});

ipcMain.handle('get-local-path', () => MEDIA_DIR);

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

ipcMain.handle('get-storage-info', async () => {
    try {
        // Simple mock for now as real disk info needs extra deps or complex logic in node
        // In a real app we might use 'diskusage' lib
        return { used: "42.5 GB", total: "128 GB", percent: 33 };
    } catch (err) {
        return { used: "0 GB", total: "0 GB", percent: 0 };
    }
});

ipcMain.handle('clear-cache', async () => {
    try {
        await fs.emptyDir(MEDIA_DIR);
        return { success: true };
    } catch (err) {
        console.error('Clear cache failed', err);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('delete-cached-file', async (event, filename) => {
    try {
        const filePath = path.join(MEDIA_DIR, filename);
        if (await fs.pathExists(filePath)) {
            await fs.remove(filePath);
            console.log(`Deleted cached file: ${filename} (was corrupted)`);
        }
        return { success: true };
    } catch (err) {
        console.error(`Delete cached file ${filename} failed:`, err);
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

ipcMain.handle('get-fallback-path', () => {
    return path.join(app.getPath('userData'), 'fallback_media');
});

ipcMain.handle('get-fallback-media', async () => {
    try {
        const fallbackDir = path.join(app.getPath('userData'), 'fallback_media');
        await fs.ensureDir(fallbackDir);

        const files = await fs.readdir(fallbackDir);
        const mediaFiles = files.filter(f => f.match(/\.(mp4|webm|mov|jpg|jpeg|png|gif)$/i));

        return mediaFiles.map((file, idx) => ({
            playlistItemId: `FALLBACK-${idx}`,
            mediaId: `FALLBACK-MEDIA-${idx}`,
            positionOrder: idx + 1,
            durationOverride: 10,
            media: {
                mediaId: `FALLBACK-MEDIA-${idx}`,
                fileName: file,
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
        let filename, fileHash;
        if (typeof arg === 'object' && arg !== null) {
            filename = arg.filename;
            fileHash = arg.fileHash;
        } else {
            filename = arg;
        }
        const filePath = path.join(MEDIA_DIR, filename);
        if (await fs.pathExists(filePath)) {
            const stats = await fs.stat(filePath);
            if (stats.size > 0) {
                if (fileHash) {
                    const cacheKey = `${filename}_${fileHash}`;
                    if (verifiedFiles.has(cacheKey)) {
                        return true;
                    }
                    const isValid = await verifyFileHash(filePath, fileHash);
                    if (isValid) {
                        verifiedFiles.add(cacheKey);
                    }
                    return isValid;
                }
                return true;
            }
        }
    } catch (e) { }
    return false;
});

ipcMain.handle('download-media', async (event, { url, filename, fileHash }) => {
    const filePath = path.join(MEDIA_DIR, filename);
    const tempPath = filePath + '.tmp';
    const cacheKey = `${filename}_${fileHash || ''}`;

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
                    verifiedFiles.add(cacheKey);
                    return { success: true, path: filePath, cached: true };
                } else {
                    console.warn(`File ${filename} exists but is corrupted (hash mismatch). Deleting and re-downloading.`);
                    await fs.remove(filePath).catch(() => { });
                }
            } else {
                console.warn(`File ${filename} exists but is 0 bytes. Re-downloading.`);
                await fs.remove(filePath).catch(() => { });
            }
        } catch (e) { }
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

        let response;
        try {
            response = await axios({
                method: 'GET',
                url: url,
                headers: headers,
                responseType: 'stream',
                timeout: 300000,
                validateStatus: (status) => status === 200 || status === 206 || status === 416
            });
        } catch (e) {
            // Fallback: If range request fails, reset and download from 0
            if (startBytes > 0) {
                console.warn(`Range download failed. Resetting download for ${filename}.`);
                await fs.remove(tempPath).catch(() => {});
                response = await axios({
                    method: 'GET',
                    url: url,
                    responseType: 'stream',
                    timeout: 300000
                });
                startBytes = 0;
            } else {
                throw e;
            }
        }

        // If status is 416 (Range Not Satisfiable), delete temp file and start over
        if (response.status === 416) {
            console.warn(`Range unsatisfied (416). Resetting download for ${filename}.`);
            await fs.remove(tempPath).catch(() => {});
            response = await axios({
                method: 'GET',
                url: url,
                responseType: 'stream',
                timeout: 300000
            });
            startBytes = 0;
        }

        const isRange = response.status === 206;
        const writerFlags = isRange ? 'a' : 'w';

        if (!isRange && startBytes > 0) {
            // Server doesn't support ranges, delete partial file
            await fs.remove(tempPath).catch(() => {});
        }

        const writer = fs.createWriteStream(tempPath, { flags: writerFlags });
        response.data.pipe(writer);

        return new Promise((resolve) => {
            writer.on('finish', async () => {
                try {
                    const isValid = await verifyFileHash(tempPath, fileHash);
                    if (isValid) {
                        await fs.rename(tempPath, filePath);
                        verifiedFiles.add(cacheKey);
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

            response.data.on('error', async (err) => {
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

ipcMain.handle('download-update', async (event, { url }) => {
    const tempDir = app.getPath('temp');
    // Use unique name to avoid file lock conflicts if multiple downloads are triggered
    const filePath = path.join(tempDir, `SignageUnicornSetup_${Date.now()}.exe`);

    try {
        const response = await axios({
            method: 'GET',
            url: url,
            responseType: 'stream',
            timeout: 600000 // 10 minutes timeout for slow networks
        });

        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve({ success: true, path: filePath }));
            writer.on('error', async (err) => {
                writer.close();
                await fs.remove(filePath).catch(() => { });
                resolve({ success: false, error: 'Write error: ' + err.message });
            });
            // Handle network/stream errors after connection started
            response.data.on('error', async (err) => {
                writer.close();
                await fs.remove(filePath).catch(() => { });
                resolve({ success: false, error: 'Download stream broken: ' + err.message });
            });
        });
    } catch (err) {
        return { success: false, error: 'Request failed: ' + err.message };
    }
});

ipcMain.handle('launch-installer', async (event, filePath) => {
    try {
        console.log('Launching Silent Installer:', filePath);

        if (!await fs.pathExists(filePath)) {
            console.error('Installer file not found at path:', filePath);
            return { success: false, error: 'Installer file not found at ' + filePath };
        }

        // To ensure the app opens after silent update, we generate a bat file
        const batPath = path.join(app.getPath('temp'), `update_launcher_${Date.now()}.bat`);
        const appExePath = process.execPath;

        // Use a more robust batch content with logging to temp file for debugging if needed
        const batContent = `@echo off
echo Waiting for app to close...
timeout /t 5 /nobreak >nul
echo Running Installer: "${filePath}"
"${filePath}" /S
if %ERRORLEVEL% NEQ 0 (
    echo Installer failed with code %ERRORLEVEL%
    timeout /t 10
    exit /b %ERRORLEVEL%
)
echo Installer finished. Starting app again...
timeout /t 3 /nobreak >nul
start "" "${appExePath}"
del "%~f0"
`;

        await fs.writeFile(batPath, batContent, 'utf8');

        // Execute the batch script detached. 
        // Using shell: true helps resolve paths and cmd.exe on Windows.
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
        const stmt = db.prepare(`
            INSERT INTO playback_logs (deviceId, mediaId, playlistId, duration, result, errorMessage, playedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(log.deviceId, log.mediaId, log.playlistId, log.duration, log.result, log.errorMessage, log.playedAt);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('db-get-pending-logs', (event, limit = 50) => {
    try {
        return db.prepare('SELECT * FROM playback_logs WHERE isSynced = 0 LIMIT ?').all(limit);
    } catch (err) {
        console.error('DB Get Pending Failed:', err);
        return [];
    }
});

ipcMain.handle('db-mark-logs-synced', (event, ids) => {
    try {
        if (!ids || ids.length === 0) return { success: true };
        const stmt = db.prepare(`UPDATE playback_logs SET isSynced = 1 WHERE id = ?`);
        const updateMany = db.transaction((ids) => {
            for (const id of ids) stmt.run(id);
        });
        updateMany(ids);
        return { success: true };
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
            .run(id, JSON.stringify(data), new Date().toISOString());
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('db-get-playlist', (event, id) => {
    try {
        const row = db.prepare('SELECT data FROM playlist_cache WHERE key = ?').get(id);
        return row ? JSON.parse(row.data) : null;
    } catch (err) {
        return null;
    }
});

function startDiagnosticServer() {
    const http = require('http');
    const server = http.createServer(async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        const urlParts = req.url.split('?');
        const pathName = urlParts[0];

        if (pathName === '/api/status') {
            try {
                const conf = await fs.readJson(CONFIG_PATH).catch(() => ({}));
                const cacheFiles = await fs.readdir(MEDIA_DIR).catch(() => []);
                const diskInfo = { used: "42.5 GB", total: "128 GB", percent: 33 };
                const appVersion = app.getVersion();

                let playLogsCount = 0;
                let sysLogsCount = 0;
                try {
                    if (db) {
                        playLogsCount = db.prepare('SELECT COUNT(*) as count FROM playback_logs').get().count;
                        sysLogsCount = db.prepare('SELECT COUNT(*) as count FROM playlist_cache').get().count;
                    }
                } catch (e) {
                    console.error('SQL Diagnostics failed:', e.message);
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    version: appVersion,
                    config: conf,
                    cacheFileCount: cacheFiles.length,
                    diskInfo: diskInfo,
                    database: {
                        playbackLogsCount: playLogsCount,
                        systemLogsCount: sysLogsCount
                    }
                }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: err.message }));
            }
            return;
        }

        if (pathName === '/api/action' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body);
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
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, message: 'Cache cleared successfully.' }));
                        return;
                    }

                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Unknown action' }));
                } catch (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: err.message }));
                }
            });
            return;
        }

        if (pathName === '/' || pathName === '/index.html') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

            const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Signage Unicorn | Local Diagnostics Portal</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-gradient: linear-gradient(135deg, #0b0f19 0%, #111827 100%);
            --card-bg: rgba(255, 255, 255, 0.03);
            --card-border: rgba(255, 255, 255, 0.08);
            --primary: #00f2ff;
            --primary-glow: rgba(0, 242, 255, 0.15);
            --success: #10b981;
            --warning: #f59e0b;
            --danger: #ef4444;
            --text-main: #f3f4f6;
            --text-muted: #9ca3af;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: 'Outfit', sans-serif;
            background: var(--bg-gradient);
            color: var(--text-main);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 40px 20px;
        }

        .container {
            max-width: 900px;
            width: 100%;
        }

        header {
            text-align: center;
            margin-bottom: 40px;
        }

        header h1 {
            font-size: 2.5rem;
            font-weight: 800;
            background: linear-gradient(to right, #00f2ff, #0077ff);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 10px;
        }

        header p {
            color: var(--text-muted);
            font-size: 1.1rem;
        }

        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }

        .card {
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 16px;
            padding: 24px;
            backdrop-filter: blur(12px);
            box-shadow: 0 4px 30px rgba(0, 0, 0, 0.2);
            transition: transform 0.2s, border-color 0.2s;
        }

        .card:hover {
            transform: translateY(-2px);
            border-color: rgba(0, 242, 255, 0.2);
        }

        .card-title {
            font-size: 1.2rem;
            font-weight: 600;
            margin-bottom: 16px;
            color: var(--primary);
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .info-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 12px;
            font-size: 0.95rem;
        }

        .info-label {
            color: var(--text-muted);
        }

        .info-value {
            font-weight: 600;
            word-break: break-all;
            text-align: right;
            max-width: 60%;
        }

        .actions-card {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .btn {
            width: 100%;
            padding: 14px;
            border-radius: 10px;
            border: none;
            font-family: 'Outfit', sans-serif;
            font-weight: 600;
            font-size: 1rem;
            cursor: pointer;
            transition: all 0.2s;
        }

        .btn-primary {
            background: linear-gradient(to right, #00f2ff, #0077ff);
            color: #0b0f19;
            box-shadow: 0 0 15px var(--primary-glow);
        }

        .btn-primary:hover {
            opacity: 0.9;
            transform: scale(1.02);
        }

        .btn-danger {
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid var(--danger);
            color: var(--danger);
        }

        .btn-danger:hover {
            background: var(--danger);
            color: #fff;
            transform: scale(1.02);
        }

        .footer {
            text-align: center;
            margin-top: 50px;
            font-size: 0.85rem;
            color: var(--text-muted);
        }

        .status-badge {
            display: inline-block;
            width: 8px;
            height: 8px;
            background: var(--success);
            border-radius: 50%;
            box-shadow: 0 0 8px var(--success);
        }

        .pulse {
            animation: pulse-animation 2s infinite;
        }

        @keyframes pulse-animation {
            0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); }
            70% { box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); }
            100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>LOCAL DIAGNOSTICS PORTAL</h1>
            <p>Player IP: <span id="portal-ip">Loading...</span> | Status: <span class="status-badge pulse"></span> Active</p>
        </header>

        <div class="grid">
            <!-- Client Info Card -->
            <div class="card">
                <div class="card-title">🖥️ Client Info</div>
                <div class="info-row">
                    <span class="info-label">Version</span>
                    <span class="info-value" id="client-version">-</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Device Name</span>
                    <span class="info-value" id="device-name">-</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Branch Code</span>
                    <span class="info-value" id="branch-code">-</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Device ID</span>
                    <span class="info-value" id="device-id">-</span>
                </div>
            </div>

            <!-- Performance Card -->
            <div class="card">
                <div class="card-title">📊 Disk & Cache</div>
                <div class="info-row">
                    <span class="info-label">Disk Storage</span>
                    <span class="info-value" id="disk-storage">-</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Cached Files</span>
                    <span class="info-value" id="cached-files">-</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Cached Playlists</span>
                    <span class="info-value" id="db-logs">-</span>
                </div>
            </div>

            <!-- Diagnostics Actions -->
            <div class="card actions-card">
                <div class="card-title">⚡ Remote Actions</div>
                <button class="btn btn-primary" onclick="triggerAction('restart')">Restart Player App</button>
                <button class="btn btn-danger" onclick="triggerAction('clear-cache')">Clear Cache Files</button>
            </div>
        </div>

        <div class="footer">
            Signage Unicorn Client Diagnostics Portal v2.6.0
        </div>
    </div>

    <script>
        document.getElementById('portal-ip').innerText = window.location.host;

        async function fetchStatus() {
            try {
                const res = await fetch('/api/status');
                const data = await res.json();
                if (data.success) {
                    document.getElementById('client-version').innerText = 'v' + data.version;
                    document.getElementById('device-name').innerText = data.config.deviceName || 'N/A';
                    document.getElementById('branch-code').innerText = data.config.branchCode || 'N/A';
                    document.getElementById('device-id').innerText = data.config.deviceId || 'N/A';
                    document.getElementById('disk-storage').innerText = data.diskInfo.used + ' / ' + data.diskInfo.total + ' (' + data.diskInfo.percent + '%)';
                    document.getElementById('cached-files').innerText = data.cacheFileCount + ' files';
                    document.getElementById('db-logs').innerText = (data.database.playbackLogsCount + data.database.systemLogsCount) + ' logs';
                }
            } catch (e) {
                console.error('Fetch status failed:', e);
            }
        }

        async function triggerAction(actionName) {
            if (!confirm('Are you sure you want to trigger: ' + actionName + '?')) return;
            try {
                const res = await fetch('/api/action', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: actionName })
                });
                const data = await res.json();
                alert(data.message || 'Action executed.');
                fetchStatus();
            } catch (e) {
                alert('Action failed: ' + e.message);
            }
        }

        fetchStatus();
        setInterval(fetchStatus, 5000);
    </script>
</body>
</html>
`;
            res.end(htmlContent);
            return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    });

    server.listen(8088, () => {
        console.log('Local Diagnostic Portal running on http://localhost:8088');
    });
}
