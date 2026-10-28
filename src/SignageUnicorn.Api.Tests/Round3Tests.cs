using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Repositories;
using SignageUnicorn.Api.Services;
using SignageUnicorn.Api.Services.Background;
using SignageUnicorn.Api.Tests.Fakes;
using Xunit;

namespace SignageUnicorn.Api.Tests
{
    // Round 3: atomic token writes (R3), reset -> RECLAIM_TOKEN (R2), MAC-adoption authorisation (#1),
    // store-failure classification (R4), schedule checkpoint (#12), inheritor notification (#11).
    public class Round3TokenRaceTests
    {
        private static DeviceAuthService Make(FakeDeviceRepository repo, DeviceAuthMode mode = DeviceAuthMode.IfIssued, bool reclaim = false)
            => new(repo, new FakeSystemLogRepository(), mode, reclaim);

        [Fact]
        public async Task Claim_loses_the_race_when_another_claim_wrote_first_and_hands_out_no_token()
        {
            var repo = new FakeDeviceRepository().Add(1, "uuid-1");
            // The "other" claim lands between our read and our conditional write.
            repo.BeforeTokenWrite = row => row.TokenHash ??= DeviceAuthService.Hash("winner");
            var svc = Make(repo);

            var outcome = await svc.ClaimAsync("1", "uuid-1", null, null, "ip");

            Assert.Equal(ClaimStatus.Race, outcome.Status);
            Assert.Null(outcome.Token);
            Assert.Equal(DeviceAuthService.Hash("winner"), repo.Rows[0].TokenHash); // the winner's token survived
            Assert.Empty(repo.TokenWrites);                                          // we wrote nothing
        }

        [Fact]
        public async Task Rotation_is_conditional_on_the_hash_that_was_read()
        {
            var mine = DeviceAuthService.GenerateToken();
            var repo = new FakeDeviceRepository().Add(1, "uuid-1", DeviceAuthService.Hash(mine));
            repo.BeforeTokenWrite = row => row.TokenHash = DeviceAuthService.Hash("rotated-elsewhere");
            var svc = Make(repo);

            var outcome = await svc.ClaimAsync("1", "uuid-1", null, mine, "ip");

            Assert.Equal(ClaimStatus.Race, outcome.Status);
            Assert.Equal(DeviceAuthService.Hash("rotated-elsewhere"), repo.Rows[0].TokenHash);
        }

        [Fact]
        public async Task Register_issuance_throws_a_race_instead_of_overwriting()
        {
            var repo = new FakeDeviceRepository().Add(7, "uuid-7");
            repo.BeforeTokenWrite = row => row.TokenHash = DeviceAuthService.Hash("concurrent");
            var svc = Make(repo);
            var device = new DeviceDto { DeviceId = "7", DeviceUuid = "uuid-7" };

            await Assert.ThrowsAsync<DeviceTokenRaceException>(() => svc.IssueOrRotateAsync(device, null, tokenCapable: true, "ip"));
            Assert.Equal(DeviceAuthService.Hash("concurrent"), repo.Rows[0].TokenHash);
        }

        [Fact]
        public async Task Uncontended_claim_and_rotation_still_succeed_and_clear_the_reset_marker()
        {
            var repo = new FakeDeviceRepository().Add(1, "uuid-1", resetAt: DateTime.UtcNow);
            var svc = Make(repo);

            var issued = await svc.ClaimAsync("1", "uuid-1", null, null, "ip");
            Assert.Equal(ClaimStatus.Issued, issued.Status);
            Assert.Null(repo.Rows[0].TokenResetAt);

            var rotated = await svc.ClaimAsync("1", "uuid-1", null, issued.Token, "ip");
            Assert.Equal(ClaimStatus.Rotated, rotated.Status);
            Assert.NotEqual(issued.Token, rotated.Token);
        }
    }

    public class Round3ResetReclaimTests
    {
        private static DeviceAuthService Make(FakeDeviceRepository repo, DeviceAuthMode mode = DeviceAuthMode.IfIssued)
            => new(repo, new FakeSystemLogRepository(), mode, false);

        [Fact]
        public async Task Reset_stamps_the_marker_and_resolve_reports_it_as_pending()
        {
            var token = DeviceAuthService.GenerateToken();
            var repo = new FakeDeviceRepository().Add(1, "uuid-1", DeviceAuthService.Hash(token));
            var svc = Make(repo);

            await svc.ResetAsync("1", 42);
            Assert.Null(repo.Rows[0].TokenHash);
            Assert.NotNull(repo.Rows[0].TokenResetAt);

            // The screen still sends the old token: accepted under IfIssued (row has no token) but
            // flagged so the controller injects RECLAIM_TOKEN.
            var auth = await svc.ResolveAsync("1", "uuid-1", token, "ip");
            Assert.True(auth.Ok);
            Assert.True(auth.TokenResetPending);

            // After a successful claim the marker is gone.
            var claim = await svc.ClaimAsync("1", "uuid-1", null, null, "ip");
            Assert.Equal(ClaimStatus.Issued, claim.Status);
            var after = await svc.ResolveAsync("1", "uuid-1", claim.Token, "ip");
            Assert.True(after.Ok);
            Assert.False(after.TokenResetPending);
        }

        [Theory]
        [InlineData(true, "tok", 1, true)]   // presented a (stale) token -> can act on the instruction
        [InlineData(true, null, 2, true)]    // protocol-2 client -> can act
        [InlineData(true, null, 1, false)]   // legacy client without token: cannot act, do not confuse it
        [InlineData(false, "tok", 2, false)] // nothing pending
        public void ShouldRequestReclaim_follows_the_contract(bool pending, string? token, int protocol, bool expected)
            => Assert.Equal(expected, DeviceAuthService.ShouldRequestReclaim(pending, token, protocol));

        [Fact]
        public void Pseudo_command_ids_are_recognised()
        {
            var id = DeviceAuthService.NewPseudoCommandId();
            Assert.True(DeviceAuthService.IsPseudoCommandId(id));
            Assert.True(DeviceAuthService.IsPseudoCommandId("pseudo-abc"));
            Assert.False(DeviceAuthService.IsPseudoCommandId(Guid.NewGuid().ToString()));
            Assert.False(DeviceAuthService.IsPseudoCommandId(null));
        }
    }

    public class Round3MacAdoptionTests
    {
        private static DeviceAuthService Make(FakeDeviceRepository repo, DeviceAuthMode mode)
            => new(repo, new FakeSystemLogRepository(), mode, false);

        [Fact]
        public async Task Unknown_key_is_reported_so_the_controller_can_authorise_adoption()
        {
            var repo = new FakeDeviceRepository().Add(1, "uuid-1");
            var svc = Make(repo, DeviceAuthMode.IfIssued);

            var known = await svc.ResolveAsync("1", "uuid-1", null, "ip");
            Assert.True(known.KeyKnown);

            var unknown = await svc.ResolveAsync("1", "new-hw-uuid", null, "ip");
            Assert.True(unknown.Ok);           // legacy token-less row: still accepted
            Assert.False(unknown.KeyKnown);    // but the procedure will not find this uuid
        }

        [Fact]
        public async Task No_candidate_or_legacy_candidate_allows_adoption()
        {
            var repo = new FakeDeviceRepository().Add(1, "uuid-1", mac: "AA:BB:CC:DD:EE:01");
            var svc = Make(repo, DeviceAuthMode.IfIssued);

            Assert.Equal(MacAdoptionDecision.Allow, await svc.AuthorizeMacAdoptionAsync("new-uuid", "11:22:33:44:55:66", null, "ip"));
            Assert.Equal(MacAdoptionDecision.Allow, await svc.AuthorizeMacAdoptionAsync("new-uuid", "AA:BB:CC:DD:EE:01", null, "ip"));
        }

        [Fact]
        public async Task Protected_candidate_is_blocked_unless_the_request_proves_its_token()
        {
            var token = DeviceAuthService.GenerateToken();
            var repo = new FakeDeviceRepository().Add(1, "uuid-1", DeviceAuthService.Hash(token), mac: "AA:BB:CC:DD:EE:01");

            var ifIssued = Make(repo, DeviceAuthMode.IfIssued);
            Assert.Equal(MacAdoptionDecision.Block, await ifIssued.AuthorizeMacAdoptionAsync("new-uuid", "AA:BB:CC:DD:EE:01", null, "ip"));
            Assert.Equal(MacAdoptionDecision.Block, await ifIssued.AuthorizeMacAdoptionAsync("new-uuid", "AA:BB:CC:DD:EE:01", "wrong", "ip"));
            Assert.Equal(MacAdoptionDecision.Allow, await ifIssued.AuthorizeMacAdoptionAsync("new-uuid", "AA:BB:CC:DD:EE:01", token, "ip"));

            var required = Make(repo, DeviceAuthMode.Required);
            Assert.Equal(MacAdoptionDecision.Reject, await required.AuthorizeMacAdoptionAsync("new-uuid", "AA:BB:CC:DD:EE:01", null, "ip"));
            Assert.Equal(MacAdoptionDecision.Allow, await required.AuthorizeMacAdoptionAsync("new-uuid", "AA:BB:CC:DD:EE:01", token, "ip"));
        }

        [Fact]
        public async Task Ambiguous_mac_yields_no_candidate_and_is_allowed_like_the_procedure()
        {
            var token = DeviceAuthService.GenerateToken();
            var repo = new FakeDeviceRepository()
                .Add(1, "uuid-1", DeviceAuthService.Hash(token), mac: "AA:BB:CC:DD:EE:01")
                .Add(2, "uuid-2", DeviceAuthService.Hash(token), mac: "AA:BB:CC:DD:EE:01");
            var svc = Make(repo, DeviceAuthMode.IfIssued);
            // The procedure inserts a new row for an ambiguous MAC (HAVING COUNT(*) = 1), so nothing
            // protected can be adopted and the beat may proceed.
            Assert.Equal(MacAdoptionDecision.Allow, await svc.AuthorizeMacAdoptionAsync("new-uuid", "AA:BB:CC:DD:EE:01", null, "ip"));
        }
    }

    public class Round3StoreFailureClassificationTests
    {
        [Theory]
        [InlineData(2812, true)]   // procedure not found
        [InlineData(207, true)]    // invalid column
        [InlineData(208, true)]    // invalid object
        [InlineData(8144, true)]   // too many arguments
        [InlineData(8145, true)]   // not a parameter of the procedure
        [InlineData(201, true)]    // expected parameter not supplied
        [InlineData(4121, true)]
        [InlineData(2715, true)]
        [InlineData(-2, true)]
        [InlineData(547, false)]   // FK: the data is wrong
        [InlineData(8152, false)]
        [InlineData(245, false)]
        public void Schema_level_numbers_are_retryable_and_data_numbers_are_not(int number, bool retryable)
        {
            Assert.Equal(retryable, SqlTransientErrors.IsRetryableNumber(number));
            Assert.Equal(!retryable && number > 0, SqlTransientErrors.IsDataErrorNumber(number));
        }

        [Theory]
        [InlineData(404, true)]    // "Device or Media not found": reject
        [InlineData(400, true)]
        [InlineData(547, true)]    // FK caught by the procedure: reject
        [InlineData(99, false)]    // "Unknown action" from an OLD procedure: retry, the deployment is wrong
        [InlineData(2812, false)]
        [InlineData(1205, false)]  // deadlock caught by the procedure: retry
        [InlineData(500, false)]
        public void Procedure_error_codes_reject_only_validation_and_data_outcomes(int errCode, bool rejected)
            => Assert.Equal(rejected, SqlTransientErrors.IsProcedureValidationCode(errCode));

        [Fact]
        public void Non_sql_exceptions_are_never_data_errors()
        {
            Assert.False(SqlTransientErrors.IsDataError(new InvalidOperationException("x")));
            Assert.False(SqlTransientErrors.IsDataError(null));
        }
    }

    public class Round3ScheduleCheckpointTests
    {
        [Fact]
        public void Missing_or_unparsable_checkpoint_starts_one_interval_back()
        {
            var now = new DateTime(2026, 10, 27, 10, 0, 0, DateTimeKind.Utc);
            Assert.Equal(now - ScheduleTransitionWorker.Interval, ScheduleTransitionWorker.ComputeStartWindow(null, now));
            Assert.Equal(now - ScheduleTransitionWorker.Interval, ScheduleTransitionWorker.ComputeStartWindow("garbage", now));
        }

        [Fact]
        public void Recent_checkpoint_is_used_as_is_so_a_downtime_window_is_reconciled()
        {
            var now = new DateTime(2026, 10, 27, 10, 0, 0, DateTimeKind.Utc);
            var stored = now.AddHours(-3).ToString("o");
            Assert.Equal(now.AddHours(-3), ScheduleTransitionWorker.ComputeStartWindow(stored, now));
        }

        [Fact]
        public void Checkpoint_older_than_the_cap_is_clamped_and_a_future_one_is_ignored()
        {
            var now = new DateTime(2026, 10, 27, 10, 0, 0, DateTimeKind.Utc);
            Assert.Equal(now - ScheduleTransitionWorker.MaxLookBack, ScheduleTransitionWorker.ComputeStartWindow(now.AddDays(-30).ToString("o"), now));
            Assert.Equal(now - ScheduleTransitionWorker.Interval, ScheduleTransitionWorker.ComputeStartWindow(now.AddHours(1).ToString("o"), now));
        }
    }

    public class Round3InheritorNotificationTests
    {
        [Fact]
        public async Task Assignment_changes_queue_sync_for_inheriting_siblings_only()
        {
            var repo = new FakeDeviceRepository();
            repo.Inheritors["10"] = new List<string> { "11", "12" };
            var svc = new DeviceService(repo, new FakeSystemLogRepository(), new FakeWebHostEnvironment(), new FakeServiceProvider());

            await svc.NotifyScheduleInheritorsAsync("10");

            Assert.Equal(new[] { ("11", "SYNC_SCHEDULE"), ("12", "SYNC_SCHEDULE") }, repo.Commands.ToArray());
        }

        [Fact]
        public async Task A_device_without_inheritors_queues_nothing_and_never_throws()
        {
            var repo = new FakeDeviceRepository();
            var svc = new DeviceService(repo, new FakeSystemLogRepository(), new FakeWebHostEnvironment(), new FakeServiceProvider());
            await svc.NotifyScheduleInheritorsAsync("99");
            Assert.Empty(repo.Commands);
        }

        private sealed class FakeWebHostEnvironment : Microsoft.AspNetCore.Hosting.IWebHostEnvironment
        {
            public string WebRootPath { get; set; } = Path.GetTempPath();
            public Microsoft.Extensions.FileProviders.IFileProvider WebRootFileProvider { get; set; } = new Microsoft.Extensions.FileProviders.NullFileProvider();
            public string ApplicationName { get; set; } = "tests";
            public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } = new Microsoft.Extensions.FileProviders.NullFileProvider();
            public string ContentRootPath { get; set; } = Path.GetTempPath();
            public string EnvironmentName { get; set; } = "Test";
        }

        private sealed class FakeServiceProvider : IServiceProvider
        {
            public object? GetService(Type serviceType) => null;
        }
    }
}
