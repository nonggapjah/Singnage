using SignageUnicorn.Api.Services.Database;
using SignageUnicorn.Api.Tests.Fakes;
using Xunit;

namespace SignageUnicorn.Api.Tests
{
    public class SchemaApplierTests
    {
        [Fact]
        public void SplitBatches_splits_on_GO_lines_only_case_insensitive_crlf_or_lf()
        {
            var content = "SET ANSI_NULLS ON\r\nGO\r\nCREATE TABLE t (id int)\nGO\n\n  go  \nSELECT 'GO' AS not_a_separator;\nALTER TABLE t ADD c int -- GOTO ResultSection\nGO\n";
            var batches = SchemaApplier.SplitBatches(content);
            Assert.Equal(3, batches.Count);
            Assert.Equal("SET ANSI_NULLS ON", batches[0]);
            Assert.Equal("CREATE TABLE t (id int)", batches[1]);
            Assert.Contains("SELECT 'GO' AS not_a_separator;", batches[2]);
            Assert.Contains("GOTO ResultSection", batches[2]);
        }

        [Fact]
        public void SplitBatches_drops_empty_batches_and_handles_empty_input()
        {
            Assert.Empty(SchemaApplier.SplitBatches(""));
            Assert.Empty(SchemaApplier.SplitBatches("GO\nGO\n   \n"));
        }

        [Theory]
        [InlineData("There is already an object named 'sn_devices' in the database.", true)]
        [InlineData("Column names in each table must be unique. Column name 'x' in table 't' is specified more than once.", false)]
        [InlineData("The index 'IX_x' already exists", true)]
        [InlineData("", false)]
        [InlineData(null, false)]
        public void IsAlreadyExistsError_matches_only_the_duplicate_object_messages(string? message, bool expected)
            => Assert.Equal(expected, SchemaApplier.IsAlreadyExistsError(message));

        [Fact]
        public void HashContent_ignores_line_ending_differences()
        {
            Assert.Equal(SchemaApplier.HashContent("a\r\nb\r\n"), SchemaApplier.HashContent("a\nb\n"));
            Assert.NotEqual(SchemaApplier.HashContent("a\nb\n"), SchemaApplier.HashContent("a\nc\n"));
        }

        private static string MakeTemplate(out string tableSql, out string migrationSql, out string procSql)
        {
            var root = Path.Combine(Path.GetTempPath(), "su-schema-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Path.Combine(root, "table"));
            Directory.CreateDirectory(Path.Combine(root, "migrations"));
            Directory.CreateDirectory(Path.Combine(root, "procedure"));

            tableSql = "CREATE TABLE dbo.t (id int)\nGO\nIF NOT EXISTS (SELECT 1) CREATE INDEX IX_t ON dbo.t (id)\nGO\n";
            migrationSql = "IF COL_LENGTH('dbo.t','c') IS NULL ALTER TABLE dbo.t ADD c int\nGO\n";
            procSql = "CREATE OR ALTER PROCEDURE dbo.sp_t AS SELECT 1\nGO\n";

            File.WriteAllText(Path.Combine(root, "table", "T.sql"), tableSql);
            File.WriteAllText(Path.Combine(root, "migrations", "001_add_c.sql"), migrationSql);
            File.WriteAllText(Path.Combine(root, "procedure", "sp_t.sql"), procSql);
            return root;
        }

        [Fact]
        public async Task Existing_table_error_is_tolerated_per_batch_and_later_batches_still_run()
        {
            var root = MakeTemplate(out _, out _, out _);
            try
            {
                var repo = new FakeDeviceRepository
                {
                    FailOn = sql => sql.StartsWith("CREATE TABLE") ? new InvalidOperationException("There is already an object named 't' in the database.") : null
                };
                var report = await new SchemaApplier(repo).ApplyAsync(root);

                Assert.True(report.Success, string.Join(" ; ", report.Failed));
                Assert.Contains("T.sql", report.Applied);
                Assert.Contains(repo.ExecutedSql, s => s.StartsWith("IF NOT EXISTS (SELECT 1) CREATE INDEX IX_t"));
                Assert.Contains("001_add_c.sql", report.Migrations);
                Assert.Contains("sp_t.sql", report.Applied);
                Assert.False(report.ProceduresSkipped);
            }
            finally { Directory.Delete(root, true); }
        }

        [Fact]
        public async Task A_failed_migration_halts_the_chain_and_skips_the_procedures()
        {
            var root = MakeTemplate(out _, out _, out _);
            try
            {
                var repo = new FakeDeviceRepository
                {
                    FailOn = sql => sql.StartsWith("IF COL_LENGTH") ? new InvalidOperationException("Invalid column name") : null
                };
                var report = await new SchemaApplier(repo).ApplyAsync(root);

                Assert.False(report.Success);
                Assert.True(report.ProceduresSkipped);
                Assert.Empty(report.Migrations);
                Assert.DoesNotContain("sp_t.sql", report.Applied);
                Assert.DoesNotContain(repo.ExecutedSql, s => s.StartsWith("CREATE OR ALTER PROCEDURE"));
                Assert.Contains(report.Failed, f => f.Contains("procedures NOT applied"));
            }
            finally { Directory.Delete(root, true); }
        }

        [Fact]
        public async Task Unchanged_procedures_and_applied_migrations_are_not_replayed()
        {
            var root = MakeTemplate(out _, out _, out var procSql);
            try
            {
                var repo = new FakeDeviceRepository();
                repo.AppliedMigrations.Add("001_add_c.sql");
                repo.RecordedProcedureHashes["sp_t.sql"] = SchemaApplier.HashContent(procSql);

                var report = await new SchemaApplier(repo).ApplyAsync(root);

                Assert.True(report.Success);
                Assert.Contains("001_add_c.sql", report.Unchanged);
                Assert.Contains("sp_t.sql", report.Unchanged);
                Assert.DoesNotContain(repo.ExecutedSql, s => s.StartsWith("CREATE OR ALTER PROCEDURE"));
                Assert.DoesNotContain(repo.ExecutedSql, s => s.StartsWith("IF COL_LENGTH"));
            }
            finally { Directory.Delete(root, true); }
        }
    }
}
