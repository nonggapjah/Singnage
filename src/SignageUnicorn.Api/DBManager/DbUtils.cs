using System.Data;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;

namespace SignageUnicorn.Api.DBManager
{
    public class DbUtils
    {
        private readonly string _connectionString;

        public DbUtils(IConfiguration configuration)
        {
            _connectionString = configuration.GetConnectionString("DefaultConnection") 
                                ?? configuration["DB_CONNECTION_STRING"] 
                                ?? throw new InvalidOperationException("Connection string not found.");
        }

        public async Task<DataTable> ExecSpToDataTableAsync(string spName, params SqlParameter[] parameters)
        {
            using var connection = new SqlConnection(_connectionString);
            using var command = new SqlCommand(spName, connection);
            command.CommandType = CommandType.StoredProcedure;
            
            if (parameters != null)
            {
                command.Parameters.AddRange(parameters);
            }

            var dataTable = new DataTable();
            using var adapter = new SqlDataAdapter(command);
            
            await connection.OpenAsync();
            adapter.Fill(dataTable);
            
            return dataTable;
        }

        public async Task<int> ExecSpNonQueryAsync(string spName, params SqlParameter[] parameters)
        {
            using var connection = new SqlConnection(_connectionString);
            using var command = new SqlCommand(spName, connection);
            command.CommandType = CommandType.StoredProcedure;

            if (parameters != null)
            {
                command.Parameters.AddRange(parameters);
            }

            await connection.OpenAsync();
            return await command.ExecuteNonQueryAsync();
        }

        public static SqlParameter P(string name, object value)
        {
            return new SqlParameter(name, value ?? DBNull.Value);
        }
    }
}
