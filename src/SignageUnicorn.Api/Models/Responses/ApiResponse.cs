namespace SignageUnicorn.Api.Models.Responses
{
    public class ApiResponse<T>
    {
        public bool Success { get; set; }
        public int Code { get; set; }
        public string Message { get; set; } = "OK";
        public T? Data { get; set; }
        public List<ApiError>? Errors { get; set; }

        public static ApiResponse<T> SuccessResponse(T data, string message = "OK")
        {
            return new ApiResponse<T>
            {
                Success = true,
                Code = 0,
                Message = message,
                Data = data
            };
        }

        public static ApiResponse<T> ErrorResponse(int code, string message, List<ApiError>? errors = null)
        {
            return new ApiResponse<T>
            {
                Success = false,
                Code = code,
                Message = message,
                Errors = errors
            };
        }
    }

    public class ApiError
    {
        public string Field { get; set; } = string.Empty;
        public string Message { get; set; } = string.Empty;
    }
}
