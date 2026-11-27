using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Repositories.Interfaces;

namespace SignageUnicorn.Api.Services.Rollout
{
    /// <summary>
    /// Branch-by-branch playlist rollout (API 2.8.14). Starts a rollout from a batch request (wave 1
    /// applied inline), releases due waves for <see cref="Background.PlaylistRolloutWorker"/>, and
    /// answers the operator's list / pause / resume / cancel.
    /// </summary>
    public sealed class RolloutService
    {
        public const string StatusActive = "active";
        public const string StatusPaused = "paused";
        public const string StatusDone = "done";
        public const string StatusCancelled = "cancelled";

        private const int ApplyParallelism = 4;

        private readonly IRolloutRepository _repo;
        private readonly DeviceService _devices;
        private readonly ILogger<RolloutService> _logger;

        public RolloutService(IRolloutRepository repo, DeviceService devices, ILogger<RolloutService> logger)
        {
            _repo = repo;
            _devices = devices;
            _logger = logger;
        }

        /// <summary>
        /// Plans the request by branch and, when it spans two or more branches, stores the rollout and
        /// applies wave 1 at once. Returns null when there is only one branch: the caller then assigns
        /// everything immediately as before. Throws <see cref="ArgumentException"/> for an unknown
        /// playlist (400) and <see cref="InvalidOperationException"/> when a rollout of the playlist is
        /// already active or paused (409).
        /// </summary>
        public async Task<RolloutStartResult?> StartAsync(BatchAddScheduleRequest request, long? userId, CancellationToken ct)
        {
            var playlist = await _repo.ResolvePlaylistAsync(request.PlaylistId)
                ?? throw new ArgumentException($"Playlist '{request.PlaylistId}' does not exist.");

            // One rollout per playlist at a time. This is also what makes a retry after a request timeout
            // safe: the first call's rollout is already running, so the retry is refused with its id
            // instead of starting a second, independent one (Codex, full review).
            var open = await _repo.GetOpenForPlaylistAsync(playlist.playlist_id);
            if (open != null)
                throw new InvalidOperationException($"A rollout of this playlist is already {open.status} (#{open.rollout_id}, started {open.created_at:HH:mm} UTC). Watch it under Rollouts, or cancel it first.");

            var resolved = await _repo.ResolveDevicesAsync(request.DeviceIds);
            var (known, unknown) = SplitKnown(request.DeviceIds, resolved);

            var waveMinutes = RolloutPlanner.ClampWaveMinutes(request.Rollout?.WaveMinutes);
            var plan = RolloutPlanner.Plan(known, DateTime.UtcNow, waveMinutes);
            var waves = plan.Count == 0 ? 0 : plan.Max(p => p.WaveNo);
            if (waves < 2) return null;

            var schedule = request.ToSchedule();
            var rolloutId = await _repo.CreateAsync(playlist, waveMinutes, schedule, userId, plan);
            _logger.LogInformation("[Rollout] #{Id} created for playlist {Playlist}: {Devices} screens in {Waves} branches, one every {Minutes} min{Unknown}.",
                rolloutId, playlist.playlist_uuid, plan.Count, waves, waveMinutes, unknown.Count > 0 ? $"; {unknown.Count} selected id(s) matched no live screen" : "");

            var first = await _repo.GetWaveItemsAsync(rolloutId, 1, RolloutPlanner.MaxAttempts);
            var (applied, failed) = await ApplyItemsAsync(first, playlist.playlist_uuid, schedule, ct);
            _logger.LogInformation("[Rollout] #{Id} wave 1/{Waves} branch {Branch}: {Applied} assigned, {Failed} failed.",
                rolloutId, waves, plan[0].BranchCode, applied, failed);

            return new RolloutStartResult
            {
                RolloutId = rolloutId,
                Waves = waves,
                TotalDevices = plan.Count,
                WaveMinutes = waveMinutes,
                FirstBranch = plan[0].BranchCode,
                FirstWaveDevices = first.Count,
                FirstWaveApplied = applied,
                FirstWaveFailed = failed,
                LastWaveUtc = plan.Max(p => p.NotBeforeUtc),
                UnknownDevices = unknown,
            };
        }

        /// <summary>
        /// Matches the request's public device ids (numeric or uuid) with the live rows found for them.
        /// Ids that matched nothing are returned separately so the caller can report them instead of
        /// dropping them silently.
        /// </summary>
        internal static (List<(long DeviceId, string? BranchCode)> Known, List<string> Unknown) SplitKnown(IEnumerable<string> requestIds, IReadOnlyList<DeviceBranchRow> resolved)
        {
            var byNumeric = resolved.ToDictionary(r => r.device_id);
            var byUuid = resolved.Where(r => !string.IsNullOrEmpty(r.device_uuid)).GroupBy(r => r.device_uuid!, StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
            var known = new List<(long, string?)>();
            var unknown = new List<string>();
            foreach (var raw in requestIds)
            {
                var key = (raw ?? string.Empty).Trim();
                if (key.Length == 0) continue;
                DeviceBranchRow? row = null;
                if (long.TryParse(key, out var n)) byNumeric.TryGetValue(n, out row);
                if (row == null) byUuid.TryGetValue(key, out row);
                if (row == null) unknown.Add(key);
                else known.Add((row.device_id, row.branch_code));
            }
            return (known, unknown);
        }

        /// <summary>
        /// One worker pass: finish rollouts that have nothing left, then release due waves. Per rollout
        /// at most ONE wave that has not started yet is released per pass (so a resumed or restarted
        /// rollout still paces itself), and a new wave waits while <paramref name="egressWaiting"/>
        /// screens are queued for a download slot (bounded by <see cref="RolloutPlanner.MaxHold"/>).
        /// Each item is claimed before it is assigned, so a pause/cancel stops the rest at once.
        /// Returns the number of screens assigned in this pass.
        /// </summary>
        public async Task<int> RunDuePassAsync(DateTime nowUtc, int egressWaiting, CancellationToken ct)
        {
            var closed = await _repo.CloseFinishedAsync(RolloutPlanner.MaxAttempts);
            if (closed > 0) _logger.LogInformation("[Rollout] {Count} rollout(s) finished.", closed);

            var due = await _repo.GetDueItemsAsync(nowUtc, RolloutPlanner.MaxAttempts, 500);
            if (due.Count == 0) return 0;

            var total = 0;
            foreach (var byRollout in due.GroupBy(i => i.rollout_id))
            {
                if (ct.IsCancellationRequested) break;
                var header = await _repo.GetAsync(byRollout.Key);
                if (header == null || header.status != StatusActive) continue;
                var schedule = header.Schedule();
                var startedNewWave = false;

                foreach (var wave in byRollout.GroupBy(i => i.wave_no).OrderBy(g => g.Key))
                {
                    var items = wave.ToList();
                    var waveStarted = items.Any(i => i.wave_started);
                    if (!waveStarted)
                    {
                        if (startedNewWave) break;   // one fresh wave per rollout per pass
                        var notBefore = items.Min(i => i.not_before_utc);
                        if (RolloutPlanner.DecideWaveStart(false, egressWaiting, notBefore, nowUtc) == RolloutPlanner.WaveDecision.Hold)
                        {
                            var note = $"Holding wave {wave.Key} ({items[0].branch_code}): {egressWaiting} download(s) still queued from the previous branches.";
                            await _repo.SetHoldNoteAsync(byRollout.Key, note);
                            _logger.LogInformation("[Rollout] #{Id} {Note}", byRollout.Key, note);
                            break;   // later waves of this rollout wait too
                        }
                        // Keep the configured spacing from THIS release: after a hold, a pause or a restart the
                        // later waves would otherwise all be overdue and go out one per 30-second pass. Done
                        // under the header lock with a fresh timestamp; false = paused/cancelled meanwhile, so
                        // this rollout is left alone (its items would refuse the claim anyway).
                        if (!await _repo.RetimeWavesAfterAsync(byRollout.Key, wave.Key, DateTime.UtcNow)) break;
                        startedNewWave = true;
                        await _repo.SetHoldNoteAsync(byRollout.Key, null);
                        _logger.LogInformation("[Rollout] #{Id} wave {Wave} branch {Branch}: releasing {Count} screen(s).", byRollout.Key, wave.Key, items[0].branch_code, items.Count);
                    }
                    var (applied, failed) = await ApplyItemsAsync(items, header.playlist_uuid, schedule, ct);
                    total += applied;
                    if (failed > 0)
                        _logger.LogWarning("[Rollout] #{Id} wave {Wave} branch {Branch}: {Failed} screen(s) failed this attempt.", byRollout.Key, wave.Key, items[0].branch_code, failed);
                }
            }

            if (total > 0) await _repo.CloseFinishedAsync(RolloutPlanner.MaxAttempts);
            return total;
        }

        /// <summary>
        /// Claims, assigns and verifies each item. "Applied" means the assignment row is really there
        /// afterwards (the assignment repository skips an unknown playlist silently, so the write is read
        /// back). Items another path claimed first, or that a pause/cancel closed, are skipped. A caller
        /// that stalled past the claim lease can no longer record an outcome (its token is stale); the
        /// assignment itself is idempotent (one entry per playlist per screen), so an overlap is harmless.
        /// </summary>
        private async Task<(int applied, int failed)> ApplyItemsAsync(IReadOnlyList<RolloutItemRow> items, string playlistUuid, PlaylistScheduleFields schedule, CancellationToken ct)
        {
            int applied = 0, failed = 0;
            var options = new ParallelOptions { MaxDegreeOfParallelism = ApplyParallelism, CancellationToken = ct };
            await Parallel.ForEachAsync(items, options, async (item, token) =>
            {
                var claim = await _repo.TryClaimAsync(item.item_id, RolloutPlanner.MaxAttempts);
                if (claim is null) return;
                var deviceId = item.device_id.ToString();
                try
                {
                    await _devices.AssignPlaylistAsync(deviceId, playlistUuid, schedule);
                    var now = (await _devices.GetAssignedPlaylistsAsync(deviceId)).ToList();
                    if (!now.Any(p => string.Equals(p.PlaylistId, playlistUuid, StringComparison.OrdinalIgnoreCase)))
                        throw new InvalidOperationException("the assignment was not stored (device or playlist no longer exists)");
                    await _repo.MarkAppliedAsync(item.item_id, claim.Value, DateTime.UtcNow);
                    Interlocked.Increment(ref applied);
                }
                catch (OperationCanceledException) when (token.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    await _repo.MarkFailedAsync(item.item_id, claim.Value, ex.Message);
                    Interlocked.Increment(ref failed);
                    _logger.LogWarning(ex, "[Rollout] item {Item} device {Device}: assignment failed (attempt {Attempt}).", item.item_id, item.device_id, item.attempts + 1);
                }
            });
            return (applied, failed);
        }

        public async Task<IReadOnlyList<RolloutDto>> ListAsync(string? playlistId, DateTime nowUtc)
        {
            long? pid = null;
            if (!string.IsNullOrWhiteSpace(playlistId))
            {
                var playlist = await _repo.ResolvePlaylistAsync(playlistId);
                if (playlist == null) return Array.Empty<RolloutDto>();
                pid = playlist.playlist_id;
            }
            var headers = await _repo.ListAsync(pid, nowUtc.AddHours(-24));
            var waves = await _repo.GetWavesAsync(headers.Select(h => h.rollout_id));
            return headers.Select(h => ToDto(h, waves.Where(w => w.rollout_id == h.rollout_id).OrderBy(w => w.wave_no).ToList())).ToList();
        }

        internal static RolloutDto ToDto(RolloutHeaderRow h, List<RolloutWaveRow> waves)
        {
            var dto = new RolloutDto
            {
                RolloutId = h.rollout_id,
                PlaylistId = h.playlist_uuid,
                PlaylistName = h.playlist_name,
                Status = h.status,
                WaveMinutes = h.wave_minutes,
                HoldNote = h.status == StatusActive ? h.hold_note : null,
                CreatedUtc = h.created_at,
                UpdatedUtc = h.updated_at,
                StartDate = h.start_date,
                EndDate = h.end_date,
                StartTime = h.start_time,
                EndTime = h.end_time,
                DaysOfWeek = h.days_of_week,
                RepeatEveryMinutes = h.repeat_every_minutes,
                WaveCount = waves.Count,
            };
            foreach (var w in waves)
            {
                var done = w.applied + w.failed >= w.devices;
                dto.Waves.Add(new RolloutWaveDto
                {
                    WaveNo = w.wave_no, BranchCode = w.branch_code, Devices = w.devices, Applied = w.applied, Failed = w.failed,
                    NotBeforeUtc = w.not_before_utc, Started = w.started, Done = done,
                });
                dto.TotalDevices += w.devices;
                dto.AppliedDevices += w.applied;
                dto.FailedDevices += w.failed;
                if (done) dto.WavesDone++;
            }
            var next = dto.Waves.FirstOrDefault(w => !w.Started);
            if (next != null && (h.status == StatusActive || h.status == StatusPaused))
            {
                dto.NextWaveUtc = next.NotBeforeUtc;
                dto.NextBranch = next.BranchCode;
            }
            return dto;
        }

        /// <summary>Stops every claim from now on; the handful of screens being assigned at this second finish.</summary>
        public Task<bool> PauseAsync(long rolloutId) => _repo.SetStatusAsync(rolloutId, new[] { StatusActive }, StatusPaused);

        /// <summary>Back to active; the waves not yet started are re-timed from now, one per wave interval.</summary>
        public Task<bool> ResumeAsync(long rolloutId, DateTime nowUtc) => _repo.ResumeAsync(rolloutId, nowUtc);

        /// <summary>Stops the waves that have not been released; screens already assigned keep the playlist.</summary>
        public Task<bool> CancelAsync(long rolloutId) => _repo.SetStatusAsync(rolloutId, new[] { StatusActive, StatusPaused }, StatusCancelled);
    }
}
