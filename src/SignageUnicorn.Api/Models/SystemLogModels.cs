namespace SignageUnicorn.Api.Models
{
    // One device-submitted log line, already filtered to the levels the server keeps.
    public sealed class SystemLogWrite
    {
        public string? DeviceId { get; init; }
        public string Level { get; init; } = "Warning";     // 'Warning' | 'Error'
        public string Category { get; init; } = "WARNING";  // what the console shows as LogType
        public string Message { get; init; } = string.Empty;
        public string Source { get; init; } = "Device";
        public DateTime? CreatedAt { get; init; }
    }
}
