# Signage Unicorn Audio — the audio-only player

Added 20-11-2026 (API 2.8.6 -> 2.8.9, web 2.4.14 -> 2.4.19, audio client 2.8.7). An in-store sound player built from
the kiosk client's code base but shipped as a **separate product**, so the screens and their
client 2.8.0 are never touched.

## What it is

| | Screen (kiosk client) | Audio player |
|---|---|---|
| Installer | `Signage Unicorn Setup 2.8.0.exe` (unchanged; bundle `client\video-player\`) | `Signage Unicorn Audio Setup 2.8.7.exe` (`npm run build:audio`; bundle `client\music-player\`) + `Signage Unicorn Audio Win7 Setup 2.8.7.exe` for Windows 7 / 32-bit |
| appId / install folder / userData | `com.signage.unicorn`, `Signage Unicorn` | `com.signage.unicorn.audio`, `Signage Unicorn Audio` (can sit beside a screen client on one PC) |
| Window | kiosk, fullscreen, always on top | 480×420 window, minimise, close = hide to tray, tray menu (Open / Mute / Volume / Skip / Restart player / Exit) |
| Device row | `playback_mode = 'screen'` (every existing row), `device_uuid` = hardware uuid | `playback_mode = 'audio'` (sent at register), `device_uuid` = a second key derived from the hardware uuid (SHA-256), so a PC with both products has two rows |
| Schedule items received | video + image, **never audio** | audio + video (sound track), **never image** |
| Update keys | `LatestClientVersion`, `ClientDownloadUrl`, `ClientDownloadSha256` | `LatestAudioClientVersion`, `AudioClientDownloadUrl`, `AudioClientDownloadSha256` |
| Watchdog task / diag port | `SignageUnicornWatchdog`, 8088 | `SignageUnicornAudioWatchdog`, 8089 |
| REBOOT command | reboots Windows | restarts the app only |
| CAPTURE_SCREEN | screenshot | refused (`not available on audio devices`) |
| Power | display never sleeps, screensaver off | app kept awake only; display may sleep; screensaver/power plan untouched |
| Startup | login item + Run key `SignageUnicorn` | login item + Run key `SignageUnicornAudio`; optional "start hidden in tray" |

Audio mode is decided at run time from the packaged product name (`/audio/i.test(app.getName())`);
`SIGNAGE_AUDIO=1` forces it for `electron .` in development. Nothing in a screen build can enter it.

## Server side (API 2.8.6)

- Migration 010 adds `sn_devices.playback_mode` (default `'screen'`) and `volume`. `sp_device_std`
  REGISTER_OR_LOGIN takes `@p_playback_mode` (NULL keeps the row's value) and every device result
  set carries `PlaybackMode` / `Volume`.
- `PlaybackModes.Accepts(mode, fileName)` filters `GET /devices/{id}/schedule` per device: a
  screen never receives an audio item (the deployed kiosk would show it as a broken image for its
  slot), an audio player never receives an image. One playlist may therefore be assigned to both
  kinds. A playlist picked **manually** on a kiosk (F-key list) is not filtered: keep audio-only
  playlists named so nobody picks them on a screen.
- Uploads accept `.mp3 .wav .m4a .aac` (magic-checked). Audio is transcoded in the background to
  AAC 128 kbps in `.m4a` with EBU R128 loudness normalisation (`loudnorm I=-16 TP=-1.5 LRA=11`),
  cover art is never mapped, and the measured length replaces the uploader's guess. Video
  conversion is unchanged.
- `SET_VOLUME:<0-100>` (single or batch) is canonicalised and the level stored on the row;
  `MUTE` / `UNMUTE` are plain commands. `GET /system/capabilities` answers `audioDevices: true`.

## Console (web 2.4.14)

- Devices: `AUDIO` badge; the card shows a volume slider + Mute (sends `SET_VOLUME` 400 ms after
  the last move, no confirm) instead of View screen, and "Restart player" instead of "Reboot".
- Sidebar `Audio Players` (`/admin/audio`, web 2.4.18): the Devices page scoped to audio devices; `Devices`
  itself lists screens only. Same cards, schedule dialogs and batch actions on both.
- Media: audio upload with preview and length; audio icon on cards. Playlists: audio items carry an
  `Audio` tag.

## Dayparts and announcements (API 2.8.7 / web 2.4.15)

Every assignment (per-device schedule, both batch-assign dialogs) now also has:

- **Daily window** `From HH:mm – To HH:mm` in the store's local time (`Schedule:TimeZoneId`,
  default `SE Asia Standard Time`). Start inclusive, end exclusive; `22:00–02:00` is an overnight
  window. Empty = all day.
- **Days of week** toggles Mo–Su; none selected = every day.
- **Repeat every N min** (audio players only): the playlist becomes an *announcement*. The
  audio player plays its items once every N minutes between the regular tracks (the first time
  right away), never as part of the loop; an announcements-only schedule plays them from idle.
  A screen ignores the flag and plays the playlist in its loop as before.

The server evaluates all of it (`ScheduleWindow.cs`): `GET /devices/{id}/schedule` returns only
the items active right now, `scheduleVersion` changes with these fields, `nextTransitionAtUtc`
points at the next daily boundary, and the transition worker queues `SYNC_SCHEDULE` at daily
start/end times and at midnight when days are restricted. The kiosk client is unchanged: it
already re-reads the schedule on `SYNC_SCHEDULE` and every 15 minutes. Announcements travel as
`schedule.interjections` (ignored by the kiosk) and are consumed by audio client 2.8.2.

Status badges in the per-device dialog: `ACTIVE`, `WAITING` (start date ahead), `EXPIRED`,
`OFF HOURS` (outside the daily window today), `EVERY N MIN` (announcement).

## Output device (audio client 2.8.2)

The audio window has an `OUT` selector listing the PC's playback devices (Windows default +
each output). The choice is applied with `setSinkId` and remembered (`audioSinkId` in
config.json); a device that disappears falls back to the Windows default.

## Publishing an audio update

```powershell
cd C:\Singnage\Singnage\_ops\_release_2.8.0
.\run-on-server.ps1 publish-client -NoSession -ScriptArgs '-Audio -CanaryCount 1'
```

A new installer version needs the web app restarted between two publish runs: the first
`publish-client` copies the exe into `public/setup` and then fails its URL check with 404 (Next
lists `public/` only at startup), so run `restart-web` and `publish-client` again. The second run
queues the canary. Running `restart-web` before the first publish does not help, because the file
is not in `public/setup` yet.

`Publish-ClientUpdate.ps1 -Audio` copies `Signage Unicorn Audio Setup <ver>.exe` to
`/setup/Signage_Unicorn_Audio_Setup_<ver>.exe`, writes `LatestAudioClientVersion`,
`AudioClientDownloadUrl`, `AudioClientDownloadSha256` in one transaction and queues
`UPDATE_CLIENT` for audio devices only (`playback_mode = 'audio'`). The screen path
(no `-Audio`) now excludes audio devices from its canary pick.

## Review round (Codex + Impeccable, 20-11-2026 evening): API 2.8.8 / web 2.4.16 / audio 2.8.3

Codex (correctness) and Impeccable (UI audit) reviewed the audio/daypart work before deploy. Fixed:

- **Identity**: the audio build registers under its own 36-char key derived from the hardware
  uuid (`audioDeviceKeyFrom` in main.js). Before, a PC that already ran a screen would have had
  its screen row reclaimed and flipped to `audio` by the audio app.
- **Inheritance**: sibling-inherit and the inheritor CTE match `playback_mode` too; a screen never
  inherits an audio player's assignments (or the reverse).
- **Update launcher**: after an audio update the launcher restarts `Signage Unicorn Audio.exe`,
  never the screen exe beside it.
- **Announcements**: an authoritative empty schedule clears them; moving a playlist between the
  loop and "repeat every N min" changes the content hash (Smart Sync re-applies the partition);
  a missing announcement file no longer skips the next regular track.
- **Midnight**: an open-ended window (start only / end only) flips at 00:00; `NextBoundaryLocal`
  and the transition worker SQL now include that boundary.
- **Console**: the daily window sits on a second row under each assignment (the extra column was
  off-screen below ~1,560 px); the repeat field is shown for audio devices only; clicking a day
  while "every day" is active excludes that day (toggles read the same to the eye and to
  `aria-pressed`); the volume slider follows a refreshed row; 11 px minimum text in the audio
  window; the output picker's device labels were verified to be exposed by Electron (no permission probe needed).

Reviewed and kept as designed: daily windows and days of week apply to screens as well (the
user asked for them fleet-wide; existing assignments carry no window and are unchanged).

Clean-up after the review (API 2.8.9 / web 2.4.17 / audio 2.8.4):

- An overnight window with days (`Fri 22:00–02:00`) belongs to the day it started on: it keeps
  playing until 02:00 Saturday and does not start on Saturday night (API and console agree).
- The audio heartbeat carries `volume` (0 = muted); `sp_device_std` stores it, so the console slider
  follows changes made from the tray menu or F2/F3/F4. Screens send nothing and keep their value.
- The `OFF HOURS` badge is judged in store time (`Asia/Bangkok` in `lib/daypart.ts`), not the
  admin browser's clock.

## Rollout pacing and update diagnostics (audio 2.8.7)

23-11-2026, 2.8.6 rollout to 15 players: 13 updated in 1-4 min; King Square (611) and Bukis (619)
downloaded and SHA-verified fine but their first installer run exited non-zero (fast on Bukis,
7.5 min on the slow King Square box) and the launcher restarted the old version as designed; the
manual re-queue 15 min later installed in 30-50 s. Downloads were also 2-3x slower because three
batches were queued within two minutes (nine simultaneous 90 MB downloads from one server link).

- Pace the rollout: `publish-client -Audio -CanaryCount 1`, watch it, then `-CanaryCount 5` per
  run (the wrapper caps at 5) and wait for each batch to report the new version before the next.
- 2.8.7 launcher: every attempt goes to `<userData>\update-result.log`, one automatic retry after
  60 s, and the player uploads the log at the next boot ("Update launcher result: ..." in the
  system log).
- `run-on-server.ps1 update-why -NoSession -ScriptArgs '-DeviceIds 611,619 -Hours 3'` (read-only
  bundle step) prints the UPDATE_CLIENT history with fail_reason and the players' own update log
  lines; `canary-watch -DeviceIds a,b,c` accepts a list.
- Still open: the installer is unsigned, so a fresh 90 MB exe gets an antivirus first-execution
  scan on every box; a code-signing certificate is the durable fix.

## Changing a player's branch from the console (audio 2.8.6 / web 2.4.19)

The branch code is owned by the player: it sits in the device's config file and is sent on every
heartbeat, and `sp_device_std` applies `branch_code = ISNULL(@p_branch_code, branch_code)`, so an
UPDATE on `sn_devices` is overwritten within one heartbeat. That is why the console never had a
branch field. Since 2.8.6 the player understands `SET_BRANCH:<code>` (same pattern as
`UPDATE_DEVICE_ID:`): it saves the code, acks EXECUTED, and the next heartbeat carries the new
branch. The Audio Players page sends it through the existing `batch-command` endpoint (no API
change): select the players, "Change branch" in the batch bar, type the code once (max 30 chars;
`command_type` is NVARCHAR(50)). The button is audio-only because screens on 2.8.0 do not know
the command. Side effects: sibling inheritance (same branch + name + mode) now resolves in the
new branch; playback history keeps the branch it was logged under.

## Windows 7 / 32-bit boxes (audio 2.8.6)

Some music boxes are Windows 7 Pro 32-bit (Pentium G645, 2 GB). The normal build (Electron 40) needs
Windows 10 x64, so `legacy-win7/` is a second package root that packages the SAME source with
Electron 22.3.27 (the last release for Windows 7, ia32) and better-sqlite3 9.x:

- `npm run build:audio:win7` -> `dist-audio-win7\Signage Unicorn Audio Win7 Setup <version>.exe`;
  `npm run smoke:win7` runs the smoke harness on Electron 22 (x64) first.
- Same product name, appId, userData and version as the x64 audio build; at run time
  `process.arch === 'ia32'` makes it read `AudioClientDownloadUrlWin7` / `AudioClientDownloadSha256Win7`
  (version key shared), so a Win7 box is never offered the x64 installer. When those keys are absent
  the box simply stays on its version.
- `Publish-ClientUpdate.ps1 -Audio` publishes the Win7 installer alongside the x64 one when it finds
  it next to it (bundle `client\music-player\`), to `/setup/Signage_Unicorn_Audio_Win7_Setup_<v>.exe`.
- Windows XP is impossible (no Chromium, no TLS 1.2 to Cloudflare). Windows 7 and Electron 22 are both
  end-of-life: our fixes still ship, Chromium security fixes do not. Replace the boxes when you can;
  a G645 runs Windows 10 x64 with 4 GB RAM and then uses the normal build.

## Installing an audio box

1. Install `Signage Unicorn Audio Setup 2.8.7.exe` (Windows 10/11 x64) or `Signage Unicorn Audio Win7 Setup 2.8.7.exe` (Windows 7 / any 32-bit Windows) (per user, one click). Set the Windows default
   output device to the amplifier/speakers first; the app plays through the default device.
2. On the setup screen: server, device name, branch, location; leave **Start hidden in tray**
   ticked for an unattended box, untick it on a desk PC. CONNECT & REGISTER.
3. In the console the new row shows `AUDIO`. Assign a playlist that contains audio files; set the
   level with the slider. The player starts unmuted at 70 %.
4. A box that boots to the Windows logon screen plays nothing until someone logs on (the app
   starts at logon): give unattended boxes automatic logon.

## Updating audio boxes

See "Publishing an audio update" above. Screens ignore the audio keys entirely.

## Troubleshooting

- No sound: Windows volume mixer (per-app level), default output device, then the card's slider
  (0 % = muted). The tray tooltip shows the current track.
- Row shows as a screen (no `AUDIO` badge): the box registered with a pre-2.8.6 API, or an old
  row was re-used. Re-run CONNECT & REGISTER from the app's Settings; register sends the mode.
- Images in the playlist: skipped on audio boxes with a log line (`no sound on an audio device`),
  half a second each.
- Smoke harness: `SIGNAGE_AUDIO=1 npm run smoke` passes 14/15 by design (the mock playlist's image
  is skipped, so no playback log is produced); plain `npm run smoke` must stay 15/15.
