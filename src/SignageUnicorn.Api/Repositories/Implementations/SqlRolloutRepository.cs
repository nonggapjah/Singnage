using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Dapper;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Repositories.Interfaces;
using SignageUnicorn.Api.Services.Rollout;

namespace SignageUnicorn.Api.Repositories.Implementations
{
    /// <summary>
    /// Plain Dapper SQL over sn_playlist_rollouts / sn_playlist_rollout_items (API 2.8.14). The two
    /// tables are created by docs/db_template/table/PLAYLIST_ROLLOUTS.sql on API start.
    /// </summary>
    public sealed class SqlRolloutRepository : IRolloutRepository
    {
        private readonly string _connectionString;

        public SqlRolloutRepository(IConfiguration configuration)
        {
            _connectionString = configuration.GetConnectionString("DefaultConnection") ?? throw new InvalidOperationException("Connection string 'DefaultConnection' not found.");
        }

        private SqlConnection Open() => new(_connectionString);

        public async Task<PlaylistRefRow?> ResolvePlaylistAsync(string publicId)
        {
            var key = (publicId ?? string.Empty).Trim();
            if (key.Length == 0) return null;
            long? numeric = long.TryParse(key, out var n) ? n : null;
            using var c = Open();
            // Same rule as sp_device_std / UpdateAssignedPlaylists: the public id is the uuid, but the
            // numeric key is still accepted for older callers.
            return await c.QueryFirstOrDefaultAsync<PlaylistRefRow>(
                "SELECT TOP 1 playlist_id, playlist_uuid, playlist_name FROM dbo.sn_playlists WHERE is_deleted = 0 AND (playlist_uuid = @key OR playlist_id = @numeric)",
                new { key, numeric });
        }

        public async Task<IReadOnlyList<DeviceBranchRow>> ResolveDevicesAsync(IEnumerable<string> publicIds)
        {
            var keys = publicIds.Select(k => (k ?? string.Empty).Trim()).Where(k => k.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            if (keys.Count == 0) return Array.Empty<DeviceBranchRow>();
            var numeric = keys.Select(k => long.TryParse(k, out var n) ? n : (long?)null).Where(n => n.HasValue).Select(n => n!.Value).ToList();
            var uuids = keys.Where(k => !long.TryParse(k, out _)).ToList();
            if (numeric.Count == 0) numeric.Add(-1);           // Dapper cannot expand an empty list
            if (uuids.Count == 0) uuids.Add("-");
            using var c = Open();
            var rows = await c.QueryAsync<DeviceBranchRow>(
                "SELECT device_id, device_uuid, branch_code FROM dbo.sn_devices WHERE is_deleted = 0 AND (device_id IN @numeric OR device_uuid IN @uuids)",
                new { numeric, uuids });
            return rows.ToList();
        }

        public async Task<long> CreateAsync(PlaylistRefRow playlist, int waveMinutes, PlaylistScheduleFields s, long? createdBy, IReadOnlyList<RolloutPlanItem> items)
        {
            using var c = Open();
            await c.OpenAsync();
            using var tx = c.BeginTransaction();
            var rolloutId = await c.ExecuteScalarAsync<long>(@"
                INSERT INTO dbo.sn_playlist_rollouts
                    (playlist_id, playlist_uuid, status, wave_minutes, start_date, end_date, start_time, end_time, days_of_week, repeat_every_minutes, created_by)
                OUTPUT INSERTED.rollout_id
                VALUES (@playlistId, @playlistUuid, 'active', @waveMinutes, @StartDate, @EndDate, @StartTime, @EndTime, @DaysOfWeek, @RepeatEveryMinutes, @createdBy)",
                new { playlistId = playlist.playlist_id, playlistUuid = playlist.playlist_uuid, waveMinutes, s.StartDate, s.EndDate, s.StartTime, s.EndTime, s.DaysOfWeek, s.RepeatEveryMinutes, createdBy }, tx);

            await c.ExecuteAsync(@"
                INSERT INTO dbo.sn_playlist_rollout_items (rollout_id, device_id, branch_code, wave_no, not_before_utc)
                VALUES (@rolloutId, @DeviceId, @BranchCode, @WaveNo, @NotBeforeUtc)",
                items.Select(i => new { rolloutId, i.DeviceId, i.BranchCode, i.WaveNo, i.NotBeforeUtc }), tx);

            tx.Commit();
            return rolloutId;
        }

        private const string ItemColumns = @"
            i.item_id, i.rollout_id, r.playlist_id, r.playlist_uuid, i.device_id, i.branch_code, i.wave_no, i.not_before_utc, i.applied_utc, i.attempts, i.last_error,
            CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.sn_playlist_rollout_items w
                                   WHERE w.rollout_id = i.rollout_id AND w.wave_no = i.wave_no
                                     AND (w.attempts > 0 OR w.applied_utc IS NOT NULL)) THEN 1 ELSE 0 END AS BIT) AS wave_started";

        public async Task<IReadOnlyList<RolloutItemRow>> GetDueItemsAsync(DateTime nowUtc, int maxAttempts, int take)
        {
            using var c = Open();
            var rows = await c.QueryAsync<RolloutItemRow>($@"
                SELECT TOP (@take) {ItemColumns}
                FROM dbo.sn_playlist_rollout_items i
                JOIN dbo.sn_playlist_rollouts r ON r.rollout_id = i.rollout_id
                WHERE r.status = 'active' AND i.applied_utc IS NULL AND i.attempts < @maxAttempts AND i.not_before_utc <= @nowUtc
                  AND (i.claimed_utc IS NULL OR i.claimed_utc < DATEADD(SECOND, -@leaseSeconds, SYSUTCDATETIME()))
                ORDER BY i.rollout_id, i.wave_no, i.item_id", new { take, maxAttempts, nowUtc, leaseSeconds = (int)ClaimLease.TotalSeconds });
            return rows.ToList();
        }

        public async Task<IReadOnlyList<RolloutItemRow>> GetWaveItemsAsync(long rolloutId, int waveNo, int maxAttempts)
        {
            using var c = Open();
            var rows = await c.QueryAsync<RolloutItemRow>($@"
                SELECT {ItemColumns}
                FROM dbo.sn_playlist_rollout_items i
                JOIN dbo.sn_playlist_rollouts r ON r.rollout_id = i.rollout_id
                WHERE i.rollout_id = @rolloutId AND i.wave_no = @waveNo AND i.applied_utc IS NULL AND i.attempts < @maxAttempts
                  AND (i.claimed_utc IS NULL OR i.claimed_utc < DATEADD(SECOND, -@leaseSeconds, SYSUTCDATETIME()))
                ORDER BY i.item_id", new { rolloutId, waveNo, maxAttempts, leaseSeconds = (int)ClaimLease.TotalSeconds });
            return rows.ToList();
        }

        /// <summary>How long a claim keeps other callers off the item. An assignment takes seconds; a worker
        /// that died mid-way loses its lease after this and the item is retried.</summary>
        public static readonly TimeSpan ClaimLease = TimeSpan.FromMinutes(5);

        public async Task<Guid?> TryClaimAsync(long itemId, int maxAttempts)
        {
            using var c = Open();
            // One UPDATE, one winner: the attempt counter goes up, claimed_utc becomes a lease and
            // claim_token fences the outcome, so a second caller (the worker racing the inline wave 1,
            // two worker passes, or a caller that stalled past the lease) is refused or, once the lease
            // has expired and someone else re-claimed, can no longer record anything (Codex pass 3).
            // The status check in the same statement is what makes pause/cancel take effect for every
            // item not yet claimed. MarkFailed releases the lease for the next pass.
            var token = Guid.NewGuid();
            var n = await c.ExecuteAsync(@"
                UPDATE i SET i.attempts = i.attempts + 1, i.claimed_utc = SYSUTCDATETIME(), i.claim_token = @token
                FROM dbo.sn_playlist_rollout_items i
                JOIN dbo.sn_playlist_rollouts r ON r.rollout_id = i.rollout_id
                WHERE i.item_id = @itemId AND i.applied_utc IS NULL AND i.attempts < @maxAttempts AND r.status = 'active'
                  AND (i.claimed_utc IS NULL OR i.claimed_utc < DATEADD(SECOND, -@leaseSeconds, SYSUTCDATETIME()))",
                new { itemId, token, maxAttempts, leaseSeconds = (int)ClaimLease.TotalSeconds });
            return n == 1 ? token : null;
        }

        public async Task MarkAppliedAsync(long itemId, Guid token, DateTime appliedUtc)
        {
            using var c = Open();
            await c.ExecuteAsync(@"
                UPDATE dbo.sn_playlist_rollout_items SET applied_utc = @appliedUtc, last_error = NULL
                WHERE item_id = @itemId AND claim_token = @token AND applied_utc IS NULL
                  AND claimed_utc >= DATEADD(SECOND, -@leaseSeconds, SYSUTCDATETIME());
                IF @@ROWCOUNT = 1
                    UPDATE r SET r.updated_at = SYSUTCDATETIME() FROM dbo.sn_playlist_rollouts r JOIN dbo.sn_playlist_rollout_items i ON i.rollout_id = r.rollout_id WHERE i.item_id = @itemId;",
                new { itemId, token, appliedUtc, leaseSeconds = (int)ClaimLease.TotalSeconds });
        }

        public async Task MarkFailedAsync(long itemId, Guid token, string error)
        {
            var msg = error.Length > 400 ? error[..400] : error;
            using var c = Open();
            await c.ExecuteAsync(@"
                UPDATE dbo.sn_playlist_rollout_items SET last_error = @msg, claimed_utc = NULL
                WHERE item_id = @itemId AND claim_token = @token AND applied_utc IS NULL
                  AND claimed_utc >= DATEADD(SECOND, -@leaseSeconds, SYSUTCDATETIME());
                IF @@ROWCOUNT = 1
                    UPDATE r SET r.updated_at = SYSUTCDATETIME() FROM dbo.sn_playlist_rollouts r JOIN dbo.sn_playlist_rollout_items i ON i.rollout_id = r.rollout_id WHERE i.item_id = @itemId;",
                new { itemId, token, msg, leaseSeconds = (int)ClaimLease.TotalSeconds });
        }

        public async Task<int> CloseFinishedAsync(int maxAttempts)
        {
            using var c = Open();
            return await c.ExecuteAsync(@"
                UPDATE r SET r.status = 'done', r.hold_note = NULL, r.updated_at = SYSUTCDATETIME()
                FROM dbo.sn_playlist_rollouts r
                WHERE r.status = 'active'
                  AND NOT EXISTS (SELECT 1 FROM dbo.sn_playlist_rollout_items i
                                  WHERE i.rollout_id = r.rollout_id AND i.applied_utc IS NULL
                                    AND (i.attempts < @maxAttempts OR (i.claimed_utc IS NOT NULL AND i.claimed_utc >= DATEADD(SECOND, -@leaseSeconds, SYSUTCDATETIME()))))",
                new { maxAttempts, leaseSeconds = (int)ClaimLease.TotalSeconds });
        }

        public async Task SetHoldNoteAsync(long rolloutId, string? note)
        {
            using var c = Open();
            await c.ExecuteAsync(@"
                UPDATE dbo.sn_playlist_rollouts SET hold_note = @note, updated_at = SYSUTCDATETIME()
                WHERE rollout_id = @rolloutId AND status = 'active' AND ISNULL(hold_note, '') <> ISNULL(@note, '')", new { rolloutId, note });
        }

        private const string HeaderColumns = @"
            r.rollout_id, r.playlist_id, r.playlist_uuid, p.playlist_name, r.status, r.wave_minutes, r.start_date, r.end_date, r.start_time, r.end_time,
            r.days_of_week, r.repeat_every_minutes, r.hold_note, r.created_by, r.created_at, r.updated_at";

        public async Task<IReadOnlyList<RolloutHeaderRow>> ListAsync(long? playlistId, DateTime finishedSinceUtc)
        {
            using var c = Open();
            var rows = await c.QueryAsync<RolloutHeaderRow>($@"
                SELECT {HeaderColumns}
                FROM dbo.sn_playlist_rollouts r
                LEFT JOIN dbo.sn_playlists p ON p.playlist_id = r.playlist_id
                WHERE (@playlistId IS NULL OR r.playlist_id = @playlistId)
                  AND (r.status IN ('active', 'paused') OR r.updated_at >= @finishedSinceUtc)
                ORDER BY CASE r.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, r.created_at DESC",
                new { playlistId, finishedSinceUtc });
            return rows.ToList();
        }

        public async Task<RolloutHeaderRow?> GetAsync(long rolloutId)
        {
            using var c = Open();
            return await c.QueryFirstOrDefaultAsync<RolloutHeaderRow>($@"
                SELECT {HeaderColumns}
                FROM dbo.sn_playlist_rollouts r LEFT JOIN dbo.sn_playlists p ON p.playlist_id = r.playlist_id
                WHERE r.rollout_id = @rolloutId", new { rolloutId });
        }

        public async Task<IReadOnlyList<RolloutWaveRow>> GetWavesAsync(IEnumerable<long> rolloutIds)
        {
            var ids = rolloutIds.Distinct().ToList();
            if (ids.Count == 0) return Array.Empty<RolloutWaveRow>();
            using var c = Open();
            var rows = await c.QueryAsync<RolloutWaveRow>(@"
                SELECT i.rollout_id, i.wave_no, MIN(i.branch_code) AS branch_code,
                       COUNT(*) AS devices,
                       SUM(CASE WHEN i.applied_utc IS NOT NULL THEN 1 ELSE 0 END) AS applied,
                       SUM(CASE WHEN i.applied_utc IS NULL AND i.attempts >= @maxAttempts
                                     AND NOT (i.claimed_utc IS NOT NULL AND i.claimed_utc >= DATEADD(SECOND, -@leaseSeconds, SYSUTCDATETIME())) THEN 1 ELSE 0 END) AS failed,
                       MIN(i.not_before_utc) AS not_before_utc,
                       CAST(MAX(CASE WHEN i.attempts > 0 OR i.applied_utc IS NOT NULL THEN 1 ELSE 0 END) AS BIT) AS started
                FROM dbo.sn_playlist_rollout_items i
                WHERE i.rollout_id IN @ids
                GROUP BY i.rollout_id, i.wave_no
                ORDER BY i.rollout_id, i.wave_no", new { ids, maxAttempts = RolloutPlanner.MaxAttempts, leaseSeconds = (int)ClaimLease.TotalSeconds });
            return rows.ToList();
        }

        public async Task<bool> SetStatusAsync(long rolloutId, string[] fromStatuses, string toStatus)
        {
            using var c = Open();
            var n = await c.ExecuteAsync(@"
                UPDATE dbo.sn_playlist_rollouts SET status = @toStatus, hold_note = NULL, updated_at = SYSUTCDATETIME()
                WHERE rollout_id = @rolloutId AND status IN @fromStatuses", new { rolloutId, fromStatuses, toStatus });
            return n > 0;
        }

        public async Task<bool> ResumeAsync(long rolloutId, DateTime nowUtc)
        {
            using var c = Open();
            await c.OpenAsync();
            using var tx = c.BeginTransaction();
            // The status flip comes first and locks the header row, so two resumes (or a resume racing a
            // worker pass) cannot both re-time the waves; nothing is written when it was not paused.
            var flipped = await c.ExecuteAsync(@"
                UPDATE dbo.sn_playlist_rollouts SET status = 'active', hold_note = NULL, updated_at = SYSUTCDATETIME()
                WHERE rollout_id = @rolloutId AND status = 'paused'", new { rolloutId }, tx);
            if (flipped != 1) { tx.Rollback(); return false; }

            var waveMinutes = await c.ExecuteScalarAsync<int>("SELECT wave_minutes FROM dbo.sn_playlist_rollouts WHERE rollout_id = @rolloutId", new { rolloutId }, tx);
            var unstarted = (await c.QueryAsync<int>(@"
                SELECT i.wave_no FROM dbo.sn_playlist_rollout_items i
                WHERE i.rollout_id = @rolloutId
                GROUP BY i.wave_no
                HAVING MAX(CASE WHEN i.attempts > 0 OR i.applied_utc IS NOT NULL THEN 1 ELSE 0 END) = 0
                ORDER BY i.wave_no", new { rolloutId }, tx)).ToList();
            foreach (var (waveNo, notBefore) in RolloutPlanner.Reschedule(unstarted, nowUtc, waveMinutes))
            {
                await c.ExecuteAsync(@"
                    UPDATE dbo.sn_playlist_rollout_items SET not_before_utc = @notBefore
                    WHERE rollout_id = @rolloutId AND wave_no = @waveNo AND applied_utc IS NULL",
                    new { rolloutId, waveNo, notBefore }, tx);
            }
            tx.Commit();
            return true;
        }
    }
}
