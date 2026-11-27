# Branch-by-branch playlist rollout (API 2.8.14, web 2.4.21)

## Why

"Deploy playlist" to a selection spanning many branches used to assign every screen in the same
second. Every branch then downloaded at once, every branch finished late, and on 26-11-2026 the
server pushed 567 Mbit/s for a morning. The media egress gate (2.8.12/2.8.13) caps the bandwidth;
the rollout controls the **order**: one branch at a time, so the first branches are done early and
the operator can see where the campaign is.

## What happens

1. In the Deploy playlist dialog, when the selection covers two or more branches, tick
   **Release branch by branch** and pick the interval (5–60 min, default 10).
2. The API stores the whole selection (`sn_playlist_rollouts` + `sn_playlist_rollout_items`, one row
   per screen, grouped by branch in natural order: 1003, 1021, 1021A, MUSIC, UNASSIGNED last) and
   assigns the **first branch at once**, exactly as a normal deploy would (one entry per playlist per
   screen, SYNC_SCHEDULE queued).
3. `PlaylistRolloutWorker` runs every 30 s. A wave whose time has come is released when nothing is
   waiting for a download slot in the egress gate; otherwise it is **held** (the hold reason is shown
   in the Rollouts panel) for at most 60 min, then released anyway. At most one new branch per rollout
   per pass, so a resumed or restarted rollout still paces itself.
4. A screen whose assignment fails is retried on later passes, 3 attempts in all, then counted as
   failed with the error kept on its row.
5. When nothing is left the rollout becomes `done`.

Closing the browser changes nothing: the rows are the state. An API restart continues where it was.

## Operator controls (web: Playlists page, Rollouts panel; API: `/api/v1/rollouts`)

| Action | Effect |
|---|---|
| Pause | No further screen is claimed from that moment (the few being assigned at that second finish). Screens already assigned keep the playlist. |
| Resume | The next branch is released now, the rest follow at the interval again. |
| Cancel | The remaining branches are never assigned; released ones keep the playlist. To undo those, clear the schedule as usual. |

`GET /api/v1/rollouts[?playlistId=]` lists active and paused rollouts plus those finished in the
last 24 h, with per-branch counts, the next branch and its time, and the hold reason.

Bundle: `run-on-server.ps1 playlist-rollout -NoSession -SkipSync` prints the same from SQL.

## Limits worth knowing

- A future **start date** does not pre-download: a screen fetches the files when the start date
  arrives (the schedule endpoint skips future assignments). Branch-by-branch release spreads the
  load only for a start of "Now"; for a dated campaign the egress gate is the brake.
- Single-branch selections are deployed immediately even with the option ticked (there is nothing
  to stagger); the response says so.
- The worker does not know what the screens are doing; "nothing waiting" means the gate's queue is
  empty, which is the best server-side signal that the previous branches have their files.
- Device ids that were deleted between opening the dialog and deploying are left out of the rollout
  and listed in the response (`unknownDevices`), so nothing is silently dropped.
- "Applied" is verified: after the write the screen's assignments are read back and the playlist must
  be there; otherwise the item counts as failed and is retried.
