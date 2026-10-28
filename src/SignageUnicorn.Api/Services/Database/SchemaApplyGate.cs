namespace SignageUnicorn.Api.Services.Database
{
    // Round 4 (Codex round-4 finding 2): in-process guard around schema application. The database
    // application lock (ISchemaSession) serialises applies across processes; this gate makes a second
    // call inside the same process -- typically the console retrying POST fix-devices-db after the
    // first request timed out while the SQL was still running -- answer immediately instead of
    // queueing behind the lock for up to ten minutes.
    public static class SchemaApplyGate
    {
        private static readonly SemaphoreSlim Gate = new(1, 1);

        // True when the caller now owns the gate and must call Exit(); false when an apply is running.
        public static bool TryEnter() => Gate.Wait(0);

        public static void Exit() => Gate.Release();

        public static bool IsBusy => Gate.CurrentCount == 0;
    }
}
