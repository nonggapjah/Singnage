using System;
using SignageUnicorn.Api.Services;
using Xunit;

namespace SignageUnicorn.Api.Tests
{
    // Dayparts (API 2.8.7): daily windows, days of the week and the next boundary.
    public class DaypartTests
    {
        private static DateTime L(string s) => DateTime.Parse(s, System.Globalization.CultureInfo.InvariantCulture);

        [Theory]
        [InlineData("09:00", "09:00")]
        [InlineData("9:05", "09:05")]
        [InlineData("23:59:00", "23:59")]
        [InlineData("24:00", null)]
        [InlineData("abc", null)]
        [InlineData("", null)]
        [InlineData(null, null)]
        public void NormalizeTime(string? raw, string? expected)
            => Assert.Equal(expected, ScheduleWindow.NormalizeTime(raw));

        [Theory]
        [InlineData("1,2,3", "1,2,3")]
        [InlineData("3;1, 2", "1,2,3")]
        [InlineData("1,2,3,4,5,6,7", null)]   // every day = no restriction
        [InlineData("8,0", null)]
        [InlineData("", null)]
        [InlineData(null, null)]
        public void NormalizeDays(string? raw, string? expected)
            => Assert.Equal(expected, ScheduleWindow.NormalizeDays(raw));

        [Theory]
        [InlineData(null, null)]
        [InlineData(0, null)]
        [InlineData(-5, null)]
        [InlineData(30, 30)]
        [InlineData(5000, 1440)]
        public void NormalizeRepeat(int? raw, int? expected)
            => Assert.Equal(expected, ScheduleWindow.NormalizeRepeat(raw));

        [Fact]
        public void IsoDay_is_monday_1_sunday_7()
        {
            Assert.Equal(1, ScheduleWindow.IsoDay(L("2026-11-16 10:00"))); // Monday
            Assert.Equal(7, ScheduleWindow.IsoDay(L("2026-11-22 10:00"))); // Sunday
        }

        [Theory]
        // no constraint
        [InlineData("2026-11-20 03:00", null, null, null, true)]
        // same-day window 09:00-18:00
        [InlineData("2026-11-20 08:59", "09:00", "18:00", null, false)]
        [InlineData("2026-11-20 09:00", "09:00", "18:00", null, true)]
        [InlineData("2026-11-20 17:59", "09:00", "18:00", null, true)]
        [InlineData("2026-11-20 18:00", "09:00", "18:00", null, false)]
        // overnight window 22:00-02:00
        [InlineData("2026-11-20 23:30", "22:00", "02:00", null, true)]
        [InlineData("2026-11-21 01:30", "22:00", "02:00", null, true)]
        [InlineData("2026-11-21 02:00", "22:00", "02:00", null, false)]
        [InlineData("2026-11-21 12:00", "22:00", "02:00", null, false)]
        // open-ended
        [InlineData("2026-11-20 05:00", "06:00", null, null, false)]
        [InlineData("2026-11-20 07:00", "06:00", null, null, true)]
        [InlineData("2026-11-20 21:00", null, "20:00", null, false)]
        // days: 2026-11-20 is a Friday (5), 2026-11-22 a Sunday (7)
        [InlineData("2026-11-20 12:00", null, null, "1,2,3,4,5", true)]
        [InlineData("2026-11-22 12:00", null, null, "1,2,3,4,5", false)]
        [InlineData("2026-11-22 12:00", "09:00", "18:00", "6,7", true)]
        [InlineData("2026-11-22 19:00", "09:00", "18:00", "6,7", false)]
        public void IsWithin(string localNow, string? start, string? end, string? days, bool expected)
            => Assert.Equal(expected, ScheduleWindow.IsWithin(L(localNow), start, end, days));

        [Theory]
        [InlineData("2026-11-20 08:00", "09:00", "18:00", null, "2026-11-20 09:00")]
        [InlineData("2026-11-20 12:00", "09:00", "18:00", null, "2026-11-20 18:00")]
        [InlineData("2026-11-20 19:00", "09:00", "18:00", null, "2026-11-21 09:00")]
        [InlineData("2026-11-20 23:00", "22:00", "02:00", null, "2026-11-21 02:00")]
        [InlineData("2026-11-20 12:00", null, null, "1,2,3", "2026-11-21 00:00")]
        [InlineData("2026-11-20 23:30", "09:00", null, "5", "2026-11-21 00:00")]
        // Codex 2.8.8 #7: open-ended windows flip at midnight even without a day restriction
        [InlineData("2026-11-20 12:00", "09:00", null, null, "2026-11-21 00:00")]
        [InlineData("2026-11-20 08:00", "09:00", null, null, "2026-11-20 09:00")]
        [InlineData("2026-11-20 19:00", null, "18:00", null, "2026-11-21 00:00")]
        [InlineData("2026-11-20 12:00", null, "18:00", null, "2026-11-20 18:00")]
        public void NextBoundaryLocal(string localNow, string? start, string? end, string? days, string expected)
            => Assert.Equal(L(expected), ScheduleWindow.NextBoundaryLocal(L(localNow), start, end, days));

        [Fact]
        public void NextBoundaryLocal_is_null_without_constraints()
            => Assert.Null(ScheduleWindow.NextBoundaryLocal(L("2026-11-20 12:00"), null, null, null));

        [Fact]
        public void NextBoundaryUtc_converts_through_the_store_time_zone()
        {
            var tz = ScheduleWindow.ResolveTimeZone(null); // Thailand, UTC+7 all year
            Assert.Equal(TimeSpan.FromHours(7), tz.BaseUtcOffset);
            // 01:00 UTC = 08:00 Bangkok; next start at 09:00 local = 02:00 UTC
            var next = ScheduleWindow.NextBoundaryUtc(new DateTime(2026, 11, 20, 1, 0, 0, DateTimeKind.Utc), tz, "09:00", "18:00", null);
            Assert.Equal(new DateTime(2026, 11, 20, 2, 0, 0), next);
        }

        [Fact]
        public void ResolveTimeZone_falls_back_instead_of_throwing()
        {
            var tz = ScheduleWindow.ResolveTimeZone("No/Such_Zone");
            Assert.Equal(TimeSpan.FromHours(7), tz.BaseUtcOffset);
        }

        [Fact]
        public void HasConstraint()
        {
            Assert.False(ScheduleWindow.HasConstraint(null, null, null));
            Assert.False(ScheduleWindow.HasConstraint("", "zz", "9"));
            Assert.True(ScheduleWindow.HasConstraint("09:00", null, null));
            Assert.True(ScheduleWindow.HasConstraint(null, null, "1"));
        }
    }
}
