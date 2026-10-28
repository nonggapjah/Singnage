// After `npm install`, make sure better-sqlite3's native module matches the installed Electron
// (npm only fetches the Node ABI build). Downloads the matching prebuilt binary; no compiler
// needed. Falls back to a loud message pointing at `npm run rebuild` (electron-rebuild, needs
// Visual Studio build tools) when no prebuild exists for this Electron version.
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
let electronVersion;
try {
    electronVersion = require(path.join(root, 'node_modules', 'electron', 'package.json')).version;
} catch (e) {
    console.log('[postinstall] electron not installed yet; skipping better-sqlite3 prebuild');
    process.exit(0);
}
const bin = path.join(root, 'node_modules', 'prebuild-install', 'bin.js');
const cwd = path.join(root, 'node_modules', 'better-sqlite3');
if (!fs.existsSync(bin) || !fs.existsSync(cwd)) {
    console.log('[postinstall] prebuild-install or better-sqlite3 missing; skipping');
    process.exit(0);
}
console.log(`[postinstall] fetching better-sqlite3 prebuild for electron ${electronVersion}`);
const r = spawnSync(process.execPath, [bin, '-r', 'electron', '-t', electronVersion], { cwd, stdio: 'inherit' });
if (r.status !== 0) {
    console.error(`[postinstall] no prebuilt better-sqlite3 for electron ${electronVersion}; run 'npm run rebuild' (needs VS build tools) before starting the app.`);
}
process.exit(0); // never fail npm install over this
