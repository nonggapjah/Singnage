using System;
using System.Collections.Generic;
using System.Linq;
using SignageUnicorn.Api.Models;

namespace SignageUnicorn.Api.Services.Rollout
{
    /// <summary>
    /// Pure planning and pacing rules of a branch-by-branch rollout (API 2.8.14). No I/O, so every
    /// rule is unit-tested: grouping, branch order, wave timing, and when the worker may start the
    /// next wave.
    /// </summary>
    public static class RolloutPlanner
    {
        public const int MinWaveMinutes = 5;
        public const int MaxWaveMinutes = 120;
        public const int DefaultWaveMinutes = 10;
        public const string UnassignedBranch = "UNASSIGNED";

        /// <summary>How many times the worker tries one screen before it gives up on it.</summary>
        public const int MaxAttempts = 3;

        /// <summary>
        /// A wave whose time has come is held while the egress queue is still busy with the previous
        /// branches, but never longer than this: a slow branch must not stall the whole campaign.
        /// </summary>
        public static readonly TimeSpan MaxHold = TimeSpan.FromMinutes(60);

        public static int ClampWaveMinutes(int? requested)
            => requested is null ? DefaultWaveMinutes : Math.Clamp(requested.Value, MinWaveMinutes, MaxWaveMinutes);

        public static string NormalizeBranch(string? code)
        {
            var c = (code ?? string.Empty).Trim();
            return c.Length == 0 ? UnassignedBranch : c;
        }

        /// <summary>
        /// Groups the screens by branch, orders the branches naturally (1003 before 1021 before MUSIC,
        /// UNASSIGNED last) and gives wave n the start time now + (n-1) * waveMinutes. Duplicate device
        /// ids are kept once. Wave 1 is the one the request applies at once.
        /// </summary>
        public static List<RolloutPlanItem> Plan(IEnumerable<(long DeviceId, string? BranchCode)> devices, DateTime nowUtc, int waveMinutes)
        {
            if (waveMinutes < MinWaveMinutes || waveMinutes > MaxWaveMinutes)
                throw new ArgumentOutOfRangeException(nameof(waveMinutes), waveMinutes, $"{MinWaveMinutes}..{MaxWaveMinutes}");

            var byBranch = new Dictionary<string, List<long>>(StringComparer.OrdinalIgnoreCase);
            var seen = new HashSet<long>();
            foreach (var (deviceId, code) in devices)
            {
                if (!seen.Add(deviceId)) continue;
                var branch = NormalizeBranch(code);
                if (!byBranch.TryGetValue(branch, out var list)) byBranch[branch] = list = new List<long>();
                list.Add(deviceId);
            }

            var order = byBranch.Keys
                .OrderBy(b => b.Equals(UnassignedBranch, StringComparison.OrdinalIgnoreCase) ? 1 : 0)
                .ThenBy(b => b, NaturalComparer.Instance)
                .ToList();

            var plan = new List<RolloutPlanItem>();
            for (var i = 0; i < order.Count; i++)
            {
                var waveNo = i + 1;
                var notBefore = nowUtc.AddMinutes((double)(waveNo - 1) * waveMinutes);
                foreach (var id in byBranch[order[i]].OrderBy(x => x))
                    plan.Add(new RolloutPlanItem(id, order[i], waveNo, notBefore));
            }
            return plan;
        }

        public enum WaveDecision { Apply, Hold }

        /// <summary>
        /// A wave that already has an attempted item always continues (its own downloads are what fill
        /// the queue). A new wave starts when nothing is waiting for a download slot, or when it has
        /// been held for <see cref="MaxHold"/>.
        /// </summary>
        public static WaveDecision DecideWaveStart(bool waveStarted, int egressWaiting, DateTime notBeforeUtc, DateTime nowUtc)
        {
            if (waveStarted) return WaveDecision.Apply;
            if (egressWaiting <= 0) return WaveDecision.Apply;
            return nowUtc - notBeforeUtc >= MaxHold ? WaveDecision.Apply : WaveDecision.Hold;
        }

        /// <summary>
        /// After a pause, the waves that have not started are re-timed from now so they still arrive one
        /// per <paramref name="waveMinutes"/> instead of all being overdue at once. The first unstarted
        /// wave is due immediately.
        /// </summary>
        public static Dictionary<int, DateTime> Reschedule(IEnumerable<int> unstartedWaveNos, DateTime nowUtc, int waveMinutes)
        {
            var result = new Dictionary<int, DateTime>();
            var k = 0;
            foreach (var waveNo in unstartedWaveNos.Distinct().OrderBy(w => w))
                result[waveNo] = nowUtc.AddMinutes((double)k++ * waveMinutes);
            return result;
        }

        /// <summary>"1003" &lt; "1021" &lt; "1021A" &lt; "MUSIC": digit runs compare as numbers, the rest case-insensitively.</summary>
        public sealed class NaturalComparer : IComparer<string>
        {
            public static readonly NaturalComparer Instance = new();

            public int Compare(string? x, string? y)
            {
                x ??= string.Empty; y ??= string.Empty;
                int i = 0, j = 0;
                while (i < x.Length && j < y.Length)
                {
                    if (char.IsDigit(x[i]) && char.IsDigit(y[j]))
                    {
                        var si = i; while (i < x.Length && char.IsDigit(x[i])) i++;
                        var sj = j; while (j < y.Length && char.IsDigit(y[j])) j++;
                        var nx = x.AsSpan(si, i - si).TrimStart('0');
                        var ny = y.AsSpan(sj, j - sj).TrimStart('0');
                        if (nx.Length != ny.Length) return nx.Length.CompareTo(ny.Length);
                        var c = nx.CompareTo(ny, StringComparison.Ordinal);
                        if (c != 0) return c;
                    }
                    else
                    {
                        var c = char.ToUpperInvariant(x[i]).CompareTo(char.ToUpperInvariant(y[j]));
                        if (c != 0) return c;
                        i++; j++;
                    }
                }
                return (x.Length - i).CompareTo(y.Length - j);
            }
        }
    }
}
