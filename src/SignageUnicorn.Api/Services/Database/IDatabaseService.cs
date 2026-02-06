namespace SignageUnicorn.Api.Services.Database;

public interface IDatabaseService
{
    Task<IEnumerable<T>> QueryAsync<T>(string storedProcedure, object? parameters = null);
    Task<T?> QueryFirstOrDefaultAsync<T>(string storedProcedure, object? parameters = null);
    Task<int> ExecuteAsync(string storedProcedure, object? parameters = null);
    Task<T?> ExecuteScalarAsync<T>(string storedProcedure, object? parameters = null);
}
