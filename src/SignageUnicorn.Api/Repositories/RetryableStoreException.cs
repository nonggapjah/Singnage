using Microsoft.Data.SqlClient;

namespace SignageUnicorn.Api.Repositories
{
    // Contract T6. A store failure that says nothing about the data -- the database was unreachable,
    // timed out, deadlocked or was failing over -- must reach the client as "try again later", never
    // as "rejected". A rejected event is deleted by the client; a retryable one is kept and re-sent.
    public sealed class RetryableStoreException : Exception
    {
        public RetryableStoreException(string message, Exception? inner = null) : base(message, inner) { }
    }

    // A legacy (event-id-less) batch that the procedure refused for a data reason. Nothing was stored.
    public sealed class PlaybackBatchValidationException : Exception
    {
        public PlaybackBatchValidationException(string message) : base(message) { }
    }

    public static class SqlTransientErrors
    {
        // -2 timeout, 1205 deadlock victim, 53/64/233/10053/10054/10060 connection lost,
        // 4060 database unavailable, 40197/40501/49918/49919/49920 service busy / failing over.
        //
        // Round 3 (R4 / Codex round-3 finding 2): schema-level failures are retryable too. A missing
        // procedure (2812), an invalid column/object (207/208), a parameter the procedure does not
        // know (8144/8145/201), a bad conversion (4121/2715) says the DEPLOYMENT is wrong (migration
        // not applied yet, old procedure), not the event -- answering "rejected" made every client
        // delete its proof-of-play until someone noticed.
        private static readonly HashSet<int> Numbers = new()
        {
            -2, 1205, 53, 64, 233, 4060, 10053, 10054, 10060, 40197, 40501, 49918, 49919, 49920,
            2812, 207, 208, 201, 8144, 8145, 4121, 2715
        };

        // Errors that are about the submitted DATA and will never succeed on retry: FK violation
        // (547), unique index (2601/2627 -- handled as "duplicate" by callers), string truncation
        // (8152), conversion of a bad value (245), NOT NULL (515), check constraint (547), numeric
        // overflow (8115), invalid date (241/242).
        private static readonly HashSet<int> DataNumbers = new() { 547, 2628, 8152, 245, 515, 8115, 241, 242, 2601, 2627 };

        public static bool IsRetryableNumber(int number) => Numbers.Contains(number);
        public static bool IsDataErrorNumber(int number) => DataNumbers.Contains(number);

        // R4: how to treat an err_code the procedure itself reported in its status result set.
        //   4xx    -> the procedure validated the data and refused it (unknown device/media...): reject
        //   data   -> SQL data error caught by the procedure: reject
        //   other  -> anything else (schema mismatch, "Unknown action" from an old procedure, transient):
        //             retryable, because nothing about the event is known to be wrong.
        public static bool IsProcedureValidationCode(int errCode)
            => (errCode >= 400 && errCode <= 499) || IsDataErrorNumber(errCode);

        // R4: a SqlException the procedure did NOT catch. Only data errors are rejections.
        public static bool IsDataError(Exception? ex)
        {
            for (var e = ex; e != null; e = e.InnerException)
            {
                if (e is SqlException sql)
                {
                    if (IsDataErrorNumber(sql.Number)) return true;
                    foreach (SqlError err in sql.Errors) if (IsDataErrorNumber(err.Number)) return true;
                    return false;
                }
            }
            return false;
        }

        public static bool IsRetryable(Exception? ex)
        {
            for (var e = ex; e != null; e = e.InnerException)
            {
                switch (e)
                {
                    case SqlException sql:
                        if (IsRetryableNumber(sql.Number)) return true;
                        foreach (SqlError err in sql.Errors) if (IsRetryableNumber(err.Number)) return true;
                        return false;
                    case TimeoutException:
                        return true;
                    case InvalidOperationException ioe when ioe.Message.Contains("timeout", StringComparison.OrdinalIgnoreCase)
                                                          || ioe.Message.Contains("pool", StringComparison.OrdinalIgnoreCase)
                                                          || ioe.Message.Contains("connection", StringComparison.OrdinalIgnoreCase):
                        return true;
                }
            }
            return false;
        }
    }
}
