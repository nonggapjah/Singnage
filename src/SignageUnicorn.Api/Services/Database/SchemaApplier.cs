using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using SignageUnicorn.Api.Repositories.Interfaces;

namespace SignageUnicorn.Api.Services.Database
{
    // F14 / F15. Applying docs/db_template used to mean "replay every file on every start":
    //   - every stored procedure was rewritten from disk, newer or not (on 20-08-2026 that silently
    //     reverted a hot-fix that had been applied and verified in production);
    //   - a table script that failed on an existing table was treated as fully applied, so any ALTER
    //     or index statement later in the same file never ran -- schema drift that nothing reported.
    // Now:
    //   1. table/   : idempotent CREATE scripts; "already exists" is tolerated PER BATCH and the
    //      remaining batches of the file (indexes, constraints) still run (contract T9 / round-2 #25);
    //   2. migrations/ : ordered NNN_name.sql files, each applied ONCE and recorded in
    //      sn_schema_migrations; a failure stops the migration chain, is reported, and ALSO stops
    //      the procedures from being applied (round-2 #26: code that expects a column the migration
    //      did not add must not be wired into the database);
    //   3. procedure/  : applied only when the file's SHA-256 differs from what sn_schema_objects
    //      recorded last time, so an unchanged file never clobbers a procedure patched in the DB,
    //      while a changed file still wins (merge your hot-fix into the repo, then it sticks).
    //   4. (round 4, Codex round-4 finding 2) the whole apply runs on ONE connection holding an
    //      exclusive application lock: the migration check, every batch of every migration
    //      (migration 007's checkpointed batches included) and the ledger writes. Two overlapping
    //      applies could otherwise read the same checkpoint and shift the same rows twice. A second
    //      process that cannot get the lock within LockTimeout applies nothing and says so.
    public sealed class SchemaApplier
    {
        public static readonly TimeSpan LockTimeout = TimeSpan.FromMinutes(10);
        public const string InProgressMessage = "another schema apply is in progress (database lock held by another process); nothing was applied";

        private readonly IDeviceRepository _db;

        public SchemaApplier(IDeviceRepository db)
        {
            _db = db;
        }

        public async Task<SchemaApplyResult> ApplyAsync(string docsPath)
        {
            var report = new SchemaApplyResult { SourcePath = docsPath };

            ISchemaSession session;
            try
            {
                session = await _db.OpenSchemaSessionAsync();
            }
            catch (Exception ex)
            {
                report.Failed.Add($"cannot open the schema connection: {ex.Message}");
                return report;
            }

            await using (session)
            {
                bool locked;
                try
                {
                    locked = await session.TryAcquireApplyLockAsync(LockTimeout);
                }
                catch (Exception ex)
                {
                    report.Failed.Add($"schema apply lock: {ex.Message}");
                    return report;
                }

                if (!locked)
                {
                    report.InProgress = true;
                    report.Failed.Add(InProgressMessage);
                    return report;
                }

                try
                {
                    await ApplyLockedAsync(session, docsPath, report);
                }
                finally
                {
                    await session.ReleaseApplyLockAsync();
                }
            }

            return report;
        }

        // Everything in here runs on the locked session connection.
        private static async Task ApplyLockedAsync(ISchemaSession s, string docsPath, SchemaApplyResult report)
        {
            try
            {
                await EnsureLedgerTablesAsync(s);
            }
            catch (Exception ex)
            {
                report.Failed.Add($"ledger tables: {ex.Message}");
                return;
            }

            // 1. Tables
            var tablePath = Path.Combine(docsPath, "table");
            if (Directory.Exists(tablePath))
            {
                foreach (var file in Directory.GetFiles(tablePath, "*.sql").OrderBy(f => f, StringComparer.OrdinalIgnoreCase))
                {
                    var error = await ExecuteSqlFileAsync(s, file, tolerateAlreadyExists: true);
                    if (error == null) report.Applied.Add(Path.GetFileName(file));
                    else report.Failed.Add($"{Path.GetFileName(file)}: {error}");
                }
            }

            // 2. Migrations (ordered, once each)
            bool migrationsOk = true;
            var migrationPath = Path.Combine(docsPath, "migrations");
            if (Directory.Exists(migrationPath))
            {
                var applied = new HashSet<string>(
                    await s.QueryListAsync<string>("SELECT name FROM dbo.sn_schema_migrations"),
                    StringComparer.OrdinalIgnoreCase);

                foreach (var file in Directory.GetFiles(migrationPath, "*.sql").OrderBy(f => f, StringComparer.OrdinalIgnoreCase))
                {
                    var name = Path.GetFileName(file);
                    if (applied.Contains(name)) { report.Unchanged.Add(name); continue; }

                    var error = await ExecuteSqlFileAsync(s, file, tolerateAlreadyExists: false);
                    if (error != null)
                    {
                        report.Failed.Add($"{name}: {error}");
                        // Later migrations may depend on this one; stop here rather than apply out of order.
                        report.Failed.Add("migration chain halted; later migrations were not attempted");
                        migrationsOk = false;
                        break;
                    }

                    await s.ExecuteSqlAsync("INSERT INTO dbo.sn_schema_migrations (name, applied_at) VALUES (@name, SYSUTCDATETIME())", new { name });
                    report.Migrations.Add(name);
                }
            }

            // 3. Procedures (hash-gated) -- only on a schema the migrations brought up to date.
            if (!migrationsOk)
            {
                report.ProceduresSkipped = true;
                report.Failed.Add("procedures NOT applied: a migration failed and the procedure files assume the columns it adds. Fix the migration and run Re-apply Schema.");
                return;
            }

            var procPath = Path.Combine(docsPath, "procedure");
            if (Directory.Exists(procPath))
            {
                foreach (var file in Directory.GetFiles(procPath, "*.sql").OrderBy(f => f, StringComparer.OrdinalIgnoreCase))
                {
                    var name = Path.GetFileName(file);
                    string hash;
                    try
                    {
                        hash = HashFile(file);
                    }
                    catch (Exception ex)
                    {
                        report.Failed.Add($"{name}: {ex.Message}");
                        continue;
                    }

                    var recorded = await s.QueryScalarAsync<string>("SELECT sha256 FROM dbo.sn_schema_objects WHERE name = @name", new { name });
                    if (string.Equals(recorded, hash, StringComparison.OrdinalIgnoreCase))
                    {
                        report.Unchanged.Add(name);
                        continue;
                    }

                    var error = await ExecuteSqlFileAsync(s, file, tolerateAlreadyExists: false);
                    if (error != null)
                    {
                        report.Failed.Add($"{name}: {error}");
                        continue;
                    }

                    await s.ExecuteSqlAsync(@"
                        MERGE dbo.sn_schema_objects AS t
                        USING (SELECT @name AS name) AS s ON t.name = s.name
                        WHEN MATCHED THEN UPDATE SET sha256 = @hash, applied_at = SYSUTCDATETIME()
                        WHEN NOT MATCHED THEN INSERT (name, sha256, applied_at) VALUES (@name, @hash, SYSUTCDATETIME());",
                        new { name, hash });
                    report.Applied.Add(name);
                }
            }
        }

        private static async Task EnsureLedgerTablesAsync(ISchemaSession s)
        {
            await s.ExecuteSqlAsync(@"
                IF OBJECT_ID('dbo.sn_schema_migrations', 'U') IS NULL
                    CREATE TABLE dbo.sn_schema_migrations (
                        name       NVARCHAR(200) NOT NULL CONSTRAINT PK_sn_schema_migrations PRIMARY KEY,
                        applied_at DATETIME2(7)  NOT NULL CONSTRAINT DF_sn_schema_migrations_applied_at DEFAULT SYSUTCDATETIME()
                    );");
            await s.ExecuteSqlAsync(@"
                IF OBJECT_ID('dbo.sn_schema_objects', 'U') IS NULL
                    CREATE TABLE dbo.sn_schema_objects (
                        name       NVARCHAR(200) NOT NULL CONSTRAINT PK_sn_schema_objects PRIMARY KEY,
                        sha256     NVARCHAR(64)  NOT NULL,
                        applied_at DATETIME2(7)  NOT NULL CONSTRAINT DF_sn_schema_objects_applied_at DEFAULT SYSUTCDATETIME()
                    );");
        }

        internal static string HashContent(string text)
        {
            // Normalise line endings so a CRLF/LF checkout difference does not count as a change.
            var normalised = text.Replace("\r\n", "\n");
            var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(normalised));
            return Convert.ToHexString(bytes).ToLowerInvariant();
        }

        private static string HashFile(string path) => HashContent(File.ReadAllText(path));

        // Same batch splitting the old ExecuteSqlFile used: GO on a line of its own, case-insensitive,
        // CRLF or LF. Empty batches are dropped.
        internal static IReadOnlyList<string> SplitBatches(string content)
        {
            var parts = Regex.Split(content ?? string.Empty, @"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase);
            var batches = new List<string>();
            foreach (var part in parts)
            {
                var sql = part.Trim();
                if (sql.Length > 0) batches.Add(sql);
            }
            return batches;
        }

        internal static bool IsAlreadyExistsError(string? message)
        {
            if (string.IsNullOrEmpty(message)) return false;
            return message.Contains("There is already an object named", StringComparison.OrdinalIgnoreCase)
                || message.Contains("already exists", StringComparison.OrdinalIgnoreCase);
        }

        // Executes a file batch by batch. Returns null on success, otherwise the failure message.
        // Contract T9 / round-2 #25: "already exists" is tolerated for the ONE batch that raised it
        // (the CREATE TABLE of a table that is already there) and the remaining batches of the file
        // -- the IF NOT EXISTS index and constraint blocks -- are still executed. The old code caught
        // the exception around the whole file and reported it as applied.
        private static async Task<string?> ExecuteSqlFileAsync(ISchemaSession s, string filePath, bool tolerateAlreadyExists)
        {
            string content;
            try
            {
                content = await File.ReadAllTextAsync(filePath);
            }
            catch (Exception ex)
            {
                return $"cannot read file: {ex.Message}";
            }

            var batches = SplitBatches(content);
            for (int i = 0; i < batches.Count; i++)
            {
                try
                {
                    await s.ExecuteSqlAsync(batches[i]);
                }
                catch (Exception ex)
                {
                    if (tolerateAlreadyExists && IsAlreadyExistsError(ex.Message))
                    {
                        continue;
                    }
                    Console.WriteLine($"[ERROR] Failed to execute {Path.GetFileName(filePath)} batch {i + 1}/{batches.Count}: {ex.Message}");
                    return $"batch {i + 1}/{batches.Count}: {ex.Message}";
                }
            }
            Console.WriteLine($" -> Executed: {Path.GetFileName(filePath)} ({batches.Count} batch(es))");
            return null;
        }
    }

    // Outcome of applying docs/db_template. Exists so the caller can tell an operator what actually
    // happened instead of reporting success unconditionally.
    public class SchemaApplyResult
    {
        public List<string> Applied { get; set; } = new();      // table scripts run, procedures rewritten
        public List<string> Migrations { get; set; } = new();   // migrations applied for the first time
        public List<string> Unchanged { get; set; } = new();    // migrations already applied, procedures with same hash
        public List<string> Failed { get; set; } = new();
        public bool ProceduresSkipped { get; set; }             // T9: a migration failed, procedures left alone
        public bool InProgress { get; set; }                    // round 4 (#2): another apply holds the lock / gate; nothing was done
        public string? Skipped { get; set; }
        public string? SourcePath { get; set; }
        public bool Success => Skipped == null && Failed.Count == 0;
    }
}
