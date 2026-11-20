# Signage Unicorn Audio — the audio-only player

Added 20-11-2026 (API 2.8.6, web 2.4.14, client source 2.8.1). An in-store sound player built from
the kiosk client's code base but shipped as a **separate product**, so the screens and their
client 2.8.0 are never touched.

## What it is

| | Screen (kiosk client) | Audio player |
|---|---|---|
| Installer | `Signage Unicorn Setup 2.8.0.exe` (unchanged) | `Signage Unicorn Audio Setup 2.8.1.exe` (`npm run build:audio`) |
| appId / install folder / userData | `com.signage.unicorn`, `Signage Unicorn` | `com.signage.unicorn.audio`, `Signage Unicorn Audio` (can sit beside a screen client on one PC) |
| Window | kiosk, fullscreen, always on top | 480×420 window, minimise, close = hide to tray, tray menu (Open / Mute / Volume / Skip / Restart player / Exit) |
| Device row | `playback_mode = 'screen'` (every existing row) | `playback_mode = 'audio'` (sent at register) |
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

## Installing an audio box

1. Install `Signage Unicorn Audio Setup 2.8.1.exe` (per user, one click). Set the Windows default
   output device to the amplifier/speakers first; the app plays through the default device.
2. On the setup screen: server, device name, branch, location; leave **Start hidden in tray**
   ticked for an unattended box, untick it on a desk PC. CONNECT & REGISTER.
3. In the console the new row shows `AUDIO`. Assign a playlist that contains audio files; set the
   level with the slider. The player starts unmuted at 70 %.
4. A box that boots to the Windows logon screen plays nothing until someone logs on (the app
   starts at logon): give unattended boxes automatic logon.

## Updating audio boxes

Publish the installer and set `LatestAudioClientVersion`, `AudioClientDownloadUrl`,
`AudioClientDownloadSha256` (system settings), then send `UPDATE_CLIENT` to the audio devices.
`Publish-ClientUpdate.ps1` writes the screen keys; for audio boxes set the three audio keys by hand
until the script grows an `-Audio` switch. Screens ignore the audio keys entirely.

## Troubleshooting

- No sound: Windows volume mixer (per-app level), default output device, then the card's slider
  (0 % = muted). The tray tooltip shows the current track.
- Row shows as a screen (no `AUDIO` badge): the box registered with a pre-2.8.6 API, or an old
  row was re-used. Re-run CONNECT & REGISTER from the app's Settings; register sends the mode.
- Images in the playlist: skipped on audio boxes with a log line (`no sound on an audio device`),
  half a second each.
- Smoke harness: `SIGNAGE_AUDIO=1 npm run smoke` passes 14/15 by design (the mock playlist's image
  is skipped, so no playback log is produced); plain `npm run smoke` must stay 15/15.
