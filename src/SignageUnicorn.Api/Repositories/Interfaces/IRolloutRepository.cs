using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using SignageUnicorn.Api.Models;

namespace SignageUnicorn.Api.Repositories.Interfaces
{
    /// <summary>Storage of branch-by-branch playlist rollouts (sn_playlist_rollouts + _items, API 2.8.14).</summary>
    public interface IRolloutRepository
    {
        /// <summary>The playlist behind a public id (uuid, or the numeric id older callers use); null when it does not exist.</summary>
        Task<PlaylistRefRow?> ResolvePlaylistAsync(string publicId);

        /// <summary>The live devices behind public ids (numeric id or uuid), with their branch. Ids that match nothing are simply absent.</summary>
        Task<IReadOnlyList<DeviceBranchRow>> ResolveDevicesAsync(IEnumerable<string> publicIds);

        /// <exception cref="InvalidOperationException">An active or paused rollout of the playlist already exists (unique index).</exception>
        Task<long> CreateAsync(PlaylistRefRow playlist, int waveMinutes, PlaylistScheduleFields schedule, long? createdBy, IReadOnlyList<RolloutPlanItem> items);

        /// <summary>Pending items of active rollouts whose wave time has come, oldest wave first.</summary>
        Task<IReadOnlyList<RolloutItemRow>> GetDueItemsAsync(DateTime nowUtc, int maxAttempts, int take);

        /// <summary>Pending items of one wave (used right after creation for wave 1).</summary>
        Task<IReadOnlyList<RolloutItemRow>> GetWaveItemsAsync(long rolloutId, int waveNo, int maxAttempts);

        /// <summary>
        /// Takes one attempt on the item: succeeds only while the item is pending, under the attempt limit,
        /// not under another caller's lease (5 min) and its rollout is active. Whoever claims it (request
        /// or worker) is the only one applying it, and a pause or cancel stops every claim from that
        /// moment on. A failure releases the lease; a crash lets it expire.
        /// </summary>
        /// <returns>The claim token to pass to MarkApplied/MarkFailed, or null when the item could not be claimed.</returns>
        Task<Guid?> TryClaimAsync(long itemId, int maxAttempts);

        /// <summary>Records the outcome only while <paramref name="token"/> is still the item's current claim (a stale caller changes nothing).</summary>
        Task MarkAppliedAsync(long itemId, Guid token, DateTime appliedUtc);
        Task MarkFailedAsync(long itemId, Guid token, string error);

        /// <summary>Active rollouts with nothing left to do become 'done'. Returns how many.</summary>
        Task<int> CloseFinishedAsync(int maxAttempts);

        /// <summary>Records why the worker is not releasing the next wave (active rollouts only; null clears it).</summary>
        Task SetHoldNoteAsync(long rolloutId, string? note);

        /// <summary>Active/paused rollouts, plus finished ones updated since <paramref name="finishedSinceUtc"/>.</summary>
        Task<IReadOnlyList<RolloutHeaderRow>> ListAsync(long? playlistId, DateTime finishedSinceUtc);
        Task<RolloutHeaderRow?> GetAsync(long rolloutId);

        /// <summary>The active or paused rollout of this playlist, if any (one at a time per playlist).</summary>
        Task<RolloutHeaderRow?> GetOpenForPlaylistAsync(long playlistId);

        /// <summary>
        /// When wave <paramref name="startedWaveNo"/> is released at <paramref name="nowUtc"/>, the waves after it that
        /// have not started are re-timed to now + k * wave_minutes (k = 1, 2, ...), so the configured spacing
        /// holds after a hold, a pause or an API restart instead of all overdue waves going out one per pass.
        /// </summary>
        /// <returns>False when the rollout is no longer active (paused/cancelled meanwhile): nothing was changed.</returns>
        Task<bool> RetimeWavesAfterAsync(long rolloutId, int startedWaveNo, DateTime nowUtc);
        Task<IReadOnlyList<RolloutWaveRow>> GetWavesAsync(IEnumerable<long> rolloutIds);

        /// <summary>Changes the status only when the current one is in <paramref name="fromStatuses"/>. Returns false otherwise.</summary>
        Task<bool> SetStatusAsync(long rolloutId, string[] fromStatuses, string toStatus);

        /// <summary>
        /// paused -> active and, in the same transaction, re-times the waves that have not started so they
        /// still arrive one per interval from <paramref name="nowUtc"/>. False (and nothing changed) when
        /// the rollout was not paused.
        /// </summary>
        Task<bool> ResumeAsync(long rolloutId, DateTime nowUtc);
    }
}
