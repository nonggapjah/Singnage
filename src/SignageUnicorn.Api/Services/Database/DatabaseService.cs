using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace SignageUnicorn.Api.Services.Database;

public class DatabaseService : IDatabaseService
{
    private readonly string _connectionString;

    public DatabaseService(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection") 
            ?? throw new InvalidOperationException("Connection string 'DefaultConnection' not found.");
    }

    private IDbConnection CreateConnection() => new SqlConnection(_connectionString);

    public async Task<IEnumerable<T>> QueryAsync<T>(string storedProcedure, object? parameters = null)
    {
        using var connection = CreateConnection();
        return await connection.QueryAsync<T>(storedProcedure, parameters, commandType: CommandType.StoredProcedure);
    }

    public async Task<T?> QueryFirstOrDefaultAsync<T>(string storedProcedure, object? parameters = null)
    {
        using var connection = CreateConnection();
        return await connection.QueryFirstOrDefaultAsync<T>(storedProcedure, parameters, commandType: CommandType.StoredProcedure);
    }

    public async Task<int> ExecuteAsync(string storedProcedure, object? parameters = null)
    {
        using var connection = CreateConnection();
        return await connection.ExecuteAsync(storedProcedure, parameters, commandType: CommandType.StoredProcedure);
    }

    public async Task<T?> ExecuteScalarAsync<T>(string storedProcedure, object? parameters = null)
    {
        using var connection = CreateConnection();
        return await connection.ExecuteScalarAsync<T>(storedProcedure, parameters, commandType: CommandType.StoredProcedure);
    }
}
