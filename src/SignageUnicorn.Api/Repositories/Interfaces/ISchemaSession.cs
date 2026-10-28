namespace SignageUnicorn.Api.Repositories.Interfaces
{
    // Round 4 (Codex round-4 finding 2): schema application must run on ONE connection that holds an
    // exclusive application lock for the whole operation -- the pending-migration check, every GO
    // batch of every migration (including the checkpointed batches of 007), and the ledger writes.
    // Two overlapping applies (an HTTP retry after the request timed out while the SQL was still
    // running, or two API instances starting at once) could each read the same migration-007
    // checkpoint and shift the same rows +7 h twice. The lock is owned by the session so it spans the
    // script's own BEGIN/COMMIT blocks; it is released in the applier's finally.
    public interface ISchemaSession : IAsyncDisposable
    {
        // Exclusive sp_getapplock on the shared resource name. False when another holder kept it
        // for the whole timeout; nothing may be applied then.
        Task<bool> TryAcquireApplyLockAsync(TimeSpan timeout);
        Task ReleaseApplyLockAsync();

        Task ExecuteSqlAsync(string sql);
        Task ExecuteSqlAsync(string sql, object? parameters);
        Task<T?> QueryScalarAsync<T>(string sql, object? parameters = null);
        Task<IEnumerable<T>> QueryListAsync<T>(string sql, object? parameters = null);
    }
}
