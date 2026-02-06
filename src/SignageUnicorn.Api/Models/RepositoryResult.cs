namespace SignageUnicorn.Api.Models
{
    public class RepositoryResult
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public int ErrorCode { get; set; }
        public string? Data { get; set; } // Optional: For returning IDs (UUIDs)

        public static RepositoryResult Ok(string message = "Success", string? data = null) 
            => new RepositoryResult { Success = true, Message = message, ErrorCode = 0, Data = data };

        public static RepositoryResult Fail(int code, string message) 
            => new RepositoryResult { Success = false, Message = message, ErrorCode = code };
    }
    
    public class RepositoryResult<T> : RepositoryResult
    {
        public T? Value { get; set; }
        
        public static RepositoryResult<T> Ok(T value, string message = "Success") 
            => new RepositoryResult<T> { Success = true, Value = value, Message = message, ErrorCode = 0 };

        public new static RepositoryResult<T> Fail(int code, string message) 
            => new RepositoryResult<T> { Success = false, Message = message, ErrorCode = code, Value = default };
    }
}
