using System;
using SignageUnicorn.Api.Services.Media;
using Xunit;

namespace SignageUnicorn.Api.Tests
{
    // Media integrity (API 2.8.15): verdicts, stored-name parsing, loop threshold, sliding-hour counter, quarantine set.
    public class MediaIntegrityTests
    {
        [Fact]
        public void VerdictMismatchWhenStoredHashDiffersFromDisk()
        {
            // The 27-11-2026 row: db b8514af3... / 102170 KB, disk 9898d857... / 42185434 bytes.
            var (status, note) = MediaIntegrityVerdict.Evaluate("b8514af37ff0bb858acb132967626f83", 102170, true, "9898d857af0fc6d2a254024e417cc848", 42185434);
            Assert.Equal(MediaIntegrityVerdict.Mismatch, status);
            Assert.Contains("b8514af3", note);
            Assert.Contains("9898d857", note);
            Assert.Contains("41197 KB", note);
        }

        [Fact]
        public void VerdictOkIgnoresCaseAndTrimsAndToleratesOneKbRounding()
        {
            var (status, note) = MediaIntegrityVerdict.Evaluate(" 9898D857AF0FC6D2A254024E417CC848 ", 41197, true, "9898d857af0fc6d2a254024e417cc848", 42185434);
            Assert.Equal(MediaIntegrityVerdict.Ok, status);
            Assert.Equal("", note);
            // size recorded with floor instead of ceiling is still ok
            Assert.Equal(MediaIntegrityVerdict.Ok, MediaIntegrityVerdict.Evaluate("ab", 41196, true, "ab", 42185434).Status);
        }

        [Fact]
        public void VerdictMissingAndNoHash()
        {
            Assert.Equal(MediaIntegrityVerdict.Missing, MediaIntegrityVerdict.Evaluate("ab", 10, false, null, 0).Status);
            var (status, note) = MediaIntegrityVerdict.Evaluate(null, 10, true, "cd", 2048);
            Assert.Equal(MediaIntegrityVerdict.Ok, status);          // nothing for the screen to verify against -> no loop possible
            Assert.Contains("no stored hash", note);
        }

        [Theory]
        [InlineData("/media/2b8d5118-f163-49e3-8851-1a3f778a54bd.mp4", "2b8d5118-f163-49e3-8851-1a3f778a54bd.mp4")]
        [InlineData("https://signage.aith123.com/media/abc.mp4?x=1", "abc.mp4")]
        [InlineData("/media/name%20with%20space.mp4", "name with space.mp4")]
        [InlineData("", null)]
        [InlineData(null, null)]
        public void StoredNameIsTheLastPathSegment(string? url, string? expected)
            => Assert.Equal(expected, MediaIntegrityVerdict.StoredName(url));

        [Fact]
        public void LoopThresholdIsThreePerScreenButNeverBelow1500()
        {
            Assert.Equal(1500, MediaIntegrityVerdict.LoopThreshold(0));
            Assert.Equal(1500, MediaIntegrityVerdict.LoopThreshold(400));
            Assert.Equal(1800, MediaIntegrityVerdict.LoopThreshold(600));
        }

        [Fact]
        public void SlidingHourCounterForgetsOldMinutesAndTripsOnRepeats()
        {
            var state = new MediaIntegrityState();
            var m0 = 1_000_000L;
            // a normal campaign: 336 screens fetch the file once, spread over 10 minutes -> under the limit
            for (var i = 0; i < 336; i++) state.NoteDownloadAt("a.mp4", m0 + i / 34);
            Assert.Equal(336, state.DownloadsLastHourAt("a.mp4", m0 + 10));
            Assert.Empty(state.FilesOverAt(MediaIntegrityVerdict.LoopThreshold(336), m0 + 10));
            // the 27-11 loop: every screen fetches it again every ~2 minutes -> 336 x 30 in an hour (minute by minute)
            for (var minute = m0 + 10; minute < m0 + 70; minute++)
                for (var k = 0; k < 168; k++) state.NoteDownloadAt("a.mp4", minute);
            Assert.True(state.DownloadsLastHourAt("a.mp4", m0 + 69) > MediaIntegrityVerdict.LoopThreshold(336));
            Assert.Single(state.FilesOverAt(MediaIntegrityVerdict.LoopThreshold(336), m0 + 69));
            // 61 minutes later without traffic the window is empty again
            Assert.Equal(0, state.DownloadsLastHourAt("a.mp4", m0 + 69 + 61));
        }

        [Theory]
        [InlineData("/media/a.mp4", true)]
        [InlineData("https://signage.aith123.com/media/a.mp4", true)]
        [InlineData("http://localhost:8862/media/a.mp4", true)]
        [InlineData("https://other.example/media/a.mp4", false)]
        [InlineData("https://signage.aith123.com/setup/a.exe", false)]
        [InlineData("media/a.mp4", false)]
        [InlineData("", false)]
        public void LocalMediaUrlNeedsOurHostOrARelativePath(string url, bool expected)
            => Assert.Equal(expected, MediaIntegrityVerdict.IsLocalMediaUrl(url, new[] { "signage.aith123.com" }));

        [Fact]
        public void LoopSuspectLatchSurvivesAnyDiskVerdict()
        {
            Assert.Equal(MediaIntegrityVerdict.LoopSuspect, MediaIntegrityVerdict.Reconcile(MediaIntegrityVerdict.LoopSuspect, "n", MediaIntegrityVerdict.Ok, "").Status);
            Assert.Equal(MediaIntegrityVerdict.LoopSuspect, MediaIntegrityVerdict.Reconcile(MediaIntegrityVerdict.LoopSuspect, "n", MediaIntegrityVerdict.Missing, "gone").Status);
            Assert.Equal(MediaIntegrityVerdict.Ok, MediaIntegrityVerdict.Reconcile(MediaIntegrityVerdict.Mismatch, "n", MediaIntegrityVerdict.Ok, "").Status);
            Assert.Equal(MediaIntegrityVerdict.Mismatch, MediaIntegrityVerdict.Reconcile(null, null, MediaIntegrityVerdict.Mismatch, "x").Status);
        }

        [Fact]
        public void ReplaceQuarantineIsAtomicAndResetForgetsDownloads()
        {
            var state = new MediaIntegrityState();
            state.SetQuarantine(1, "u1", MediaIntegrityVerdict.Mismatch);
            // the new snapshot replaces the old one in one step: 1 gone, 2 present, never both absent
            state.ReplaceQuarantine(new[] { (2L, (string?)"u2", MediaIntegrityVerdict.Missing, (string?)null) });
            Assert.False(state.IsQuarantined("1"));
            Assert.True(state.IsQuarantined("u2"));
            state.NoteDownloadAt("f.mp4", 500);
            Assert.Equal(1, state.DownloadsLastHourAt("f.mp4", 500));
            state.ResetDownloads("f.mp4");
            Assert.Equal(0, state.DownloadsLastHourAt("f.mp4", 500));
        }

        [Fact]
        public void ClearByEitherKeyRemovesThePairAndRecheckQueueDrains()
        {
            var state = new MediaIntegrityState();
            state.SetQuarantine(106, "a0609ed3", MediaIntegrityVerdict.LoopSuspect);
            state.ClearQuarantine("a0609ed3");           // MediaService only knows the uuid
            Assert.False(state.IsQuarantined("106"));
            Assert.False(state.IsQuarantined("a0609ed3"));
            state.SetQuarantine(7, "u7", MediaIntegrityVerdict.Mismatch);
            state.ClearQuarantine("7");
            Assert.False(state.IsQuarantined("u7"));
            Assert.Equal(0, state.QuarantinedCount);
            state.SetQuarantine(1, "u1", MediaIntegrityVerdict.Mismatch);
            state.SetQuarantine(2, "u2", MediaIntegrityVerdict.LoopSuspect);
            state.KeepOnly(new long[] { 2, 3 });           // media 1 was deleted meanwhile
            Assert.False(state.IsQuarantined("u1"));
            Assert.True(state.IsQuarantined("2"));
            state.ClearQuarantine(2, "u2");
            state.RequestCheck("106"); state.RequestCheck("106"); state.RequestCheck("u9"); state.RequestCheck(null);
            var keys = state.DrainCheckRequests();
            Assert.Equal(2, keys.Count);
            Assert.Empty(state.DrainCheckRequests());
        }

        [Fact]
        public void QuarantineIsAboutOneStoredFileSoAReplacementIsNotBlockedByIt()
        {
            var state = new MediaIntegrityState();
            state.SetQuarantine(106, "u106", MediaIntegrityVerdict.LoopSuspect, "2b8d5118-old.mp4");
            Assert.True(state.IsQuarantined("106"));                                        // id alone: held
            Assert.True(state.IsQuarantined("106", "/media/2b8d5118-old.mp4"));            // the file the verdict is about
            Assert.True(state.IsQuarantined("u106", "https://signage.aith123.com/media/2b8d5118-old.mp4?x=1"));
            Assert.False(state.IsQuarantined("106", "/media/9f1c-new.mp4"));                // replaced bytes: not held
            Assert.Null(state.StatusOf("106", "/media/9f1c-new.mp4"));
            // an entry without a stored name (legacy / unknown) applies to any url
            state.SetQuarantine(7, "u7", MediaIntegrityVerdict.Missing, null);
            Assert.True(state.IsQuarantined("7", "/media/whatever.mp4"));
        }

        [Theory]
        [InlineData("2b8d5118.mp4", "/media/2b8d5118.mp4", true)]
        [InlineData("2B8D5118.MP4", "https://signage.aith123.com/media/2b8d5118.mp4?x=1", true)]
        [InlineData("2b8d5118.mp4", "/media/9f1c-new.mp4", false)]
        [InlineData(null, "/media/2b8d5118.mp4", false)]
        [InlineData("", "/media/2b8d5118.mp4", false)]
        [InlineData("2b8d5118.mp4", null, false)]
        public void StoredVerdictCountsOnlyForTheFileItWasMadeFor(string? verdictFile, string? blobUrl, bool expected)
            => Assert.Equal(expected, MediaIntegrityVerdict.VerdictIsForFile(verdictFile, blobUrl));

        [Fact]
        public void QuarantineAnswersForNumericIdAndUuid()
        {
            var state = new MediaIntegrityState();
            state.SetQuarantine(106, "a0609ed3-d837-4389-8278-23763e9be29a", MediaIntegrityVerdict.Mismatch);
            Assert.True(state.IsQuarantined("106"));
            Assert.True(state.IsQuarantined("A0609ED3-D837-4389-8278-23763E9BE29A"));
            Assert.False(state.IsQuarantined("107"));
            Assert.Equal(MediaIntegrityVerdict.Mismatch, state.StatusOf("106"));
            state.ClearQuarantine(106, "a0609ed3-d837-4389-8278-23763e9be29a");
            Assert.False(state.IsQuarantined("106"));
            state.ReplaceQuarantine(new[] { (7L, (string?)"u7", MediaIntegrityVerdict.Missing, (string?)"seven.mp4") });
            Assert.True(state.IsQuarantined("7"));
            Assert.False(state.IsQuarantined("106"));
            Assert.True(MediaIntegrityService.IsQuarantineStatus(MediaIntegrityVerdict.LoopSuspect));
            Assert.False(MediaIntegrityService.IsQuarantineStatus(MediaIntegrityVerdict.Ok));
            Assert.False(MediaIntegrityService.IsQuarantineStatus(null));
        }
    }
}
