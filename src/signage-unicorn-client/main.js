const { app, BrowserWindow, ipcMain, screen, shell, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const { exec, spawn } = require('child_process');
const Database = require('better-sqlite3');

let mainWindow;
let sleepBlockerId;
let db;

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
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false,
        },
        backgroundColor: '#000000'
    });

    // Force top-most level even above system dialogs and taskbars
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.setKiosk(true);

    mainWindow.loadFile('index.html');

    // Create media directory
    await fs.ensureDir(MEDIA_DIR);

    // Prevent Sleep & Force Disable Windows Screensaver via Registry
    sleepBlockerId = powerSaveBlocker.start('prevent-display-sleep');
    try {
        exec('reg add "HKEY_CURRENT_USER\\Control Panel\\Desktop" /v ScreenSaveActive /t REG_SZ /d 0 /f');
        // Force Auto-Start on Boot
        exec(`reg add "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "SignageUnicorn" /d "\\"${process.execPath}\\"" /f`);

        console.log('Windows Screensaver disabled. Auto-Start registered.');
    } catch (e) { }
    console.log('Power save blocker started:', sleepBlockerId);
}

app.whenReady().then(async () => {
    // --- Global Crash Recovery Engine ---
    process.on('uncaughtException', (err) => {
        console.error('FATAL SYSTEM ERROR:', err);
        app.relaunch();
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

ipcMain.handle('check-media-exists', async (event, filename) => {
    try {
        const filePath = path.join(MEDIA_DIR, filename);
        if (await fs.pathExists(filePath)) {
            const stats = await fs.stat(filePath);
            return stats.size > 0;
        }
    } catch (e) { }
    return false;
});

ipcMain.handle('download-media', async (event, { url, filename }) => {
    const filePath = path.join(MEDIA_DIR, filename);
    const tempPath = filePath + '.tmp';

    // Check if exists
    if (await fs.pathExists(filePath)) {
        try {
            const stats = await fs.stat(filePath);
            if (stats.size > 0) {
                return { success: true, path: filePath, cached: true };
            } else {
                console.warn(`File ${filename} exists but is 0 bytes. Re-downloading.`);
                await fs.remove(filePath).catch(() => { });
            }
        } catch (e) { }
    }

    try {
        // Clean up any stalled temp file
        if (await fs.pathExists(tempPath)) {
            await fs.remove(tempPath).catch(() => { });
        }

        const response = await axios({
            method: 'GET',
            url: url,
            responseType: 'stream',
            timeout: 300000
        });

        // Write to temp file
        const writer = fs.createWriteStream(tempPath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', async () => {
                try {
                    await fs.rename(tempPath, filePath);
                    resolve({ success: true, path: filePath });
                } catch (e) {
                    reject(e);
                }
            });
            writer.on('error', async (err) => {
                writer.close(); // Ensure writer is closed
                await fs.remove(tempPath).catch(() => { });
                reject(err);
            });

            // Handle network/stream errors after connection started
            response.data.on('error', async (err) => {
                writer.close();
                await fs.remove(tempPath).catch(() => { });
                reject(new Error('Download stream broken: ' + err.message));
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
