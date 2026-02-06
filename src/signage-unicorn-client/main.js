const { app, BrowserWindow, ipcMain, screen, shell, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const { exec } = require('child_process');

let mainWindow;
let sleepBlockerId;
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const MEDIA_DIR = path.join(app.getPath('userData'), 'media_cache');

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

app.whenReady().then(createWindow);

app.on('status-bar-style', () => {
    // Hide menu bar
    mainWindow.setMenuBarVisibility(false);
});

// --- IPC Handlers for Settings & Management ---
ipcMain.handle('get-config', async () => {
    if (await fs.pathExists(CONFIG_PATH)) {
        return await fs.readJson(CONFIG_PATH);
    }
    return { serverIp: 'http://localhost:5018', deviceId: null, deviceName: null, branchCode: '1000' };
});

ipcMain.handle('save-config', async (event, config) => {
    await fs.writeJson(CONFIG_PATH, config);
    return { success: true };
});

ipcMain.handle('get-local-path', () => MEDIA_DIR);

ipcMain.handle('read-changelog', async () => {
    // Try to find changelog in docs folder (relative to app root in dev)
    const possiblePaths = [
        path.join(__dirname, '..', '..', 'docs', 'CHANGELOG.md'),
        path.join(app.getAppPath(), 'CHANGELOG.md')
    ];

    for (const p of possiblePaths) {
        if (await fs.pathExists(p)) {
            return await fs.readFile(p, 'utf8');
        }
    }
    return "Changelog not found.";
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

ipcMain.handle('get-app-version', () => app.getVersion());

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
