// Persistent rotating log for the MAIN process (and renderer lines relayed over IPC).
// <dir>/app-YYYYMMDD.log, rotated when a file exceeds maxBytes (-> app-YYYYMMDD.N.log),
// keeping the newest `keepFiles` files. Pure helpers are exported for tests.
'use strict';
const fs = require('fs');
const path = require('path');

function pad(n) { return String(n).padStart(2, '0'); }

function dateStamp(d) {
    const dt = d || new Date();
    return `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}`;
}

function logFileName(d, index) {
    return index ? `app-${dateStamp(d)}.${index}.log` : `app-${dateStamp(d)}.log`;
}

function shouldRotate(currentSize, nextChunkSize, maxBytes) {
    return currentSize + nextChunkSize > maxBytes;
}

// Given all log file names in the directory, return the ones to delete so that only the newest
// `keep` remain. Order: by date stamp, then by rotation index (plain file = index 0 = oldest of its day).
function selectFilesToPrune(names, keep) {
    const parsed = names
        .map(n => {
            const m = /^app-(\d{8})(?:\.(\d+))?\.log$/.exec(n);
            return m ? { name: n, day: m[1], idx: m[2] ? Number(m[2]) : 0 } : null;
        })
        .filter(Boolean)
        .sort((a, b) => (a.day === b.day ? a.idx - b.idx : (a.day < b.day ? -1 : 1)));
    if (parsed.length <= keep) return [];
    return parsed.slice(0, parsed.length - keep).map(p => p.name);
}

function formatLine(level, message, now) {
    const ts = (now || new Date()).toISOString();
    return `${ts} [${String(level).toUpperCase().padEnd(5)}] ${message}\n`;
}

function createRotatingLogger(options) {
    const o = Object.assign({ maxBytes: 5 * 1024 * 1024, keepFiles: 7 }, options || {});
    if (!o.dir) throw new Error('logger needs a dir');
    const now = typeof o.now === 'function' ? o.now : () => new Date();
    let currentName = null;
    let currentSize = 0;
    let rotationIndex = 0;
    let failed = false;

    function ensureDir() {
        try { fs.mkdirSync(o.dir, { recursive: true }); } catch (e) { /* reported below */ }
    }

    function openFor(day) {
        // Reuse the newest existing file of the day so a restart appends instead of starting a new file.
        let idx = 0;
        try {
            const existing = fs.readdirSync(o.dir).filter(n => n.startsWith(`app-${day}`) && n.endsWith('.log'));
            for (const n of existing) {
                const m = /^app-\d{8}(?:\.(\d+))?\.log$/.exec(n);
                if (m) idx = Math.max(idx, m[1] ? Number(m[1]) : 0);
            }
        } catch (e) { /* empty dir */ }
        rotationIndex = idx;
        currentName = logFileName(now(), rotationIndex);
        try { currentSize = fs.statSync(path.join(o.dir, currentName)).size; } catch (e) { currentSize = 0; }
    }

    function prune() {
        try {
            const names = fs.readdirSync(o.dir);
            for (const n of selectFilesToPrune(names, o.keepFiles)) {
                try { fs.unlinkSync(path.join(o.dir, n)); } catch (e) { /* ignore */ }
            }
        } catch (e) { /* ignore */ }
    }

    function write(level, message) {
        if (failed) return;
        try {
            const line = formatLine(level, message, now());
            const day = dateStamp(now());
            let pruneAfter = false;
            if (!currentName || !currentName.startsWith(`app-${day}`)) {
                ensureDir();
                openFor(day);
                pruneAfter = true;
            }
            if (shouldRotate(currentSize, Buffer.byteLength(line), o.maxBytes) && currentSize > 0) {
                rotationIndex += 1;
                currentName = logFileName(now(), rotationIndex);
                currentSize = 0;
                pruneAfter = true;
            }
            fs.appendFileSync(path.join(o.dir, currentName), line);
            currentSize += Buffer.byteLength(line);
            if (pruneAfter) prune(); // after the append so the new file counts toward keepFiles
        } catch (e) {
            // Logging must never take the player down; give up quietly after the first failure
            // and let the next process start try again.
            failed = true;
        }
    }

    return {
        write,
        dir: o.dir,
        currentFile: () => (currentName ? path.join(o.dir, currentName) : null),
        info: (m) => write('info', m),
        warn: (m) => write('warn', m),
        error: (m) => write('error', m),
    };
}

module.exports = { createRotatingLogger, logFileName, dateStamp, shouldRotate, selectFilesToPrune, formatLine };
