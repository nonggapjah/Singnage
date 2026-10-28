using SignageUnicorn.Api.Constants;
using SignageUnicorn.Api.Services;
using SignageUnicorn.Api.Services.Background;
using SignageUnicorn.Api.Services.Database;
using SignageUnicorn.Api.Tests.Fakes;
using Xunit;

namespace SignageUnicorn.Api.Tests
{
    // Round 4 (Codex round-4 findings 2, 3, 4, 11): serialized schema application, versioned
    // logical media names, transition-window retention, unchanged-role no-op.
    public class Round4SchemaApplyLockTests
    {
        private static string MakeTemplate()
        {
            var root = Path.Combine(Path.GetTempPath(), "su-schema-r4-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Path.Combine(root, "table"));
            Directory.CreateDirectory(Path.Combine(root, "migrations"));
            Directory.CreateDirectory(Path.Combine(root, "procedure"));
            File.WriteAllText(Path.Combine(root, "table", "T.sql"), "CREATE TABLE dbo.t (id int)\nGO\n");
            File.WriteAllText(Path.Combine(root, "migrations", "001_add_c.sql"), "IF COL_LENGTH('dbo.t','c') IS NULL ALTER TABLE dbo.t ADD c int\nGO\nUPDATE dbo.t SET c = 1\nGO\n");
            File.WriteAllText(Path.Combine(root, "procedure", "sp_t.sql"), "CREATE OR ALTER PROCEDURE dbo.sp_t AS SELECT 1\nGO\n");
            return root;
        }

        [Fact]
        public async Task When_the_database_lock_is_held_elsewhere_nothing_is_applied_and_the_report_says_so()
        {
            var root = MakeTemplate();
            try
            {
                var repo = new FakeDeviceRepository { SchemaLockAvailable = false };
                var report = await new SchemaApplier(repo).ApplyAsync(root);

                Assert.True(report.InProgress);
                Assert.False(report.Success);
                Assert.Contains(report.Failed, f => f.Contains("in progress"));
                Assert.Empty(repo.ExecutedSql);          // no ledger tables, no batches
                Assert.Empty(repo.AppliedMigrations);
                Assert.NotNull(repo.LastSession);
                Assert.Equal(1, repo.LastSession!.LockAttempts);
                Assert.True(repo.LastSession.Disposed);  // the connection is still closed
            }
            finally { Directory.Delete(root, true); }
        }

        [Fact]
        public async Task Every_statement_runs_on_the_locked_session_and_the_lock_is_released_afterwards()
        {
            var root = MakeTemplate();
            try
            {
                var repo = new FakeDeviceRepository();
                var report = await new SchemaApplier(repo).ApplyAsync(root);

                Assert.True(report.Success, string.Join(" ; ", report.Failed));
                Assert.Contains("001_add_c.sql", report.Migrations);
                Assert.Equal(0, repo.DirectSqlCalls);                     // nothing bypassed the session
                Assert.True(repo.LastSession!.StatementsRun >= 6);        // ledger x2, table, migration x2 batches, ledger insert, proc...
                Assert.False(repo.LastSession.LockHeld);
                Assert.Equal(1, repo.LastSession.LockReleases);
                Assert.True(repo.LastSession.Disposed);
            }
            finally { Directory.Delete(root, true); }
        }

        [Fact]
        public async Task The_lock_is_released_even_when_a_migration_fails()
        {
            var root = MakeTemplate();
            try
            {
                var repo = new FakeDeviceRepository
                {
                    FailOn = sql => sql.StartsWith("UPDATE dbo.t") ? new InvalidOperationException("boom") : null
                };
                var report = await new SchemaApplier(repo).ApplyAsync(root);

                Assert.False(report.Success);
                Assert.True(report.ProceduresSkipped);
                Assert.False(repo.LastSession!.LockHeld);
                Assert.Equal(1, repo.LastSession.LockReleases);
                Assert.Equal(0, repo.DirectSqlCalls);
            }
            finally { Directory.Delete(root, true); }
        }

        [Fact]
        public void In_process_gate_admits_one_apply_at_a_time()
        {
            Assert.True(SchemaApplyGate.TryEnter());
            try
            {
                Assert.True(SchemaApplyGate.IsBusy);
                Assert.False(SchemaApplyGate.TryEnter());
            }
            finally
            {
                SchemaApplyGate.Exit();
            }
            Assert.False(SchemaApplyGate.IsBusy);
            Assert.True(SchemaApplyGate.TryEnter());
            SchemaApplyGate.Exit();
        }
    }

    public class Round4MediaFileNamingTests
    {
        [Theory]
        [InlineData("clip.mp4", null, "clip.v2.mp4")]
        [InlineData("clip.v2.mp4", null, "clip.v3.mp4")]
        [InlineData("clip.v9.mp4", null, "clip.v10.mp4")]
        [InlineData("Buyer_01CPF_M92025.mov", ".mp4", "Buyer_01CPF_M92025.v2.mp4")]
        [InlineData("Buyer.v4.mov", "mp4", "Buyer.v5.mp4")]
        [InlineData("noext", null, "noext.v2")]
        [InlineData("  spaced.png ", null, "spaced.v2.png")]
        [InlineData("version.v0.mp4", null, "version.v0.v2.mp4")] // v0 is not a version suffix we produced
        [InlineData("x.vabc.mp4", null, "x.vabc.v2.mp4")]
        public void BumpVersion_appends_or_increments_the_version_suffix(string input, string? ext, string expected)
            => Assert.Equal(expected, MediaFileNaming.BumpVersion(input, ext));

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        [InlineData("   ")]
        public void BumpVersion_returns_null_when_there_is_no_usable_name(string? input)
            => Assert.Null(MediaFileNaming.BumpVersion(input, ".mp4"));
    }

    public class Round4RoleChangeTests
    {
        [Theory]
        [InlineData("editor", "editor", null)]
        [InlineData("Editor", "editor", null)]
        [InlineData(" ADMIN ", "admin", null)]
        [InlineData("viewer", "editor", "editor")]
        [InlineData(null, "viewer", "viewer")]
        [InlineData("garbage", "viewer", "viewer")]
        public void ChangeOrNull_drops_a_role_that_the_user_already_has(string? current, string requested, string? expected)
            => Assert.Equal(expected, UserRoles.ChangeOrNull(current, requested));

        [Fact]
        public void ChangeOrNull_passes_null_through()
            => Assert.Null(UserRoles.ChangeOrNull("admin", null));
    }
}
