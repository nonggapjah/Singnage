# Media egress gate (API 2.8.12)

Added 26-11-2026 after a monthly campaign push (4 playlists re-assigned to 335 screens, ~20 new
media files) kept 278 concurrent `/media` downloads open and the server sending 567 Mbit/s for most
of a morning. Every byte a screen downloads leaves the server through the public hostname
(`cloudflared`), so the ISP saw the burst on the office uplink and the network degraded. The only
brake was to pull the assignments.

## What it does

A middleware in front of the static file middleware, for `GET /media/*` and `GET /setup/*` only
(HEAD and everything else untouched):

| Limit | Default | Meaning |
|---|---|---|
| `MaxConcurrentDownloads` | 40 | responses in flight at once; the rest queue |
| `QueueWaitSeconds` | 60 | how long a queued request waits before `503` + `Retry-After: 30` (kept under Cloudflare's 100 s origin timeout) |
| `MaxEgressMbps` | 150 | total Mbit/s of all gated responses together (token bucket, 64 KB granularity); hard maximum 250 (code constant, Commander 27-11-2026) |

A screen that gets a 503 logs "Download failed ... Server status 503", keeps playing what it has,
and retries the missing files on its next heartbeat (about 15 s; `selfHealMissingFiles` in the
renderer, "Self-Healing: Detected missing/corrupted files in cache"). A partly downloaded file is
resumed with a Range request, not restarted. Nothing is lost, the campaign just spreads over hours
instead of minutes.

## Settings

Code defaults = `appsettings.json` `Media:*`. Runtime overrides live in `sn_system_settings` and
are re-read every 30 s, so the operator can lift the cap for a night push and lower it by day
without a deploy or restart:

| Key | Range |
|---|---|
| `MediaMaxConcurrentDownloads` | 1..1000 |
| `MediaQueueWaitSeconds` | 0..90 |
| `MediaMaxEgressMbps` | 1..250 (above 250 is clamped to 250; 0 is ignored) |

Invalid or out-of-range values are ignored (the gate can never be switched off by a typo).
From the deploy bundle: `run-on-server.ps1 egress -ScriptArgs '-Action show'`,
`'-Action set -Mbps 100'`, `'-Action set -Mbps 250 -Slots 200'` (night), `'-Action clear'`.

## Watching it

- `GET /api/v1/system/egress` (operator login): `inFlight`, `waiting`, `admitted`, `rejected`,
  `throttleWaits`, `sentMB`, the effective limits and where they came from.
- API log: `[Egress] Media egress gate on: ...` at start, `[Egress] Settings changed: ...` on an
  override, and at most one `[Egress] N download(s) refused with 503 in the last 30s ...` warning per
  30 s while the queue overflows.
- Response header `X-Egress-Gate: admitted | queue-timeout`.
- `GET /api/v1/system/capabilities` carries `egressGate: true`.

## Sizing

The Symphony line is 600 Mbit/s and is shared with several other servers (Commander, 27-11-2026).
The 26-11 push (567 Mbit/s) was therefore the whole line. Budget for this server:

| when | `MediaMaxEgressMbps` | why |
|---|---|---|
| office hours (default) | 150 | a quarter of the line; the rest stays with the other servers and the office |
| night push | 250 | the hard maximum: faster rollout while 350 Mbit/s stays with everyone else |
| 0 (unlimited) or > 250 | refused / clamped by code (2.8.13) | 26-11 must not be reproducible by a setting |

`net-now` shows only this server's NIC; what the other servers use at the same time is not visible
from here, so if the office still degrades at 150, lower it rather than argue with the number.

## Not covered

- The admin console's own thumbnails and the web player (`/player`) read `/media` too and share the
  gate; under a full queue they can also see a 503. Acceptable for now; exempting operator sessions
  is a possible follow-up.
- Installer downloads (`/setup`) count against the same slots; `publish-client` already paces the
  rollout (10 screens per round), so this is rarely the binding limit.
