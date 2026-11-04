using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Repositories.Interfaces;
using SignageUnicorn.Api.Services;
using SignageUnicorn.Api.Tests.Fakes;
using Xunit;

namespace SignageUnicorn.Api.Tests
{
    public class DeviceAuthServiceTests
    {
        private static DeviceAuthService Make(IDeviceRepository repo, DeviceAuthMode mode, bool reclaim = false)
            => new(repo, new FakeSystemLogRepository(), mode, reclaim);

        // ---------- hashing / matching ----------

        [Fact]
        public void Hash_is_lowercase_sha256_hex_and_deterministic()
        {
            var a = DeviceAuthService.Hash("secret");
            var b = DeviceAuthService.Hash("secret");
            Assert.Equal(64, a.Length);
            Assert.Equal(a, b);
            Assert.Equal(a, a.ToLowerInvariant());
            Assert.NotEqual(a, DeviceAuthService.Hash("Secret"));
        }

        [Fact]
        public void TokenMatches_only_for_the_right_token()
        {
            var token = DeviceAuthService.GenerateToken();
            var hash = DeviceAuthService.Hash(token);
            Assert.True(DeviceAuthService.TokenMatches(token, hash));
            Assert.True(DeviceAuthService.TokenMatches(token, hash.ToUpperInvariant()));
            Assert.False(DeviceAuthService.TokenMatches(token + "x", hash));
            Assert.False(DeviceAuthService.TokenMatches(null, hash));
            Assert.False(DeviceAuthService.TokenMatches(token, null));
        }

        [Fact]
        public void GenerateToken_is_url_safe_and_unique()
        {
            var t1 = DeviceAuthService.GenerateToken();
            var t2 = DeviceAuthService.GenerateToken();
            Assert.NotEqual(t1, t2);
            Assert.DoesNotContain('+', t1);
            Assert.DoesNotContain('/', t1);
            Assert.DoesNotContain('=', t1);
        }

        // ---------- capability / protocol parsing (T1, T5) ----------

        [Theory]
        [InlineData(true, null, true)]
        [InlineData(null, "1", true)]
        [InlineData(null, "true", true)]
        [InlineData(false, "1", true)]
        [InlineData(null, null, false)]
        [InlineData(false, null, false)]
        [InlineData(null, "0", false)]
        public void IsTokenCapable_requires_an_explicit_signal(bool? body, string? header, bool expected)
            => Assert.Equal(expected, DeviceAuthService.IsTokenCapable(body, header));

        [Theory]
        [InlineData("2", null, 2)]
        [InlineData(null, 2, 2)]
        [InlineData("3", 2, 3)]
        [InlineData(null, null, 1)]
        [InlineData("garbage", null, 1)]
        [InlineData("0", 0, 1)]
        public void ParseProtocol_defaults_to_legacy(string? header, int? body, int expected)
            => Assert.Equal(expected, DeviceAuthService.ParseProtocol(header, body));

        // ---------- claim evidence (T2) ----------

        [Theory]
        [InlineData("abc-uuid", null, "ABC-UUID", null, true)]            // uuid matches, case-insensitive
        [InlineData("abc-uuid", null, "other", null, false)]              // uuid mismatch, no mac
        [InlineData("abc-uuid", "AA:BB:CC:DD:EE:FF", "other", "aa-bb-cc-dd-ee-ff", true)] // mac matches despite uuid mismatch
        [InlineData("abc-uuid", "AA:BB:CC:DD:EE:FF", "other", "00:00:00:00:00:00", false)]
        [InlineData(null, null, "anything", null, true)]                  // no evidence on the row at all
        [InlineData(null, "AA:BB:CC:DD:EE:FF", "anything", null, false)]  // row has a mac, caller sends none
        [InlineData("abc-uuid", null, null, null, false)]
        public void ClaimEvidenceMatches_follows_the_contract(string? rowUuid, string? rowMac, string? key, string? mac, bool expected)
            => Assert.Equal(expected, DeviceAuthService.ClaimEvidenceMatches(rowUuid, rowMac, key, mac));

        // ---------- ResolveAsync modes (T3) ----------

        [Fact]
        public async Task Off_mode_accepts_everything_without_touching_the_repository()
        {
            var repo = new FakeDeviceRepository();
            var svc = Make(repo, DeviceAuthMode.Off);
            var r = await svc.ResolveAsync("1", "uuid", null, "ip");
            Assert.True(r.Ok);
            Assert.False(r.Resolved);
        }

        [Fact]
        public async Task IfIssued_accepts_unknown_and_tokenless_devices()
        {
            var repo = new FakeDeviceRepository().Add(1, "uuid-1");
            var svc = Make(repo, DeviceAuthMode.IfIssued);

            var unknown = await svc.ResolveAsync("999", null, null, "ip");
            Assert.True(unknown.Ok);
            Assert.False(unknown.Resolved);

            var tokenless = await svc.ResolveAsync("1", "uuid-1", null, "ip");
            Assert.True(tokenless.Ok);
            Assert.True(tokenless.Resolved);
            Assert.False(tokenless.HasToken);
            Assert.Equal(1, tokenless.DeviceId);
        }

        [Fact]
        public async Task IfIssued_rejects_a_tokened_device_without_or_with_wrong_token_and_accepts_the_right_one()
        {
            var token = DeviceAuthService.GenerateToken();
            var repo = new FakeDeviceRepository().Add(1, "uuid-1", DeviceAuthService.Hash(token));
            var svc = Make(repo, DeviceAuthMode.IfIssued);

            var missing = await svc.ResolveAsync("1", null, null, "ip");
            Assert.False(missing.Ok);
            Assert.Equal(DeviceAuthService.RejectMessage, missing.Message);

            var wrong = await svc.ResolveAsync("1", null, "nope", "ip");
            Assert.False(wrong.Ok);

            var right = await svc.ResolveAsync("1", null, token, "ip");
            Assert.True(right.Ok);
            Assert.True(right.HasToken);
            Assert.Equal(1, right.DeviceId);
            Assert.Equal("uuid-1", right.DeviceUuid);
        }

        [Fact]
        public async Task Required_rejects_unknown_and_tokenless_devices()
        {
            var repo = new FakeDeviceRepository().Add(1, "uuid-1");
            var svc = Make(repo, DeviceAuthMode.Required);

            Assert.False((await svc.ResolveAsync("999", null, null, "ip")).Ok);
            Assert.False((await svc.ResolveAsync("1", null, null, "ip")).Ok);
        }

        [Fact]
        public async Task A_proven_token_resolves_to_its_own_row_even_when_the_other_identifier_names_another_screen()
        {
            var tokenA = DeviceAuthService.GenerateToken();
            var repo = new FakeDeviceRepository()
                .Add(1, "uuid-A", DeviceAuthService.Hash(tokenA))
                .Add(2, "uuid-B");
            var svc = Make(repo, DeviceAuthMode.IfIssued);

            // Valid token for A, but the deviceKey names B (Codex round-2 finding 2): the request is
            // accepted AS A, and the controller passes only A to the procedure, so B is never touched.
            var r = await svc.ResolveAsync("1", "uuid-B", tokenA, "ip");
            Assert.True(r.Ok);
            Assert.Equal(1, r.DeviceId);
            Assert.Equal("uuid-A", r.DeviceUuid);
            Assert.True(r.HasToken);
        }

        [Fact]
        public async Task Conflicting_identifiers_without_a_proving_token_are_refused_when_either_row_is_protected()
        {
            var tokenA = DeviceAuthService.GenerateToken();
            var repo = new FakeDeviceRepository()
                .Add(1, "uuid-A", DeviceAuthService.Hash(tokenA))
                .Add(2, "uuid-B");
            var svc = Make(repo, DeviceAuthMode.IfIssued);

            var missing = await svc.ResolveAsync("1", "uuid-B", null, "ip");
            Assert.False(missing.Ok);
            Assert.Equal(DeviceAuthService.ConflictMessage, missing.Message);

            var wrong = await svc.ResolveAsync("2", "uuid-A", "not-the-token", "ip");
            Assert.False(wrong.Ok);
            Assert.Equal(DeviceAuthService.ConflictMessage, wrong.Message);
        }

        [Fact]
        public async Task Conflicting_identifiers_on_two_tokenless_rows_keep_legacy_behaviour()
        {
            var repo = new FakeDeviceRepository().Add(1, "uuid-A").Add(2, "uuid-B");
            var svc = Make(repo, DeviceAuthMode.IfIssued);

            var r = await svc.ResolveAsync("1", "uuid-B", null, "ip");
            Assert.True(r.Ok);
            Assert.False(r.Resolved); // the procedure reconciles; no canonical row is imposed
        }

        [Fact]
        public async Task Lookup_failure_fails_open_in_IfIssued_and_closed_in_Required()
        {
            var repo = new FakeDeviceRepository();
            // No rows and a repository that throws for any lookup.
            var throwing = new ThrowingRepository();
            Assert.True((await Make(throwing, DeviceAuthMode.IfIssued).ResolveAsync("1", null, null, "ip")).Ok);
            Assert.False((await Make(throwing, DeviceAuthMode.Required).ResolveAsync("1", null, null, "ip")).Ok);
            Assert.Empty(repo.TokenWrites);
        }

        // ---------- register (T1, T4) ----------

        [Fact]
        public async Task Register_without_capability_never_issues_a_token()
        {
            var repo = new FakeDeviceRepository().Add(1, "uuid-1");
            var svc = Make(repo, DeviceAuthMode.IfIssued);
            var device = new DeviceDto { DeviceId = "1", DeviceUuid = "uuid-1" };

            var token = await svc.IssueOrRotateAsync(device, null, tokenCapable: false, "ip");
            Assert.Null(token);
            Assert.Empty(repo.TokenWrites);
        }

        [Fact]
        public async Task Register_with_capability_issues_then_rotates_only_with_the_current_token()
        {
            var repo = new FakeDeviceRepository().Add(1, "uuid-1");
            var svc = Make(repo, DeviceAuthMode.IfIssued);
            var device = new DeviceDto { DeviceId = "1", DeviceUuid = "uuid-1" };

            var first = await svc.IssueOrRotateAsync(device, null, tokenCapable: true, "ip");
            Assert.NotNull(first);
            Assert.Equal(DeviceAuthService.Hash(first!), repo.Rows[0].TokenHash);

            var noToken = await svc.IssueOrRotateAsync(device, null, tokenCapable: true, "ip");
            Assert.Null(noToken);                                  // holds a token, none presented
            Assert.Equal(DeviceAuthService.Hash(first), repo.Rows[0].TokenHash);

            var rotated = await svc.IssueOrRotateAsync(device, first, tokenCapable: true, "ip");
            Assert.NotNull(rotated);
            Assert.NotEqual(first, rotated);
            Assert.Equal(DeviceAuthService.Hash(rotated!), repo.Rows[0].TokenHash);
        }

        [Fact]
        public async Task PreAuthorizeRegister_refuses_a_tokened_row_without_its_token_before_any_mutation()
        {
            var token = DeviceAuthService.GenerateToken();
            var repo = new FakeDeviceRepository().Add(1, "uuid-1", DeviceAuthService.Hash(token));
            var svc = Make(repo, DeviceAuthMode.IfIssued);

            await Assert.ThrowsAsync<DeviceAuthRejectedException>(() => svc.PreAuthorizeRegisterAsync("uuid-1", null, "ip"));
            await Assert.ThrowsAsync<DeviceAuthRejectedException>(() => svc.PreAuthorizeRegisterAsync("uuid-1", "wrong", "ip"));
            await svc.PreAuthorizeRegisterAsync("uuid-1", token, "ip");      // correct token passes
            await svc.PreAuthorizeRegisterAsync("brand-new-uuid", null, "ip"); // unknown key: enrollment
            Assert.Empty(repo.TokenWrites);
        }

        // ---------- register after a reinstall (Round 7: stale-holder re-claim) ----------

        [Theory]
        [InlineData(null, 120, true)]    // never checked in: nothing to protect
        [InlineData(3600, 120, true)]    // holder silent for an hour
        [InlineData(120, 120, true)]     // exactly the threshold
        [InlineData(119, 120, false)]
        [InlineData(15, 120, false)]     // a live screen (heartbeat every 15-20 s)
        [InlineData(-30, 120, false)]    // clock skew reads as "just seen"
        [InlineData(3600, 0, false)]     // 0 disables the rule
        public void IsHolderOffline_follows_the_threshold(int? seen, int threshold, bool expected)
            => Assert.Equal(expected, DeviceAuthService.IsHolderOffline(seen, threshold));

        [Theory]
        [InlineData(null, 120)]
        [InlineData("", 120)]
        [InlineData("abc", 120)]
        [InlineData("-5", 120)]
        [InlineData("0", 0)]
        [InlineData(" 300 ", 300)]
        public void ParseSeconds_falls_back_on_garbage(string? raw, int expected)
            => Assert.Equal(expected, DeviceAuthService.ParseSeconds(raw, 120));

        [Theory]
        [InlineData(DeviceAuthMode.IfIssued)]
        [InlineData(DeviceAuthMode.Required)]
        public async Task Reinstalled_screen_takes_its_row_back_once_the_old_holder_is_offline(DeviceAuthMode mode)
        {
            var oldToken = DeviceAuthService.GenerateToken();
            var repo = new FakeDeviceRepository().Add(1, "uuid-1", DeviceAuthService.Hash(oldToken), seenSecondsAgo: 3600);
            var svc = Make(repo, mode);

            // The setup screen sends the hardware uuid, no token, tokenCapable: true.
            var pre = await svc.PreAuthorizeRegisterAsync("uuid-1", null, "ip", tokenCapable: true);
            Assert.True(pre.StaleReclaim);
            Assert.Equal(1, pre.DeviceId);

            // REGISTER_OR_LOGIN refreshed last_check_in in between; the decision still stands.
            repo.Rows[0].SecondsSinceCheckIn = 0;
            var device = new DeviceDto { DeviceId = "1", DeviceUuid = "uuid-1" };
            var fresh = await svc.IssueOrRotateAsync(device, null, tokenCapable: true, "ip", pre);

            Assert.NotNull(fresh);
            Assert.NotEqual(oldToken, fresh);
            Assert.Equal(DeviceAuthService.Hash(fresh!), repo.Rows[0].TokenHash);   // old token is dead
            Assert.Single(repo.TokenWrites);
            Assert.True(DeviceAuthService.TokenMatches(fresh, repo.Rows[0].TokenHash));
        }

        [Fact]
        public async Task Register_still_refuses_while_the_holder_is_checking_in_and_says_why()
        {
            var token = DeviceAuthService.GenerateToken();
            var repo = new FakeDeviceRepository().Add(7, "uuid-7", DeviceAuthService.Hash(token), seenSecondsAgo: 15);
            var svc = Make(repo, DeviceAuthMode.IfIssued);

            var ex = await Assert.ThrowsAsync<DeviceAuthRejectedException>(() => svc.PreAuthorizeRegisterAsync("uuid-7", null, "ip", tokenCapable: true));
            Assert.StartsWith(DeviceAuthService.RejectMessage, ex.Message);   // clients key on the code
            Assert.Contains("device 7", ex.Detail);
            Assert.Contains("15 s ago", ex.Detail);
            Assert.Contains("Reset device token", ex.Detail);
            Assert.Empty(repo.TokenWrites);
            Assert.Equal(DeviceAuthService.Hash(token), repo.Rows[0].TokenHash);
        }

        [Fact]
        public async Task Legacy_client_cannot_take_over_a_stale_row()
        {
            // A client that would discard the token must not strip the row of its current one.
            var repo = new FakeDeviceRepository().Add(1, "uuid-1", DeviceAuthService.Hash("t"), seenSecondsAgo: 3600);
            var svc = Make(repo, DeviceAuthMode.IfIssued);

            var ex = await Assert.ThrowsAsync<DeviceAuthRejectedException>(() => svc.PreAuthorizeRegisterAsync("uuid-1", null, "ip", tokenCapable: false));
            Assert.Contains("cannot store one", ex.Detail);
            Assert.Empty(repo.TokenWrites);
        }

        [Fact]
        public async Task Stale_reclaim_is_dropped_when_the_holder_rotated_in_between()
        {
            var oldToken = DeviceAuthService.GenerateToken();
            var repo = new FakeDeviceRepository().Add(1, "uuid-1", DeviceAuthService.Hash(oldToken), seenSecondsAgo: 3600);
            var svc = Make(repo, DeviceAuthMode.IfIssued);
            var pre = await svc.PreAuthorizeRegisterAsync("uuid-1", null, "ip", tokenCapable: true);
            Assert.True(pre.StaleReclaim);

            // The "offline" screen came back and rotated its token before our register issued.
            var rotated = DeviceAuthService.GenerateToken();
            repo.Rows[0].TokenHash = DeviceAuthService.Hash(rotated);

            var device = new DeviceDto { DeviceId = "1", DeviceUuid = "uuid-1" };
            var token = await svc.IssueOrRotateAsync(device, null, tokenCapable: true, "ip", pre);
            Assert.Null(token);                                                     // REGISTER_WITHOUT_TOKEN path
            Assert.Equal(DeviceAuthService.Hash(rotated), repo.Rows[0].TokenHash); // the live holder keeps its token
            Assert.Empty(repo.TokenWrites);

            await Assert.ThrowsAsync<DeviceAuthRejectedException>(
                () => Make(repo, DeviceAuthMode.Required).IssueOrRotateAsync(device, null, tokenCapable: true, "ip", pre));
        }

        [Fact]
        public async Task Stale_reclaim_can_be_switched_off()
        {
            var repo = new FakeDeviceRepository().Add(1, "uuid-1", DeviceAuthService.Hash("t"), seenSecondsAgo: 3600);
            var svc = new DeviceAuthService(repo, new FakeSystemLogRepository(), DeviceAuthMode.IfIssued, false, reclaimAfterOfflineSeconds: 0);

            var ex = await Assert.ThrowsAsync<DeviceAuthRejectedException>(() => svc.PreAuthorizeRegisterAsync("uuid-1", null, "ip", tokenCapable: true));
            Assert.Contains("device 1", ex.Detail);
            Assert.Empty(repo.TokenWrites);
        }

        [Fact]
        public async Task Pre_auth_without_a_stale_decision_leaves_issuance_unchanged()
        {
            var repo = new FakeDeviceRepository().Add(1, "uuid-1", DeviceAuthService.Hash("t"), seenSecondsAgo: 3600);
            var svc = Make(repo, DeviceAuthMode.IfIssued);
            var device = new DeviceDto { DeviceId = "1", DeviceUuid = "uuid-1" };

            Assert.Null(await svc.IssueOrRotateAsync(device, null, tokenCapable: true, "ip"));
            Assert.Null(await svc.IssueOrRotateAsync(device, null, tokenCapable: true, "ip", RegisterPreAuth.None));
            Assert.Empty(repo.TokenWrites);
        }

        // ---------- claim (T2) ----------

        [Fact]
        public async Task Claim_resolves_only_the_named_row_and_follows_the_evidence_rule()
        {
            var repo = new FakeDeviceRepository()
                .Add(1, "uuid-1", mac: "AA:BB:CC:DD:EE:01")
                .Add(2, "uuid-2");
            var svc = Make(repo, DeviceAuthMode.IfIssued);

            Assert.Equal(ClaimStatus.NotFound, (await svc.ClaimAsync("999", "x", null, null, "ip")).Status);

            var mismatch = await svc.ClaimAsync("1", "uuid-2", null, null, "ip");  // another screen's key
            Assert.Equal(ClaimStatus.EvidenceMismatch, mismatch.Status);
            Assert.Empty(repo.TokenWrites);

            var byMac = await svc.ClaimAsync("1", "drifted-uuid", "aa-bb-cc-dd-ee-01", null, "ip");
            Assert.Equal(ClaimStatus.Issued, byMac.Status);
            Assert.NotNull(byMac.Token);
            Assert.Equal(1, byMac.Info!.DeviceId);
            Assert.Single(repo.TokenWrites);

            var again = await svc.ClaimAsync("1", "uuid-1", null, null, "ip");
            Assert.Equal(ClaimStatus.AlreadyIssued, again.Status);

            var rotated = await svc.ClaimAsync("1", "uuid-1", null, byMac.Token, "ip");
            Assert.Equal(ClaimStatus.Rotated, rotated.Status);
            Assert.NotEqual(byMac.Token, rotated.Token);
        }

        [Fact]
        public async Task Reset_clears_the_hash_so_the_next_claim_succeeds()
        {
            var token = DeviceAuthService.GenerateToken();
            var repo = new FakeDeviceRepository().Add(1, "uuid-1", DeviceAuthService.Hash(token));
            var svc = Make(repo, DeviceAuthMode.IfIssued);

            await svc.ResetAsync("1", 42);
            Assert.Null(repo.Rows[0].TokenHash);

            var claim = await svc.ClaimAsync("1", "uuid-1", null, null, "ip");
            Assert.Equal(ClaimStatus.Issued, claim.Status);
        }

        [Theory]
        [InlineData(null, DeviceAuthMode.IfIssued)]
        [InlineData("", DeviceAuthMode.IfIssued)]
        [InlineData("required", DeviceAuthMode.Required)]
        [InlineData("OFF", DeviceAuthMode.Off)]
        [InlineData("bogus", DeviceAuthMode.IfIssued)]
        public void ParseMode_defaults_to_IfIssued(string? raw, DeviceAuthMode expected)
            => Assert.Equal(expected, DeviceAuthService.ParseMode(raw));

        private sealed class ThrowingRepository : FakeDeviceRepositoryBase
        {
            public override Task<DeviceAuthInfo?> GetDeviceAuthInfoAsync(string deviceId, string? deviceUuid)
                => throw new InvalidOperationException("Invalid column name 'device_token_hash'");
        }

        // Minimal base that delegates to the fake and lets a test override one member.
        private abstract class FakeDeviceRepositoryBase : SignageUnicorn.Api.Repositories.Interfaces.IDeviceRepository
        {
            private readonly FakeDeviceRepository _inner = new();
            public virtual Task<DeviceAuthInfo?> GetDeviceAuthInfoAsync(string deviceId, string? deviceUuid) => _inner.GetDeviceAuthInfoAsync(deviceId, deviceUuid);
            public Task SetDeviceTokenHashAsync(long deviceId, string? tokenHash) => _inner.SetDeviceTokenHashAsync(deviceId, tokenHash);
            public Task<bool> TrySetDeviceTokenHashAsync(long deviceId, string? expectedHash, string newHash) => _inner.TrySetDeviceTokenHashAsync(deviceId, expectedHash, newHash);
            public Task ResetDeviceTokenAsync(long deviceId) => _inner.ResetDeviceTokenAsync(deviceId);
            public Task<DeviceAuthInfo?> GetDeviceAuthInfoByMacAsync(string macAddress, string? excludeUuid) => _inner.GetDeviceAuthInfoByMacAsync(macAddress, excludeUuid);
            public Task<IEnumerable<string>> GetScheduleInheritorsAsync(string deviceId) => _inner.GetScheduleInheritorsAsync(deviceId);
            public Task ExecuteSqlAsync(string sql) => _inner.ExecuteSqlAsync(sql);
            public Task ExecuteSqlAsync(string sql, object? parameters) => _inner.ExecuteSqlAsync(sql, parameters);
            public Task<T?> QueryScalarAsync<T>(string sql, object? parameters = null) => _inner.QueryScalarAsync<T>(sql, parameters);
            public Task<IEnumerable<T>> QueryListAsync<T>(string sql, object? parameters = null) => _inner.QueryListAsync<T>(sql, parameters);
            public Task<SignageUnicorn.Api.Repositories.Interfaces.ISchemaSession> OpenSchemaSessionAsync() => _inner.OpenSchemaSessionAsync();
            public Task<RepositoryResult<DeviceDto>> RegisterOrLoginAsync(DeviceRegisterRequest request) => _inner.RegisterOrLoginAsync(request);
            public Task<IEnumerable<DeviceCommandDto>> HeartbeatAsync(HeartbeatRequest request) => _inner.HeartbeatAsync(request);
            public Task<IEnumerable<DeviceDto>> GetAllDevicesAsync() => _inner.GetAllDevicesAsync();
            public Task<DeviceDto?> GetDeviceByIdAsync(string deviceId) => _inner.GetDeviceByIdAsync(deviceId);
            public Task<RepositoryResult> AddCommandAsync(string deviceId, string commandType) => _inner.AddCommandAsync(deviceId, commandType);
            public Task<RepositoryResult> AcknowledgeCommandAsync(string deviceId, string commandId, string status, long? userId = null, string? message = null) => _inner.AcknowledgeCommandAsync(deviceId, commandId, status, userId, message);
            public Task<RepositoryResult> DeactivateDeviceAsync(string deviceId, long? userId = null) => _inner.DeactivateDeviceAsync(deviceId, userId);
            public Task<RepositoryResult> CleanupOfflineDevicesAsync(int days = 14) => _inner.CleanupOfflineDevicesAsync(days);
            public Task<RepositoryResult<int>> GetOfflineDeviceCountAsync(int days = 14) => _inner.GetOfflineDeviceCountAsync(days);
            public Task<IEnumerable<DeviceDto>> GetDevicesByMediaIdAsync(string mediaId) => _inner.GetDevicesByMediaIdAsync(mediaId);
            public Task<IEnumerable<DeviceDto>> GetDevicesByPlaylistIdAsync(string playlistId) => _inner.GetDevicesByPlaylistIdAsync(playlistId);
            public Task<IEnumerable<PlaylistDeviceDto>> GetDevicesForPlaylistViewAsync(string playlistId) => _inner.GetDevicesForPlaylistViewAsync(playlistId);
            public Task<IEnumerable<DevicePlaylistDto>> GetAssignedPlaylistsAsync(string deviceId) => _inner.GetAssignedPlaylistsAsync(deviceId);
            public Task<string?> GetSiblingDeviceIdWithAssignmentsAsync(string deviceId) => _inner.GetSiblingDeviceIdWithAssignmentsAsync(deviceId);
            public Task UpdateAssignedPlaylistsAsync(string deviceId, List<DevicePlaylistDto> playlists) => _inner.UpdateAssignedPlaylistsAsync(deviceId, playlists);
            public Task SetScheduleModeAsync(string deviceId, string mode) => _inner.SetScheduleModeAsync(deviceId, mode);
            public Task ResetScheduleToInheritAsync(string deviceId) => _inner.ResetScheduleToInheritAsync(deviceId);
            public Task<IEnumerable<string>> GetDevicesWithScheduleTransitionsAsync(DateTime fromUtc, DateTime toUtc) => _inner.GetDevicesWithScheduleTransitionsAsync(fromUtc, toUtc);
        }
    }
}
