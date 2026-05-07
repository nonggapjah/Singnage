using Dapper;
using Microsoft.Data.SqlClient;
using SignageUnicorn.Api.Models; // For SystemLogEntry
using SignageUnicorn.Api.Repositories.Interfaces;
using System.Data;

namespace SignageUnicorn.Api.Repositories.Implementations
{
    public class SpSystemLogRepository : ISystemLogRepository
    {
        private readonly string _connectionString;

        public SpSystemLogRepository(IConfiguration configuration)
        {
            _connectionString = configuration.GetConnectionString("DefaultConnection") 
                                ?? throw new InvalidOperationException("Connection string 'DefaultConnection' not found.");
            Dapper.DefaultTypeMap.MatchNamesWithUnderscores = true;
        }

        private IDbConnection CreateConnection() => new SqlConnection(_connectionString);

        private class SpStdResult
        {
            public int err_code { get; set; }
            public bool err_flag { get; set; }
            public string msg { get; set; }
        }

        public async Task LogAsync(string? deviceId, string logType, string message, string source = "API", long? userId = null, DateTime? createdAt = null)
        {
            // Workaround: SP does not have device_id column, injecting into message.
            string finalMessage = string.IsNullOrEmpty(deviceId) 
                ? message 
                : $"[Device: {deviceId}] {message}";

            using var db = CreateConnection();
            var p = new DynamicParameters();
            p.Add("@p_action", "INSERT");
            p.Add("@p_log_level", "Info"); // Defaulting to Info as logType is Category
            p.Add("@p_category", logType);
            p.Add("@p_message", finalMessage);
            p.Add("@p_source_system", source);
            p.Add("@p_userid", userId);
            p.Add("@p_created_at", createdAt);

            // 1. Status (Always)
            // Just execute and verify no error if crucial, but for logging we often fire-and-forget or just await.
            // But strict standard says we read status.
            var status = await db.QueryFirstOrDefaultAsync<SpStdResult>("sp_system_log_std", p, commandType: CommandType.StoredProcedure);
        }

        public async Task<IEnumerable<SystemLogEntry>> GetLatestLogsAsync(int top = 100)
        {
            using var db = CreateConnection();
            var p = new DynamicParameters();
            p.Add("@p_action", "GET_LATEST");
            p.Add("@p_top", top);

            // 1. Status, 2. Data
            using var multi = await db.QueryMultipleAsync("sp_system_log_std", p, commandType: CommandType.StoredProcedure);
            var status = await multi.ReadFirstOrDefaultAsync<SpStdResult>();

            if (status != null && status.err_flag) return Enumerable.Empty<SystemLogEntry>();

            return await multi.ReadAsync<SystemLogEntry>();
        }

        public async Task<IEnumerable<SystemLogEntry>> GetFilteredLogsAsync(DateTime? startDate, DateTime? endDate, string? logType, int page, int pageSize)
        {
            using var db = CreateConnection();
            var p = new DynamicParameters();
            p.Add("@p_action", "GET_FILTERED");
            p.Add("@p_start_date", startDate);
            p.Add("@p_end_date", endDate);
            p.Add("@p_page", page);
            
            // Check if multiple types are requested via comma-separated string
            bool hasMultipleTypes = !string.IsNullOrEmpty(logType) && logType.Contains(",");
            
            if (hasMultipleTypes)
            {
                // SP doesn't support multiple types natively, so fetch all for this range and filter in C#
                p.Add("@p_category", null);
                p.Add("@p_page_size", 1000); // Fetch a larger chunk for manual filtering
            }
            else
            {
                p.Add("@p_category", logType);
                p.Add("@p_page_size", pageSize);
            }

            // 1. Status, 2. Data
            using var multi = await db.QueryMultipleAsync("sp_system_log_std", p, commandType: CommandType.StoredProcedure);
            var status = await multi.ReadFirstOrDefaultAsync<SpStdResult>();

            if (status != null && status.err_flag) return Enumerable.Empty<SystemLogEntry>();

            var data = await multi.ReadAsync<SystemLogEntry>();

            if (hasMultipleTypes)
            {
                var types = logType!.Split(',').Select(t => t.Trim().ToUpper()).ToList();
                return data.Where(d => !string.IsNullOrEmpty(d.LogType) && types.Contains(d.LogType.ToUpper()))
                           .Skip((page - 1) * pageSize)
                           .Take(pageSize);
            }

            return data;
        }

        public async Task ClearOldLogsAsync()
        {
            using var db = CreateConnection();
            var p = new DynamicParameters();
            p.Add("@p_action", "CLEANUP");
            p.Add("@p_retention_days", 30);

            var status = await db.QueryFirstOrDefaultAsync<SpStdResult>("sp_system_log_std", p, commandType: CommandType.StoredProcedure);
        }
    }
}
