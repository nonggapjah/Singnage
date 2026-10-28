# Rollout guide — API 2.8.0 / Client 2.8.0 / Web 2.4.0

This release changes how screens authenticate, how commands are acknowledged, how playback
times are stored and how the admin console signs in. Everything is staged so that the deployed
2.7.x screens keep working while the fleet is upgraded. Deploy in the order below.

## 1. Before anything else

- Merge any stored-procedure hot-fix that was applied directly to production into
  `docs/db_template/procedure/`. The first API start writes every procedure once (the hash
  ledger `sn_schema_objects` is empty) and would overwrite an un-merged hot-fix.
  Check with `SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.sp_device_std'))` etc.
- Back up the database. Migrations 001–009 run automatically; 007 rewrites `start_time`/`end_time`
  of every existing playback row (+7 h, once, resumable).

## 2. API (first)

1. Copy the published API build **and the whole `docs/db_template` folder** (incl. `migrations/`).
2. Add the new keys to `appsettings.Production.json` (defaults shown):
   ```json
   "Security": { "DeviceAuth": "IfIssued", "DeviceTokenReclaimOnRegister": false },
   "Maintenance": { "PlaybackLogRetentionDays": 90, "SystemLogRetentionDays": 14 }
   ```
3. Restart. The log must show `Database schema up to date: ... migration(s) applied`.
   `[ERROR] Database schema apply FAILED` means a migration failed: procedures are then NOT
   applied, the API still serves, and device auth stays fail-open. Fix and press
   **Re-apply schema** in the console (now a POST).
4. `GET /api/v1/system/capabilities` must answer 200 — the web uses it to switch behaviour.

## 3. Web admin (second)

- Build with `npm run build`, restart `signage-web`.
- Keep `NEXT_PUBLIC_API_URL=/api/v1` (same origin). The proxy upstream is the server-side
  env `API_UPSTREAM` (default `http://127.0.0.1:8862`).
- Sign-in now sets the httpOnly cookie `su_session`; the console no longer stores the JWT in
  localStorage. Every user signs in again once.

## 4. Kiosk client 2.8.0 (third, canary first)

1. `npm run build` → `dist\Signage Unicorn Setup 2.8.0.exe`.
2. `src\Publish-ClientUpdate.ps1 -Version 2.8.0 -RepoRoot <server repo> -CanaryCount 1`
   publishes the installer, writes `LatestClientVersion`, `ClientDownloadUrl` and
   `ClientDownloadSha256` together and queues `UPDATE_CLIENT` for one screen.
   The script refuses a non-https server URL.
3. On the canary press **F7** and verify: `API 2.8.0`, `DEVICE TOKEN: OK`, `ONLINE`,
   media playing, `health.json` updating, log folder shown, portal only on `127.0.0.1:8088`.
4. Expand the rollout per `UPDATE_RULES.md`.

## 5. After the whole fleet is on 2.8.0

- Devices page header shows **Tokenised x/y** and every card shows `TOKEN` + `P2`.
  Only then set `Security:DeviceAuth` to `Required`.
- A screen stuck on `NO TOKEN` with `CLAIM_EVIDENCE_MISMATCH` / `DEVICE_IDENTITY_CONFLICT`
  in the API log has a duplicate device row: retire the duplicate, then **Reset device token**
  on the card; the screen reclaims on its next heartbeat (`RECLAIM_TOKEN`).

## New files and keys on a kiosk

| Item | Location |
|---|---|
| config keys | `deviceToken`, `diagToken`, `diagnosticsBind`, `allowInsecureUpdates`, `watchdogAutoRegister` in `config.json` |
| logs | `<userData>\logs\app-YYYYMMDD.log` (7 × 5 MB) |
| health | `<userData>\health.json` (written from renderer reports; `rendererStale` = unhealthy) |
| watchdog | `<userData>\watchdog\Watchdog.ps1`, scheduled task `SignageUnicornWatchdog` (ONLOGON) |
| update lock | `<userData>\update.lock` while an installer runs |

## Verification harnesses in the repo

- API: `dotnet test src/SignageUnicorn.Api.Tests`
- Web: `npm run test` (vitest), `npx tsc --noEmit`, `npx next build`
- Kiosk: `npm test`, `npm run smoke:all` (real Electron against a local mock API)
- CI: `.github/workflows/ci.yml` runs all of the above on push
