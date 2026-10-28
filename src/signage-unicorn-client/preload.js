// Preload: the ONLY bridge between the sandboxed renderer and the main process.
//
// The renderer runs with contextIsolation + sandbox and no Node integration, so it cannot
// require() anything. Every privileged operation it needs is an ipcRenderer.invoke() on one of
// the channels listed below; a channel that is not listed is refused before it reaches main.
// Server-provided strings (playlist names, file names, log messages) therefore can no longer
// turn into OS code execution even if they are rendered carelessly.
const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_CHANNELS = new Set([
    // config / identity
    'get-config', 'save-config', 'get-app-version', 'get-machine-uuid', 'get-mac-address',
    'get-diagnostics-info', 'set-playback-state',
    // local files / media cache
    'read-changelog', 'get-storage-info', 'clear-cache', 'delete-cached-file', 'check-media-exists',
    'download-media', 'resolve-media-url', 'prune-cache', 'get-fallback-media',
    // updates / system
    'download-update', 'fetch-update-metadata', 'launch-installer', 'toggle-fullscreen', 'reboot-device', 'capture-screen',
    // offline database
    'db-insert-playback-log', 'db-get-pending-logs', 'db-mark-logs-synced', 'db-mark-logs-rejected',
    'db-delete-logs-by-event-ids', 'db-clear-synced-logs', 'db-save-playlist', 'db-get-playlist',
    // liveness / logging / smoke test (round 2)
    'report-health', 'log-line', 'smoke-event',
]);

contextBridge.exposeInMainWorld('signage', {
    invoke(channel, ...args) {
        if (typeof channel !== 'string' || !ALLOWED_CHANNELS.has(channel)) {
            return Promise.reject(new Error(`IPC channel not allowed: ${String(channel)}`));
        }
        return ipcRenderer.invoke(channel, ...args);
    },
});
