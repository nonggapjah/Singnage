// Builds "Signage Unicorn Audio" for Windows 7 / 32-bit boxes from this same source tree.
//
// Electron 40 (the normal build) needs Windows 10 x64. Electron 22 is the last release that runs on
// Windows 7 and ships ia32 binaries, so legacy-win7/ is a second package root with its own
// node_modules (electron 22.3.27, better-sqlite3 9.x for Node 16) and this script copies the
// shared source into it before packaging. Same code, same version number, same product name and
// appId; only the installer name differs ("... Win7 Setup <version>.exe") and at run time main.js
// sees process.arch === 'ia32' and reads the *Win7 download keys.
//
// Usage:
//   node scripts/build-audio-win7.js            -> sync + npm install (first time) + ia32 installer
//   node scripts/build-audio-win7.js --smoke    -> sync + x64 rebuild + smoke harness on Electron 22, no installer
//   node scripts/build-audio-win7.js --sync     -> only copy the source into legacy-win7/
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const legacy = path.join(root, 'legacy-win7');
const mainPkg = require(path.join(root, 'package.json'));
const args = new Set(process.argv.slice(2));

function run(cmd, cmdArgs, cwd, extraEnv) {
    const env = Object.assign({}, process.env, { CSC_IDENTITY_AUTO_DISCOVERY: 'false' }, extraEnv || {});
    let r;
    if (process.platform === 'win32') {
        const line = `"${cmd}" ` + cmdArgs.map(a => (/[\s$]/.test(a) ? `"${a}"` : a)).join(' ');
        r = spawnSync('cmd.exe', ['/d', '/s', '/c', `"${line}"`], { cwd, stdio: 'inherit', env, windowsVerbatimArguments: true });
    } else {
        r = spawnSync(cmd, cmdArgs, { cwd, stdio: 'inherit', env });
    }
    if (r.error) { console.error(r.error.message); process.exit(1); }
    if (r.status !== 0) { console.error(`${path.basename(cmd)} exited with ${r.status}`); process.exit(r.status || 1); }
}

function copyTree(src, dest) {
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true });
}

// 1. sync the shared source (files list mirrors package.json "build.files")
const files = ['main.js', 'preload.js', 'index.html', 'Watchdog.ps1', 'StartWatchdog.bat', 'CHANGELOG.md'];
const dirs = ['src', 'assets', 'smoke', 'test'];
for (const f of files) {
    const s = path.join(root, f);
    if (fs.existsSync(s)) fs.copyFileSync(s, path.join(legacy, f));
}
for (const d of dirs) {
    const s = path.join(root, d);
    if (fs.existsSync(s)) copyTree(s, path.join(legacy, d));
}
// version follows the main package so both audio builds publish under one LatestAudioClientVersion
const legacyPkgPath = path.join(legacy, 'package.json');
const legacyPkg = JSON.parse(fs.readFileSync(legacyPkgPath, 'utf8'));
if (legacyPkg.version !== mainPkg.version) {
    legacyPkg.version = mainPkg.version;
    fs.writeFileSync(legacyPkgPath, JSON.stringify(legacyPkg, null, 2) + '\n');
}
console.log(`[win7] source synced into legacy-win7/ (version ${mainPkg.version})`);
if (args.has('--sync')) process.exit(0);

// 2. dependencies (Electron 22 + better-sqlite3 9 live only here). No compiler on the dev box, so
//    install scripts are skipped and the two binaries come as prebuilt downloads: Electron's own
//    install.js (x64, for running locally) and better-sqlite3's prebuild for Electron ABI 110.
// Absolute path: a bare "npm.cmd" through cmd.exe resolved %~dp0 to the cwd and looked for npm-cli.js there.
const npm = process.platform === 'win32' ? path.join(path.dirname(process.execPath), 'npm.cmd') : 'npm';
if (!fs.existsSync(path.join(legacy, 'node_modules', 'electron', 'package.json'))) {
    console.log('[win7] npm install --ignore-scripts (first build)');
    run(npm, ['install', '--no-audit', '--no-fund', '--ignore-scripts'], legacy);
}
if (!fs.existsSync(path.join(legacy, 'node_modules', 'electron', 'dist', 'electron.exe'))) {
    console.log('[win7] downloading Electron 22.3.27 (x64, local runs only; electron-builder fetches ia32 itself)');
    run(process.execPath, [path.join(legacy, 'node_modules', 'electron', 'install.js')], legacy);
}
const bin = (name) => path.join(legacy, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);
const sqlite = (arch) => run(npm, ['run', `sqlite:${arch}`], legacy);

if (args.has('--smoke')) {
    // The smoke harness runs Electron on THIS (x64) machine, so the native module must be the x64
    // Electron-22 prebuild; the packaging step swaps in the ia32 one again.
    sqlite('x64');
    // The package name here is signage-unicorn-audio, so app.getName() puts main.js in audio mode
    // by itself: this is the audio smoke (14/15 by design: the mock playlist's images are skipped).
    console.log('[win7] smoke (audio mode, forced by the product name)');
    run(process.execPath, [path.join(legacy, 'smoke', 'run-smoke.js')], legacy, { ELECTRON_RUN_AS_NODE: '' });
    process.exit(0);
}

// 3. package: the ia32 prebuild goes into node_modules first; electron-builder packages it as-is
//    (build.npmRebuild = false) and downloads the ia32 Electron 22 runtime itself.
sqlite('ia32');
console.log('[win7] electron-builder --win nsis --ia32');
run(bin('electron-builder'), ['--win', 'nsis', '--ia32'], legacy);
console.log(`[win7] done -> dist-audio-win7\\Signage Unicorn Audio Win7 Setup ${mainPkg.version}.exe`);
