// Media cache path safety (F05) for the MAIN process: every file name is validated and the
// resolved path must stay inside the cache (or fallback) directory before any fs call.
'use strict';
const path = require('path');

const STRICT_CACHE_NAME = /^[A-Za-z0-9._-]{1,200}$/;

function isSafeName(name, strict) {
    if (typeof name !== 'string' || name.length === 0 || name.length > 200) return false;
    if (name.includes('..') || name.includes('/') || name.includes('\\') || name.includes('\0') || name.includes(':')) return false;
    if (path.basename(name) !== name) return false;
    if (/^[. ]|[. ]$/.test(name)) return false; // Windows strips trailing dots/spaces -> aliasing
    return strict ? STRICT_CACHE_NAME.test(name) : true;
}

function resolveInside(baseDir, name, strict) {
    if (!isSafeName(name, strict)) throw new Error(`Invalid cache file name: ${String(name).slice(0, 80)}`);
    const base = path.resolve(baseDir);
    const full = path.resolve(base, name);
    if (!full.startsWith(base + path.sep)) throw new Error('Path escapes the cache directory');
    return full;
}

module.exports = { isSafeName, resolveInside, STRICT_CACHE_NAME };
