using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Services;
using SignageUnicorn.Api.Services.Background;
using SignageUnicorn.Api.Tests.Fakes;
using Xunit;

namespace SignageUnicorn.Api.Tests
{
    // Round 5 (Codex round-5 items 3, 4, 10): fresh version names for every byte replacement, durable
    // retry of failed schedule notifications, filename-only conditional rename on swap.
    public class Round5MediaNamingTests
    {
        [Theory]
        [InlineData("clip.mp4", new string[0], null, "clip.v2.mp4")]                       // bare -> v2
        [InlineData("clip.v2.mp4", new[] { "clip.v2.mp4" }, null, "clip.v3.mp4")]          // v2 -> v3
        [InlineData("clip.mp4", new[] { "clip.v2.mp4" }, null, "clip.v3.mp4")]             // upload named bare while the row is v2
        [InlineData("clip.mp4", new[] { "clip.v2.mp4", "clip.v5.mp4", "other.v9.mp4" }, null, "clip.v6.mp4")] // never reuse a number in use for the stem
        [InlineData("Clip.MP4", new[] { "clip.v2.mp4" }, null, "Clip.v3.MP4")]             // mixed case: stem match is case-insensitive, extension kept as given
        [InlineData("clip.mov", new[] { "CLIP.V4.MP4" }, ".mp4", "clip.v5.mp4")]           // transcode target extension, suffix case-insensitive
        [InlineData("other.mp4", new[] { "clip.v9.mp4" }, null, "other.v2.mp4")]           // a different stem starts at v2, never the bare name
        [InlineData("clip.v7.mp4", new[] { "clip.mp4" }, null, "clip.v8.mp4")]             // the proposed name's own version counts too
        public void NextVersion_is_always_above_every_version_in_use_for_the_stem(string proposed, string[] inUse, string? ext, string expected)
            => Assert.Equal(expected, MediaFileNaming.NextVersion(proposed, inUse, ext));

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        [InlineData("   ")]
        public void NextVersion_returns_null_without_a_usable_name(string? proposed)
            => Assert.Null(MediaFileNaming.NextVersion(proposed, new[] { "clip.mp4" }));

        [Fact]
        public void NextVersion_tolerates_a_null_or_garbage_in_use_list()
        {
            Assert.Equal("clip.v2.mp4", MediaFileNaming.NextVersion("clip.mp4", null));
            Assert.Equal("clip.v2.mp4", MediaFileNaming.NextVersion("clip.mp4", new string?[] { null, "", "  " }));
        }

        [Theory]
        [InlineData("clip.mp4", "clip.v2.mp4", true)]
        [InlineData("CLIP.mov", "clip.v3.mp4", true)]
        [InlineData("clip.mp4", "clip2.mp4", false)]
        [InlineData("clip.mp4", null, false)]
        public void SharesStem_ignores_version_suffix_extension_and_case(string? a, string? b, bool expected)
            => Assert.Equal(expected, MediaFileNaming.SharesStem(a, b));

        [Fact]
        public void Split_reads_the_version_suffix_case_insensitively()
        {
            var p = MediaFileNaming.Split("Buyer.V4.MP4");
            Assert.NotNull(p);
            Assert.Equal("Buyer", p!.Value.Stem);
            Assert.Equal(4, p.Value.Version);
            Assert.Equal(".MP4", p.Value.Extension);
        }
    }

    public class Round5ScheduleTransitionPendingTests
    {
        [Fact]
        public void Pending_list_round_trips_through_the_setting_value()
        {
            var json = ScheduleTransitionWorker.SerializePending(new[] { "7", "12", "7", "", "3" });
            Assert.Equal(new List<string> { "7", "12", "3" }, ScheduleTransitionWorker.ParsePending(json));
        }

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        [InlineData("not json")]
        [InlineData("{\"a\":1}")]
        public void Unreadable_pending_values_count_as_empty(string? stored)
            => Assert.Empty(ScheduleTransitionWorker.ParsePending(stored));

        [Fact]
        public void Merge_removes_successes_keeps_failures_and_adds_new_ones_oldest_first()
        {
            var merged = ScheduleTransitionWorker.MergePending(
                previous: new[] { "1", "2", "3" },
                succeeded: new[] { "2" },
                failed: new[] { "4", "3", "4" });
            Assert.Equal(new List<string> { "1", "3", "4" }, merged);
        }

        [Fact]
        public void Merge_caps_the_list_without_dropping_the_oldest_entries()
        {
            var merged = ScheduleTransitionWorker.MergePending(
                previous: new[] { "a", "b" },
                succeeded: Array.Empty<string>(),
                failed: new[] { "c", "d" },
                cap: 3);
            Assert.Equal(new List<string> { "a", "b", "c" }, merged);
        }

        [Fact]
        public void The_window_advances_only_when_the_scan_itself_succeeded()
        {
            Assert.True(ScheduleTransitionWorker.ShouldAdvance(scanSucceeded: true));
            Assert.False(ScheduleTransitionWorker.ShouldAdvance(scanSucceeded: false));
        }
    }

    public class Round5SwapRenameTests
    {
        private static (MediaService Service, FakeMediaRepository Repo, FakeSystemLogRepository Log) Build()
        {
            var repo = new FakeMediaRepository();
            var log = new FakeSystemLogRepository();
            var service = new MediaService(
                repo,
                new FakeWebHostEnvironment(),
                new HttpContextAccessor(),
                new ConfigurationBuilder().Build(),
                log,
                new FakeDeviceRepository());
            return (service, repo, log);
        }

        private static MediaFile Row(string id, string name, string blob, string hash) => new()
        {
            MediaId = id, FileName = name, DisplayName = "Clip", BlobUrl = blob, FileHash = hash, FileSizeKb = 10, Active = "Y"
        };

        [Fact]
        public async Task Swap_versions_the_new_row_name_through_a_filename_only_rename()
        {
            var (service, repo, _) = Build();
            repo.Add(Row("1", "clip.mp4", "/media/a.mp4", "h-a"))
                .Add(Row("2", "clip.mp4", "/media/b.mp4", "h-b"));

            var result = await service.ReplaceMediaAsync("1", "2", archiveOld: true);

            Assert.True(result.Success);
            Assert.False(result.RenameConflict);
            Assert.Equal("clip.v2.mp4", result.NewFileName);
            Assert.Single(repo.RenameCalls);
            Assert.Equal(("2", "clip.v2.mp4", "b.mp4"), repo.RenameCalls[0]);
            Assert.Equal(0, repo.ReplaceCalls);                   // never REPLACE_FILE from a snapshot
            var row = repo.Rows.Single(r => r.MediaId == "2");
            Assert.Equal("clip.v2.mp4", row.FileName);
            Assert.Equal("/media/b.mp4", row.BlobUrl);            // metadata untouched
            Assert.Equal("h-b", row.FileHash);
        }

        [Fact]
        public async Task A_transcode_finishing_before_the_rename_is_detected_and_the_current_row_is_renamed_instead()
        {
            var (service, repo, _) = Build();
            repo.Add(Row("1", "clip.mp4", "/media/a.mp4", "h-a"))
                .Add(Row("2", "clip.mp4", "/media/b.mp4", "h-b"));
            // Between the service's read and its first rename a transcode publishes new bytes.
            repo.BeforeRename = attempt =>
            {
                if (attempt != 0) return;
                var r = repo.Rows.Single(x => x.MediaId == "2");
                r.BlobUrl = "/media/c.mp4";
                r.FileHash = "h-c";
                r.FileName = "clip.v2.mp4";
            };

            var result = await service.ReplaceMediaAsync("1", "2", archiveOld: true);

            Assert.True(result.Success);
            Assert.False(result.RenameConflict);
            Assert.Equal("clip.v3.mp4", result.NewFileName);
            Assert.Equal(2, repo.RenameCalls.Count);
            Assert.Equal("b.mp4", repo.RenameCalls[0].ExpectedBlob);  // first attempt guarded by the stale blob -> 409
            Assert.Equal("c.mp4", repo.RenameCalls[1].ExpectedBlob);  // retry guarded by the CURRENT blob
            Assert.Equal(0, repo.ReplaceCalls);
            var row = repo.Rows.Single(r => r.MediaId == "2");
            Assert.Equal("/media/c.mp4", row.BlobUrl);            // the transcode's publish survived
            Assert.Equal("h-c", row.FileHash);
            Assert.Equal("clip.v3.mp4", row.FileName);
        }

        [Fact]
        public async Task Two_conflicts_in_a_row_are_reported_without_forcing_stale_metadata()
        {
            var (service, repo, log) = Build();
            repo.Add(Row("1", "clip.mp4", "/media/a.mp4", "h-a"))
                .Add(Row("2", "clip.mp4", "/media/b.mp4", "h-b"));
            int n = 0;
            repo.BeforeRename = _ =>
            {
                var r = repo.Rows.Single(x => x.MediaId == "2");
                r.BlobUrl = $"/media/x{++n}.mp4";
            };

            var result = await service.ReplaceMediaAsync("1", "2", archiveOld: true);

            Assert.True(result.Success);                          // the usage swap itself completed
            Assert.True(result.RenameConflict);
            Assert.Null(result.NewFileName);
            Assert.Contains("changed concurrently", result.Message);
            Assert.Equal(2, repo.RenameCalls.Count);
            Assert.Equal(0, repo.ReplaceCalls);
            Assert.Contains(log.Lines, l => l.Contains("SWAP_RENAME_CONFLICT"));
            Assert.Equal("clip.mp4", repo.Rows.Single(r => r.MediaId == "2").FileName);
        }

        [Fact]
        public async Task Rows_with_different_stems_are_not_renamed()
        {
            var (service, repo, _) = Build();
            repo.Add(Row("1", "clip.mp4", "/media/a.mp4", "h-a"))
                .Add(Row("2", "banner.mp4", "/media/b.mp4", "h-b"));

            var result = await service.ReplaceMediaAsync("1", "2", archiveOld: true);

            Assert.True(result.Success);
            Assert.Empty(repo.RenameCalls);
            Assert.Null(result.NewFileName);
        }
    }
}
