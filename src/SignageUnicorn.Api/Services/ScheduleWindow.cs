using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace SignageUnicorn.Api.Services
{
    // Dayparts (API 2.8.7). An assignment's daily time window and days of the week, evaluated in the
    // store's local time (Schedule:TimeZoneId, default Thailand). Pure functions so they can be
    // tested without a clock or a database; DeviceService and the transition worker call them.
    public static class ScheduleWindow
    {
        public const string DefaultTimeZoneId = "SE Asia Standard Time";

        public static TimeZoneInfo ResolveTimeZone(string? id)
        {
            foreach (var candidate in new[] { id, DefaultTimeZoneId, "Asia/Bangkok" })
            {
                if (string.IsNullOrWhiteSpace(candidate)) continue;
                try { return TimeZoneInfo.FindSystemTimeZoneById(candidate.Trim()); } catch { }
            }
            return TimeZoneInfo.CreateCustomTimeZone("UTC+7", TimeSpan.FromHours(7), "UTC+7", "UTC+7");
        }

        // "HH:mm" (also accepts "HH:mm:ss" and "H:mm"); null when absent or unreadable.
        public static string? NormalizeTime(string? raw)
        {
            if (!TryParseTime(raw, out var t)) return null;
            return t.ToString(@"hh\:mm", CultureInfo.InvariantCulture);
        }

        public static bool TryParseTime(string? raw, out TimeSpan time)
        {
            time = default;
            if (string.IsNullOrWhiteSpace(raw)) return false;
            var s = raw.Trim();
            if (TimeSpan.TryParseExact(s, new[] { @"hh\:mm", @"h\:mm", @"hh\:mm\:ss", @"h\:mm\:ss" }, CultureInfo.InvariantCulture, out time))
                return time >= TimeSpan.Zero && time < TimeSpan.FromDays(1);
            return false;
        }

        // ISO day numbers 1..7 (Monday = 1). Empty = no restriction.
        public static HashSet<int> ParseDays(string? raw)
        {
            var set = new HashSet<int>();
            if (string.IsNullOrWhiteSpace(raw)) return set;
            foreach (var part in raw.Split(new[] { ',', ';', ' ' }, StringSplitOptions.RemoveEmptyEntries))
            {
                if (int.TryParse(part, out var d) && d >= 1 && d <= 7) set.Add(d);
            }
            return set;
        }

        // Canonical "1,2,3"; null when nothing valid or every day is listed (no restriction).
        public static string? NormalizeDays(string? raw)
        {
            var set = ParseDays(raw);
            if (set.Count == 0 || set.Count == 7) return null;
            return string.Join(",", set.OrderBy(d => d));
        }

        public static int? NormalizeRepeat(int? minutes)
            => minutes.HasValue && minutes.Value > 0 ? Math.Min(minutes.Value, 24 * 60) : (int?)null;

        public static int IsoDay(DateTime local)
        {
            var d = (int)local.DayOfWeek; // Sunday = 0
            return d == 0 ? 7 : d;
        }

        public static bool HasConstraint(string? startTime, string? endTime, string? days)
            => TryParseTime(startTime, out _) || TryParseTime(endTime, out _) || ParseDays(days).Count > 0;

        // True when the local moment falls inside the daily window and on an allowed day. No start and
        // no end = all day. start > end = an overnight window (22:00-02:00). Days apply to the day the
        // window STARTED on: inside the after-midnight half of an overnight window the previous
        // calendar day is checked, so "Fri 22:00-02:00" keeps playing until 02:00 Saturday.
        public static bool IsWithin(DateTime localNow, string? startTime, string? endTime, string? days)
        {
            var hasStart = TryParseTime(startTime, out var start);
            var hasEnd = TryParseTime(endTime, out var end);
            var t = localNow.TimeOfDay;
            var overnight = hasStart && hasEnd && start > end;
            var dayOf = overnight && t < end ? localNow.AddDays(-1) : localNow;

            var allowed = ParseDays(days);
            if (allowed.Count > 0 && !allowed.Contains(IsoDay(dayOf))) return false;

            if (!hasStart && !hasEnd) return true;
            if (hasStart && !hasEnd) return t >= start;
            if (!hasStart) return t < end;
            if (start == end) return true;
            return start < end ? (t >= start && t < end) : (t >= start || t < end);
        }

        // The next local moment at which IsWithin may change: the next start or end time, the next
        // midnight when days of the week are restricted, and the next midnight for an open-ended
        // window (start only = active until midnight; end only = active from midnight; Codex 2.8.8 #7).
        // Null when there is no constraint.
        public static DateTime? NextBoundaryLocal(DateTime localNow, string? startTime, string? endTime, string? days)
        {
            DateTime? best = null;
            void Consider(DateTime candidate)
            {
                if (candidate <= localNow) return;
                if (best == null || candidate < best.Value) best = candidate;
            }
            var today = localNow.Date;
            var hasStart = TryParseTime(startTime, out var start);
            var hasEnd = TryParseTime(endTime, out var end);
            if (hasStart) { Consider(today + start); Consider(today.AddDays(1) + start); }
            if (hasEnd) { Consider(today + end); Consider(today.AddDays(1) + end); }
            if (ParseDays(days).Count > 0 || hasStart != hasEnd) Consider(today.AddDays(1));
            return best;
        }

        public static DateTime? NextBoundaryUtc(DateTime nowUtc, TimeZoneInfo tz, string? startTime, string? endTime, string? days)
        {
            var localNow = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(nowUtc, DateTimeKind.Utc), tz);
            var local = NextBoundaryLocal(localNow, startTime, endTime, days);
            if (local == null) return null;
            var unspecified = DateTime.SpecifyKind(local.Value, DateTimeKind.Unspecified);
            if (tz.IsInvalidTime(unspecified)) unspecified = unspecified.AddHours(1);
            return TimeZoneInfo.ConvertTimeToUtc(unspecified, tz);
        }

        public static DateTime ToLocal(DateTime nowUtc, TimeZoneInfo tz)
            => TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(nowUtc, DateTimeKind.Utc), tz);
    }
}
