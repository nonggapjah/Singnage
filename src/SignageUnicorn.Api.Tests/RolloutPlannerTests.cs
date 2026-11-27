using System;
using System.Collections.Generic;
using System.Linq;
using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Services.Rollout;
using Xunit;

namespace SignageUnicorn.Api.Tests
{
    // Branch-by-branch playlist rollout (API 2.8.14): planning, ordering, pacing and status mapping.
    public class RolloutPlannerTests
    {
        private static readonly DateTime T0 = new(2026, 11, 27, 3, 0, 0, DateTimeKind.Utc);

        [Fact]
        public void PlanGroupsByBranchInNaturalOrderWithUnassignedLast()
        {
            var devices = new List<(long, string?)>
            {
                (10, "MUSIC"), (11, "1021"), (12, "1003"), (13, " 1003 "), (14, null), (15, ""), (16, "1021A"), (17, "music"),
            };
            var plan = RolloutPlanner.Plan(devices, T0, 10);

            var waves = plan.GroupBy(p => p.WaveNo).OrderBy(g => g.Key).Select(g => (g.Key, g.First().BranchCode, g.Count())).ToList();
            Assert.Equal(new[] { (1, "1003", 2), (2, "1021", 1), (3, "1021A", 1), (4, "MUSIC", 2), (5, RolloutPlanner.UnassignedBranch, 2) }, waves);
            // Branch code comparison is case-insensitive, but the stored code is the first spelling seen.
            Assert.All(plan.Where(p => p.WaveNo == 4), p => Assert.Equal("MUSIC", p.BranchCode));
        }

        [Fact]
        public void PlanTimesWavesFromNowAndDedupesDevices()
        {
            var plan = RolloutPlanner.Plan(new List<(long, string?)> { (1, "A"), (1, "A"), (2, "B"), (3, "C") }, T0, 15);
            Assert.Equal(3, plan.Count);
            Assert.Equal(T0, plan.Single(p => p.DeviceId == 1).NotBeforeUtc);
            Assert.Equal(T0.AddMinutes(15), plan.Single(p => p.DeviceId == 2).NotBeforeUtc);
            Assert.Equal(T0.AddMinutes(30), plan.Single(p => p.DeviceId == 3).NotBeforeUtc);
        }

        [Fact]
        public void PlanRejectsIntervalOutsideRangeAndClampHelperFixesIt()
        {
            Assert.Throws<ArgumentOutOfRangeException>(() => RolloutPlanner.Plan(new List<(long, string?)> { (1, "A") }, T0, 2));
            Assert.Equal(RolloutPlanner.DefaultWaveMinutes, RolloutPlanner.ClampWaveMinutes(null));
            Assert.Equal(RolloutPlanner.MinWaveMinutes, RolloutPlanner.ClampWaveMinutes(0));
            Assert.Equal(RolloutPlanner.MaxWaveMinutes, RolloutPlanner.ClampWaveMinutes(999));
            Assert.Equal(30, RolloutPlanner.ClampWaveMinutes(30));
        }

        [Fact]
        public void SingleBranchPlanHasOneWave()
        {
            var plan = RolloutPlanner.Plan(new List<(long, string?)> { (1, "A"), (2, "a") }, T0, 10);
            Assert.All(plan, p => Assert.Equal(1, p.WaveNo));
        }

        [Theory]
        [InlineData("1003", "1021", -1)]
        [InlineData("1021", "1021A", -1)]
        [InlineData("1021", "MUSIC", -1)]
        [InlineData("MUSIC", "MUSIC1", -1)]
        [InlineData("music", "MUSIC", 0)]
        [InlineData("0100", "100", 0)]
        [InlineData("9", "10", -1)]
        public void NaturalComparerOrdersDigitsAsNumbers(string a, string b, int expectedSign)
        {
            Assert.Equal(expectedSign, Math.Sign(RolloutPlanner.NaturalComparer.Instance.Compare(a, b)));
            Assert.Equal(-expectedSign, Math.Sign(RolloutPlanner.NaturalComparer.Instance.Compare(b, a)));
        }

        [Fact]
        public void NewWaveHoldsWhileDownloadsQueueButNotForever()
        {
            var due = T0;
            Assert.Equal(RolloutPlanner.WaveDecision.Apply, RolloutPlanner.DecideWaveStart(false, 0, due, T0));
            Assert.Equal(RolloutPlanner.WaveDecision.Hold, RolloutPlanner.DecideWaveStart(false, 12, due, T0));
            Assert.Equal(RolloutPlanner.WaveDecision.Hold, RolloutPlanner.DecideWaveStart(false, 12, due, T0 + RolloutPlanner.MaxHold - TimeSpan.FromSeconds(1)));
            Assert.Equal(RolloutPlanner.WaveDecision.Apply, RolloutPlanner.DecideWaveStart(false, 12, due, T0 + RolloutPlanner.MaxHold));
            // A wave that already started keeps going whatever the queue looks like.
            Assert.Equal(RolloutPlanner.WaveDecision.Apply, RolloutPlanner.DecideWaveStart(true, 999, due, T0));
        }

        [Fact]
        public void RescheduleSpacesUnstartedWavesFromNow()
        {
            var r = RolloutPlanner.Reschedule(new[] { 5, 3, 4, 4 }, T0, 10);
            Assert.Equal(3, r.Count);
            Assert.Equal(T0, r[3]);
            Assert.Equal(T0.AddMinutes(10), r[4]);
            Assert.Equal(T0.AddMinutes(20), r[5]);
            Assert.Empty(RolloutPlanner.Reschedule(Array.Empty<int>(), T0, 10));
        }

        [Fact]
        public void DtoAggregatesWavesAndPointsAtTheNextUnstartedOne()
        {
            var header = new RolloutHeaderRow { rollout_id = 7, playlist_id = 42, playlist_uuid = "pl-uuid-42", playlist_name = "Monthly", status = "active", wave_minutes = 10, hold_note = "Holding wave 3", created_at = T0, updated_at = T0 };
            var waves = new List<RolloutWaveRow>
            {
                new() { rollout_id = 7, wave_no = 1, branch_code = "1003", devices = 3, applied = 3, failed = 0, not_before_utc = T0, started = true },
                new() { rollout_id = 7, wave_no = 2, branch_code = "1021", devices = 4, applied = 2, failed = 1, not_before_utc = T0.AddMinutes(10), started = true },
                new() { rollout_id = 7, wave_no = 3, branch_code = "MUSIC", devices = 2, applied = 0, failed = 0, not_before_utc = T0.AddMinutes(20), started = false },
            };
            var dto = RolloutService.ToDto(header, waves);
            Assert.Equal("pl-uuid-42", dto.PlaylistId);   // the public id, as the web and the screens know it
            Assert.Equal(9, dto.TotalDevices);
            Assert.Equal(5, dto.AppliedDevices);
            Assert.Equal(1, dto.FailedDevices);
            Assert.Equal(3, dto.WaveCount);
            Assert.Equal(1, dto.WavesDone);               // wave 2 still has one pending screen
            Assert.Equal("MUSIC", dto.NextBranch);
            Assert.Equal(T0.AddMinutes(20), dto.NextWaveUtc);
            Assert.Equal("Holding wave 3", dto.HoldNote);

            header.status = "cancelled";
            var cancelled = RolloutService.ToDto(header, waves);
            Assert.Null(cancelled.NextBranch);
            Assert.Null(cancelled.HoldNote);
        }

        [Fact]
        public void SplitKnownMatchesNumericAndUuidIdsAndReportsTheRest()
        {
            var resolved = new List<DeviceBranchRow>
            {
                new() { device_id = 10, device_uuid = "AAAA-1", branch_code = "1003" },
                new() { device_id = 11, device_uuid = "BBBB-2", branch_code = null },
            };
            var (known, unknown) = RolloutService.SplitKnown(new[] { "10", "bbbb-2", " 10 ", "99", "", "CCCC-3" }, resolved);
            Assert.Equal(new[] { (10L, "1003"), (11L, (string?)null), (10L, "1003") }, known);
            Assert.Equal(new[] { "99", "CCCC-3" }, unknown);
        }

        [Fact]
        public void BatchRequestWithoutRolloutBlockIsUnchanged()
        {
            var req = System.Text.Json.JsonSerializer.Deserialize<BatchAddScheduleRequest>("{\"deviceIds\":[\"1\"],\"playlistId\":\"2\"}")!;
            Assert.Null(req.Rollout);
            var withRollout = System.Text.Json.JsonSerializer.Deserialize<BatchAddScheduleRequest>("{\"deviceIds\":[\"1\"],\"playlistId\":\"2\",\"rollout\":{\"byBranch\":true,\"waveMinutes\":15}}")!;
            Assert.True(withRollout.Rollout!.ByBranch);
            Assert.Equal(15, withRollout.Rollout.WaveMinutes);
        }
    }
}
