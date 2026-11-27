# legacy-win7 — Signage Unicorn Audio for Windows 7 / 32-bit

Second package root for the audio player. Everything except `package.json` and this file is
copied in by `node scripts/build-audio-win7.js` from the shared source one level up and is
gitignored (`legacy-win7/*`), as is its `node_modules` (Electron 22.3.27, the last release that
runs on Windows 7 and ships ia32; better-sqlite3 9.x for its Node 16).

- Build the installer: `npm run build:audio:win7` -> `dist-audio-win7\Signage Unicorn Audio Win7 Setup <version>.exe`
- Smoke test on Electron 22 (x64, this machine): `npm run smoke:win7` (always audio mode, because the
  package name contains "audio"; 14/15 by design, the mock playlist's images are skipped)
- Known Node 16 gap: `fs.promises.statfs` is missing, so the free-disk figure falls back (logged once as
  `[STORAGE] statfs unavailable`); nothing else in main.js or the renderer needs anything newer.
- No compiler on the dev box: `npm install --ignore-scripts`, then Electron's own `install.js` and the
  better-sqlite3 prebuilt download (`npm run sqlite:x64` / `sqlite:ia32`); `build.npmRebuild` is false.
- Same version, product name and appId as the x64 audio build. At run time `process.arch === 'ia32'`
  makes main.js read `AudioClientDownloadUrlWin7` / `AudioClientDownloadSha256Win7` (version key shared),
  so a Win7 box is never offered the x64 installer.
- `Publish-ClientUpdate.ps1 -Audio` publishes the Win7 installer alongside the x64 one when it finds
  it next to it (`client\music-player\` in the bundle).

Windows 7 and Electron 22 are both end-of-life: this build gets our fixes but no Chromium security
updates. Replace the boxes when you can.
