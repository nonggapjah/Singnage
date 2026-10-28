using Dapper;
using Microsoft.Data.SqlClient;
using SignageUnicorn.Api.Repositories.Interfaces;

namespace SignageUnicorn.Api.Repositories.Implementations
{
    // One open connection for the whole schema apply, plus the exclusive application lock that
    // serialises applies across processes (see ISchemaSession). Everything the SchemaApplier runs
    // goes through this connection, so the lock -- owned by the session, not a transaction --
    // covers the migration scripts' own BEGIN/COMMIT batches as well.
    public sealed class SqlSchemaSession : ISchemaSession
    {
        public const string LockResource = "SignageUnicorn.SchemaApply";

        // Long scripts (migration 007 over a large table) legitimately run for minutes.
        private const int CommandTimeoutSeconds = 600;

        private readonly SqlConnection _connection;
        private bool _lockHeld;

        private SqlSchemaSession(SqlConnection connection)
        {
            _connection = connection;
        }

        public static async Task<SqlSchemaSession> OpenAsync(string connectionString)
        {
            var connection = new SqlConnection(connectionString);
            await connection.OpenAsync();
            return new SqlSchemaSession(connection);
        }

        public async Task<bool> TryAcquireApplyLockAsync(TimeSpan timeout)
        {
            if (_lockHeld) return true;
            var timeoutMs = (int)Math.Min(int.MaxValue, Math.Max(0, timeout.TotalMilliseconds));
            // sp_getapplock returns >= 0 when the lock was granted (0 = immediately, 1 = after waiting),
            // -1 on timeout, -2 cancelled, -3 deadlock victim, -999 parameter/call error.
            var rc = await _connection.ExecuteScalarAsync<int>(
                @"DECLARE @rc INT;
                  EXEC @rc = sp_getapplock @Resource = @resource, @LockMode = 'Exclusive', @LockOwner = 'Session', @LockTimeout = @timeoutMs;
                  SELECT @rc;",
                new { resource = LockResource, timeoutMs },
                commandTimeout: Math.Max(CommandTimeoutSeconds, timeoutMs / 1000 + 60));
            _lockHeld = rc >= 0;
            return _lockHeld;
        }

        public async Task ReleaseApplyLockAsync()
        {
            if (!_lockHeld) return;
            _lockHeld = false;
            try
            {
                await _connection.ExecuteAsync(
                    "EXEC sp_releaseapplock @Resource = @resource, @LockOwner = 'Session';",
                    new { resource = LockResource },
                    commandTimeout: 30);
            }
            catch
            {
                // Closing the connection releases a session-owned lock anyway; a failed explicit
                // release must not turn a successful apply into a failure.
            }
        }

        public Task ExecuteSqlAsync(string sql)
            => _connection.ExecuteAsync(sql, commandTimeout: CommandTimeoutSeconds);

        public Task ExecuteSqlAsync(string sql, object? parameters)
            => _connection.ExecuteAsync(sql, parameters, commandTimeout: CommandTimeoutSeconds);

        public Task<T?> QueryScalarAsync<T>(string sql, object? parameters = null)
            => _connection.ExecuteScalarAsync<T?>(sql, parameters, commandTimeout: CommandTimeoutSeconds);

        public Task<IEnumerable<T>> QueryListAsync<T>(string sql, object? parameters = null)
            => _connection.QueryAsync<T>(sql, parameters, commandTimeout: CommandTimeoutSeconds);

        public async ValueTask DisposeAsync()
        {
            await ReleaseApplyLockAsync();
            await _connection.DisposeAsync();
        }
    }
}
