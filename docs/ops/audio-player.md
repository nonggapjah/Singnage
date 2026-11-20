# Signage Unicorn Audio — the audio-only player

Added 20-11-2026 (API 2.8.6 -> 2.8.8, web 2.4.14 -> 2.4.16, audio client 2.8.3). An in-store sound player built from
the kiosk client's code base but shipped as a **separate product**, so the screens and their
client 2.8.0 are never touched.

## What it is

| | Screen (kiosk client) | Audio player |
|---|---|---|
| Installer | `Signage Unicorn Setup 2.8.0.exe` (unchanged) | `Signage Unicorn Audio Setup 2.8.3.exe` (`npm run build:audio`) |
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
cd C:\Singnage\_release_2.8.0
.\run-on-server.ps1 publish-client -NoSession -ScriptArgs '-Audio -CanaryCount 1'
```

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
  window; the output picker asks for device labels once when Chromium hides them.

Reviewed and kept as designed: daily windows and days of week apply to screens as well (the
user asked for them fleet-wide; existing assignments carry no window and are unchanged).

## Installing an audio box

1. Install `Signage Unicorn Audio Setup 2.8.3.exe` (per user, one click). Set the Windows default
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
