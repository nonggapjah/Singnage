const { app, BrowserWindow, ipcMain, screen, shell, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const { exec } = require('child_process');
const Database = require('better-sqlite3');

let mainWindow;
let sleepBlockerId;
let db;

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const MEDIA_DIR = path.join(app.getPath('userData'), 'media_cache');
const DB_PATH = path.join(app.getPath('userData'), 'player_offline.db');

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

        console.log('SQLite Database Initialized at:', DB_PATH);
    } catch (err) {
        console.error('SQLite Initialization Failed:', err);
    }
}

async function createWindow() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    mainWindow = new BrowserWindow({
        width,
        height,
        fullscreen: true,
        kiosk: true,
        frame: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false,
        },
        backgroundColor: '#000000'
    });

    mainWindow.loadFile('index.html');

    // Create media directory
    await fs.ensureDir(MEDIA_DIR);

    // Prevent Sleep
    sleepBlockerId = powerSaveBlocker.start('prevent-display-sleep');
    console.log('Power save blocker started:', sleepBlockerId);
}

app.whenReady().then(() => {
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

ipcMain.handle('download-media', async (event, { url, filename }) => {
    const filePath = path.join(MEDIA_DIR, filename);

    // Check if exists
    if (await fs.pathExists(filePath)) {
        return { success: true, path: filePath, cached: true };
    }

    try {
        const response = await axios({
            method: 'GET',
            url: url,
            responseType: 'stream'
        });

        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve({ success: true, path: filePath }));
            writer.on('error', reject);
        });
    } catch (err) {
        console.error('Download failed', err);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('download-update', async (event, { url }) => {
    const tempDir = app.getPath('temp');
    const filePath = path.join(tempDir, 'SignageUnicornSetup.exe');

    try {
        const response = await axios({
            method: 'GET',
            url: url,
            responseType: 'stream'
        });

        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve({ success: true, path: filePath }));
            writer.on('error', (err) => resolve({ success: false, error: err.message }));
        });
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('launch-installer', async (event, filePath) => {
    try {
        await shell.openPath(filePath);
        app.quit(); // Close app so installer can run
        return { success: true };
    } catch (err) {
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
