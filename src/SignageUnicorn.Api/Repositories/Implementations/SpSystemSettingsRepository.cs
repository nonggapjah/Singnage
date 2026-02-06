using Dapper;
using Microsoft.Extensions.Configuration;
using SignageUnicorn.Api.Repositories.Interfaces;
using System.Data;
using Microsoft.Data.SqlClient;
using System.Threading.Tasks;

namespace SignageUnicorn.Api.Repositories.Implementations
{
    public class SpSystemSettingsRepository : ISystemSettingsRepository
    {
        private readonly string _connectionString;

        public SpSystemSettingsRepository(IConfiguration configuration)
        {
            _connectionString = configuration.GetConnectionString("DefaultConnection") ?? throw new InvalidOperationException("Connection string 'DefaultConnection' not found.");
        }

        private class SpStdResult
        {
            public int err_code { get; set; }
            public bool err_flag { get; set; }
            public string msg { get; set; }
        }

        public async Task<string?> GetSettingAsync(string key)
        {
            using (var connection = new SqlConnection(_connectionString))
            {
                var p = new DynamicParameters();
                p.Add("@p_action", "GET");
                p.Add("@p_key", key);

                // 1. Status
                using var multi = await connection.QueryMultipleAsync("sp_system_settings_std", p, commandType: CommandType.StoredProcedure);
                var status = await multi.ReadFirstOrDefaultAsync<SpStdResult>();

                if (status != null && status.err_flag) return null;

                // 2. Data
                return await multi.ReadFirstOrDefaultAsync<string>();
            }
        }

        public async Task SetSettingAsync(string key, string value)
        {
            using (var connection = new SqlConnection(_connectionString))
            {
                var p = new DynamicParameters();
                p.Add("@p_action", "SET");
                p.Add("@p_key", key);
                p.Add("@p_value", value);

                // Just execute or check status
                using var multi = await connection.QueryMultipleAsync("sp_system_settings_std", p, commandType: CommandType.StoredProcedure);
                var status = await multi.ReadFirstOrDefaultAsync<SpStdResult>();
            }
        }
    }
}
