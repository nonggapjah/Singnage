using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Models.Domain;
using SignageUnicorn.Api.Repositories.Interfaces;
using SignageUnicorn.Api.Services;

namespace SignageUnicorn.Api.Tests.Fakes
{
    // In-memory stand-in for the device repository. Only the members the units under test touch are
    // implemented; everything else throws so a test that strays is loud about it.
    public sealed class FakeDeviceRepository : IDeviceRepository
    {
        public List<DeviceAuthInfo> Rows { get; } = new();
        public List<(long DeviceId, string? Hash)> TokenWrites { get; } = new();
        public List<(string DeviceId, string Command)> Commands { get; } = new();
        // Round 3 (R3): inheritors per owner id, for NotifyScheduleInheritors tests.
        public Dictionary<string, List<string>> Inheritors { get; } = new();

        // Round 3 (R3): simulates a concurrent writer. Invoked just before a conditional token write
        // is evaluated, with the target row, so a test can change the hash "between read and write".
        public Action<DeviceAuthInfo>? BeforeTokenWrite { get; set; }

        // Schema-applier support: every SQL batch executed, in order, plus optional failure injection.
        public List<string> ExecutedSql { get; } = new();
        public Func<string, Exception?>? FailOn { get; set; }
        public List<string> AppliedMigrations { get; } = new();
        public Dictionary<string, string> RecordedProcedureHashes { get; } = new(StringComparer.OrdinalIgnoreCase);

        public FakeDeviceRepository Add(long id, string? uuid, string? tokenHash = null, string? mac = null, DateTime? resetAt = null)
        {
            Rows.Add(new DeviceAuthInfo { DeviceId = id, DeviceUuid = uuid, TokenHash = tokenHash, MacAddress = mac, TokenResetAt = resetAt });
            return this;
        }

        // Mirrors the SQL precedence: a uuid match wins, then the numeric id, then the id used as a uuid.
        public Task<DeviceAuthInfo?> GetDeviceAuthInfoAsync(string deviceId, string? deviceUuid)
        {
            DeviceAuthInfo? row = null;
            if (!string.IsNullOrWhiteSpace(deviceUuid))
                row = Rows.FirstOrDefault(r => string.Equals(r.DeviceUuid, deviceUuid, StringComparison.OrdinalIgnoreCase));
            if (row == null && long.TryParse(deviceId, out var id))
                row = Rows.FirstOrDefault(r => r.DeviceId == id);
            if (row == null && !string.IsNullOrWhiteSpace(deviceId))
                row = Rows.FirstOrDefault(r => string.Equals(r.DeviceUuid, deviceId, StringComparison.OrdinalIgnoreCase));
            return Task.FromResult(row);
        }

        public Task SetDeviceTokenHashAsync(long deviceId, string? tokenHash)
        {
            TokenWrites.Add((deviceId, tokenHash));
            var row = Rows.FirstOrDefault(r => r.DeviceId == deviceId);
            if (row != null)
            {
                row.TokenHash = tokenHash;
                row.TokenIssuedAt = tokenHash == null ? null : DateTime.UtcNow;
            }
            return Task.CompletedTask;
        }

        // Round 3 (R3): the same conditional semantics as the SQL UPDATE.
        public Task<bool> TrySetDeviceTokenHashAsync(long deviceId, string? expectedHash, string newHash)
        {
            var row = Rows.FirstOrDefault(r => r.DeviceId == deviceId);
            if (row == null) return Task.FromResult(false);
            BeforeTokenWrite?.Invoke(row);
            var matches = expectedHash == null
                ? string.IsNullOrEmpty(row.TokenHash)
                : string.Equals(row.TokenHash, expectedHash, StringComparison.OrdinalIgnoreCase);
            if (!matches) return Task.FromResult(false);
            TokenWrites.Add((deviceId, newHash));
            row.TokenHash = newHash;
            row.TokenIssuedAt = DateTime.UtcNow;
            row.TokenResetAt = null;
            return Task.FromResult(true);
        }

        public Task ResetDeviceTokenAsync(long deviceId)
        {
            TokenWrites.Add((deviceId, null));
            var row = Rows.FirstOrDefault(r => r.DeviceId == deviceId);
            if (row != null)
            {
                row.TokenHash = null;
                row.TokenIssuedAt = null;
                row.TokenResetAt = DateTime.UtcNow;
            }
            return Task.CompletedTask;
        }

        // Mirrors sp_device_std: exactly one live row with this MAC and a different uuid.
        public Task<DeviceAuthInfo?> GetDeviceAuthInfoByMacAsync(string macAddress, string? excludeUuid)
        {
            var matches = Rows.Where(r => string.Equals((r.MacAddress ?? string.Empty).Trim(), macAddress.Trim(), StringComparison.OrdinalIgnoreCase)
                                       && (excludeUuid == null || !string.Equals(r.DeviceUuid, excludeUuid, StringComparison.OrdinalIgnoreCase))).ToList();
            return Task.FromResult(matches.Count == 1 ? matches[0] : null);
        }

        public Task<IEnumerable<string>> GetScheduleInheritorsAsync(string deviceId)
            => Task.FromResult(Inheritors.TryGetValue(deviceId, out var list) ? list.AsEnumerable() : Enumerable.Empty<string>());

        public Task<RepositoryResult> AddCommandAsync(string deviceId, string commandType)
        {
            Commands.Add((deviceId, commandType));
            return Task.FromResult(RepositoryResult.Ok("queued"));
        }

        // Round 4 (#2): schema-session support. Statements routed through the session are counted
        // separately from direct repository calls so a test can prove the applier never bypasses
        // the locked connection.
        public bool SchemaLockAvailable { get; set; } = true;
        public FakeSchemaSession? LastSession { get; private set; }
        public int DirectSqlCalls { get; private set; }

        public Task<ISchemaSession> OpenSchemaSessionAsync()
        {
            LastSession = new FakeSchemaSession(this);
            return Task.FromResult<ISchemaSession>(LastSession);
        }

        internal Task ExecuteSqlViaSessionAsync(string sql) => ExecuteSqlCore(sql);
        internal Task ExecuteSqlViaSessionAsync(string sql, object? parameters) => ExecuteSqlCore(sql, parameters);
        internal Task<T?> QueryScalarViaSessionAsync<T>(string sql, object? parameters) => QueryScalarCore<T>(sql, parameters);
        internal Task<IEnumerable<T>> QueryListViaSessionAsync<T>(string sql, object? parameters) => QueryListCore<T>(sql, parameters);

        public Task ExecuteSqlAsync(string sql) { DirectSqlCalls++; return ExecuteSqlCore(sql); }
        public Task ExecuteSqlAsync(string sql, object? parameters) { DirectSqlCalls++; return ExecuteSqlCore(sql, parameters); }
        public Task<T?> QueryScalarAsync<T>(string sql, object? parameters = null) { DirectSqlCalls++; return QueryScalarCore<T>(sql, parameters); }
        public Task<IEnumerable<T>> QueryListAsync<T>(string sql, object? parameters = null) { DirectSqlCalls++; return QueryListCore<T>(sql, parameters); }

        private Task ExecuteSqlCore(string sql)
        {
            var failure = FailOn?.Invoke(sql);
            if (failure != null) throw failure;
            ExecutedSql.Add(sql);
            return Task.CompletedTask;
        }

        private Task ExecuteSqlCore(string sql, object? parameters)
        {
            ExecutedSql.Add(sql);
            if (sql.Contains("sn_schema_migrations") && parameters != null)
            {
                var name = parameters.GetType().GetProperty("name")?.GetValue(parameters)?.ToString();
                if (name != null) AppliedMigrations.Add(name);
            }
            if (sql.Contains("sn_schema_objects") && parameters != null)
            {
                var name = parameters.GetType().GetProperty("name")?.GetValue(parameters)?.ToString();
                var hash = parameters.GetType().GetProperty("hash")?.GetValue(parameters)?.ToString();
                if (name != null && hash != null) RecordedProcedureHashes[name] = hash;
            }
            return Task.CompletedTask;
        }

        private Task<T?> QueryScalarCore<T>(string sql, object? parameters)
        {
            if (sql.Contains("sn_schema_objects") && parameters != null)
            {
                var name = parameters.GetType().GetProperty("name")?.GetValue(parameters)?.ToString();
                if (name != null && RecordedProcedureHashes.TryGetValue(name, out var hash))
                    return Task.FromResult((T?)(object)hash);
            }
            return Task.FromResult(default(T));
        }

        private Task<IEnumerable<T>> QueryListCore<T>(string sql, object? parameters)
        {
            if (sql.Contains("sn_schema_migrations"))
                return Task.FromResult(AppliedMigrations.Cast<T>().ToList().AsEnumerable());
            return Task.FromResult(Enumerable.Empty<T>());
        }

        // --- not needed by the units under test ---
        public Task<RepositoryResult<DeviceDto>> RegisterOrLoginAsync(DeviceRegisterRequest request) => throw new NotImplementedException();
        public Task<IEnumerable<DeviceCommandDto>> HeartbeatAsync(HeartbeatRequest request) => throw new NotImplementedException();
        public Task<IEnumerable<DeviceDto>> GetAllDevicesAsync() => throw new NotImplementedException();
        public Task<DeviceDto?> GetDeviceByIdAsync(string deviceId) => throw new NotImplementedException();
        public Task<RepositoryResult> AcknowledgeCommandAsync(string deviceId, string commandId, string status, long? userId = null, string? message = null) => throw new NotImplementedException();
        public Task<RepositoryResult> DeactivateDeviceAsync(string deviceId, long? userId = null) => throw new NotImplementedException();
        public Task<RepositoryResult> CleanupOfflineDevicesAsync(int days = 14) => throw new NotImplementedException();
        public Task<RepositoryResult<int>> GetOfflineDeviceCountAsync(int days = 14) => throw new NotImplementedException();
        public Task<IEnumerable<DeviceDto>> GetDevicesByMediaIdAsync(string mediaId) => throw new NotImplementedException();
        public Task<IEnumerable<DeviceDto>> GetDevicesByPlaylistIdAsync(string playlistId) => throw new NotImplementedException();
        public Task<IEnumerable<PlaylistDeviceDto>> GetDevicesForPlaylistViewAsync(string playlistId) => Task.FromResult(Enumerable.Empty<PlaylistDeviceDto>());
        public Task<IEnumerable<DevicePlaylistDto>> GetAssignedPlaylistsAsync(string deviceId) => throw new NotImplementedException();
        public Task<string?> GetSiblingDeviceIdWithAssignmentsAsync(string deviceId) => throw new NotImplementedException();
        public Task UpdateAssignedPlaylistsAsync(string deviceId, List<DevicePlaylistDto> playlists) => throw new NotImplementedException();
        public Task SetScheduleModeAsync(string deviceId, string mode) => throw new NotImplementedException();
        public Task ResetScheduleToInheritAsync(string deviceId) => throw new NotImplementedException();
        public Task<IEnumerable<string>> GetDevicesWithScheduleTransitionsAsync(DateTime fromUtc, DateTime toUtc) => throw new NotImplementedException();
    }

    public sealed class FakeSystemLogRepository : ISystemLogRepository
    {
        public List<string> Lines { get; } = new();

        public Task LogAsync(string? deviceId, string logType, string message, string source = "API", long? userId = null, DateTime? createdAt = null)
        {
            Lines.Add($"{logType}|{deviceId}|{message}");
            return Task.CompletedTask;
        }

        public Task<int> LogBatchAsync(IEnumerable<SystemLogWrite> entries) => Task.FromResult(entries.Count());
        public Task<IEnumerable<SystemLogEntry>> GetLatestLogsAsync(int top = 100) => Task.FromResult(Enumerable.Empty<SystemLogEntry>());
        public Task<IEnumerable<SystemLogEntry>> GetFilteredLogsAsync(DateTime? startDate, DateTime? endDate, string? logType, int page, int pageSize) => Task.FromResult(Enumerable.Empty<SystemLogEntry>());
        public Task ClearOldLogsAsync(int retentionDays = 30) => Task.CompletedTask;
    }
}
