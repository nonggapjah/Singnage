# Media integrity (API 2.8.15)

## Why

26–27-11-2026: `sn_media_files` row 106 ("รอบ2_New Chat & Shop") described a 102 MB file with hash
`b8514af3…` while the file the screens fetch (`/media/2b8d5118-….mp4`) is a valid 42 MB video with MD5
`9898d857…`. Every screen downloaded it, failed the MD5 check, deleted it and downloaded it again on the
next heartbeat: 336 screens × 42 MB in a loop filled the 600 Mbit/s uplink for a day and a half.
The egress gate (2.8.12) capped the damage; this feature removes the cause class.

## What the API does now

1. **Checks every live media row against its file** (`MediaIntegrityWorker`): 45 s after start and
   every `Media:IntegrityCheckMinutes` (default 360) it computes the MD5 and size of the stored file
   named by `blob_url` and writes the verdict to `integrity_status` / `integrity_checked_at` /
   `integrity_note` / `integrity_file` (migration 012; `integrity_file` is the stored file name the verdict
   was made for - a verdict whose file is no longer the row's file is stale and ignored, so a replaced file
   always gets a fresh verdict and an old file's quarantine can never attach to the new bytes). Statuses: `ok`, `mismatch`, `missing`, `loop-suspect`,
   `unknown` (never checked / external storage).
2. **Quarantines what it cannot vouch for**: an item whose media is `mismatch`, `missing` or
   `loop-suspect` is left out of every device schedule (`GetDeviceScheduleAsync`), so no screen is
   ever asked to fetch a file it cannot verify. The playlist editor still lists the item with
   `integrityStatus` set, and the API log / `sn_system_logs` carry an ERROR line
   `[MediaIntegrity] QUARANTINED | media N "name" | mismatch | stored hash … disk md5 …`.
3. **Detects loops whatever the cause**: the egress middleware counts admitted downloads per file in
   a sliding hour. A file fetched more than `max(1500, 3 × live screens)` times per hour is marked
   `loop-suspect` and quarantined within a minute (`[MediaIntegrity] LOOP_SUSPECT …`). On 27-11 the
   bad file was fetched ~10,000 times per hour; a real campaign fetches each file once per screen.
4. **Never stores a hash that describes other bytes**: a replace that only re-points `blob_url`
   (no upload) now hashes the new local file, or stores no hash at all (a screen skips the check for
   a missing hash; it never loops on one). Uploads and transcodes already hashed the final file.
5. **Checks new files within a minute**: every upload, replace and transcode publish asks the worker
   for an immediate re-check of that row, so a bad hash is caught before the screens fetch the file
   instead of at the next 6-hour pass. A replace also drops the old verdict (a loop latch included)
   for the new url: a good replacement goes back to the screens without an admin click.

## Operator view and actions

| | |
|---|---|
| `GET /api/v1/system/media-integrity` (login) | problems only; `?all=true` for every row; includes `downloadsLastHour` per file and the last run summary |
| `POST /api/v1/system/media-integrity/run` (admin) | run the full check now (63 files ≈ seconds) |
| `POST /api/v1/system/media-integrity/{id}/accept-disk` (admin) | "the file on disk is the right one": hash and size are taken from it, the flag is cleared, the screens get it again on their next schedule refresh |
| bundle `media-integrity` step | the same check from SQL + disk, read-only, for a box without a login |
| bundle `fix-media-hash -MediaId N -ExpectedOldHash H` | the manual equivalent of accept-disk (used on 27-11) |
| bundle `sync-schedule-all` | queue SYNC_SCHEDULE for every live screen (needed after a hash fix: a looping screen skips its 15-minute refresh while syncing) |

If a quarantined media should NOT be served as it is on disk, replace the file through the Media
page (upload); the new hash is computed from the stored file and the flag clears on the next check.

## Known limits

- The worker needs migration 012; until the schema apply has run, each pass logs an error and
  retries a minute later. Nothing is quarantined from a failed pass.
- Quarantine is a flag; no file is deleted or moved.
- External `blob_url`s (not under `/media/`) are not checked (`unknown`).
- Screens already holding a quarantined file keep playing it; only the download is withheld.
- Client side (2.8.9, planned): back off after 3 failed hash checks of one file and never skip the
  periodic schedule refresh more than twice in a row.
