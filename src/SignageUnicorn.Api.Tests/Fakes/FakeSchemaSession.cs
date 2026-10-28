using SignageUnicorn.Api.Repositories.Interfaces;

namespace SignageUnicorn.Api.Tests.Fakes
{
    // In-memory ISchemaSession: routes every statement to the owning FakeDeviceRepository (so the
    // existing failure injection and ledgers keep working) and records lock/dispose activity.
    public sealed class FakeSchemaSession : ISchemaSession
    {
        private readonly FakeDeviceRepository _owner;

        public FakeSchemaSession(FakeDeviceRepository owner)
        {
            _owner = owner;
        }

        public bool LockHeld { get; private set; }
        public int LockAttempts { get; private set; }
        public int LockReleases { get; private set; }
        public bool Disposed { get; private set; }
        public int StatementsRun { get; private set; }

        public Task<bool> TryAcquireApplyLockAsync(TimeSpan timeout)
        {
            LockAttempts++;
            if (!_owner.SchemaLockAvailable) return Task.FromResult(false);
            LockHeld = true;
            return Task.FromResult(true);
        }

        public Task ReleaseApplyLockAsync()
        {
            if (LockHeld) { LockHeld = false; LockReleases++; }
            return Task.CompletedTask;
        }

        public Task ExecuteSqlAsync(string sql)
        {
            StatementsRun++;
            return _owner.ExecuteSqlViaSessionAsync(sql);
        }

        public Task ExecuteSqlAsync(string sql, object? parameters)
        {
            StatementsRun++;
            return _owner.ExecuteSqlViaSessionAsync(sql, parameters);
        }

        public Task<T?> QueryScalarAsync<T>(string sql, object? parameters = null)
        {
            StatementsRun++;
            return _owner.QueryScalarViaSessionAsync<T>(sql, parameters);
        }

        public Task<IEnumerable<T>> QueryListAsync<T>(string sql, object? parameters = null)
        {
            StatementsRun++;
            return _owner.QueryListViaSessionAsync<T>(sql, parameters);
        }

        public ValueTask DisposeAsync()
        {
            Disposed = true;
            return ReleaseApplyLockAsync().ContinueWith(_ => { }).AsValueTask();
        }
    }

    internal static class TaskExtensions
    {
        public static ValueTask AsValueTask(this Task task) => new(task);
    }
}
