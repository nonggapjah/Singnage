// Builds "Signage Unicorn Audio" from this same source tree.
//
// The audio-only player is a separate PRODUCT, not a new version of the kiosk client: its own
// appId, product name, installer name, install folder and userData, so it installs beside a screen
// client without touching it, and it never shows up as an update for a screen (screens read
// LatestClientVersion; the audio app reads LatestAudioClientVersion). At run time main.js detects
// the product name and switches to audio mode (small window + tray, no kiosk takeover).
//
// Usage: npm run build:audio   -> dist-audio\Signage Unicorn Audio Setup <version>.exe
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const bin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');
const overrides = [
    '--win', 'nsis', '--x64',
    '--config.appId=com.signage.unicorn.audio',
    '--config.productName=Signage Unicorn Audio',
    '--config.extraMetadata.name=signage-unicorn-audio',
    '--config.extraMetadata.productName=Signage Unicorn Audio',
    '--config.extraMetadata.description=Audio-only player for Signage Unicorn',
    '--config.artifactName=Signage Unicorn Audio Setup ${version}.${ext}',
    '--config.directories.output=dist-audio',
];

const env = Object.assign({}, process.env, { CSC_IDENTITY_AUTO_DISCOVERY: 'false' });
let result;
if (process.platform === 'win32') {
    // Arguments carry spaces and ${macros}; hand cmd one verbatim line so nothing is re-split.
    const line = `"${bin}" ` + overrides.map(a => (/[\s$]/.test(a) ? `"${a}"` : a)).join(' ');
    result = spawnSync('cmd.exe', ['/d', '/s', '/c', `"${line}"`], { cwd: root, stdio: 'inherit', env, windowsVerbatimArguments: true });
} else {
    result = spawnSync(bin, overrides, { cwd: root, stdio: 'inherit', env });
}
if (result.error) { console.error(result.error.message); process.exit(1); }
process.exit(result.status === null ? 1 : result.status);
