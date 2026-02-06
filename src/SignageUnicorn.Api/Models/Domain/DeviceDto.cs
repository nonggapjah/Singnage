namespace SignageUnicorn.Api.Models.Domain
{
    public class DeviceDto
    {
        public string DeviceId { get; set; } = string.Empty;
        public string DeviceName { get; set; } = string.Empty;
        public string Username { get; set; } = string.Empty;
        public string? Location { get; set; }
        public string? Ratio { get; set; }
        public string Status { get; set; } = "Y";
        public DateTime? LastCheckIn { get; set; }
        public DateTime CreatedAt { get; set; }
    }
}
