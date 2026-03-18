using System;

using System.Text.Json.Serialization;

namespace SignageUnicorn.Api.Models
{
    public class DeviceDto
    {
        public string DeviceId { get; set; } = string.Empty;
        public string? DeviceUuid { get; set; }
        public string? DeviceName { get; set; }
        public string? DeviceKey { get; set; } // HWID or Unique Token
        public string? BranchCode { get; set; }
        public string? IpAddress { get; set; }
        public string? Status { get; set; } // ONLINE, OFFLINE
        public string? CurrentPlaylistId { get; set; }
        public string? CurrentPlaylistItemId { get; set; }
        public string? CurrentMediaId { get; set; }
        public int? CurrentPositionSec { get; set; }
        public int? CacheProgress { get; set; }
        public string? AppVersion { get; set; }
        public DateTime? LastCheckIn { get; set; }
        public string? Active { get; set; }
    }

    public class DeviceCommandDto
    {
        public string CommandId { get; set; } = string.Empty;
        public string DeviceId { get; set; } = string.Empty;
        public string? CommandType { get; set; } // RESTART, REFRESH, UPDATE_PLAYLIST
        public string? Status { get; set; } // PENDING, COMPLETED
        public DateTime CreatedAt { get; set; }
    }

    public class DeviceRegisterRequest
    {
        [JsonPropertyName("deviceKey")]
        public string DeviceKey { get; set; } = string.Empty;
        [JsonPropertyName("deviceName")]
        public string DeviceName { get; set; } = string.Empty;
        [JsonPropertyName("branchCode")]
        public string BranchCode { get; set; } = string.Empty;
        [JsonPropertyName("ipAddress")]
        public string IpAddress { get; set; } = string.Empty;
        
        [JsonPropertyName("appVersion")]
        public string? AppVersion { get; set; }

        [JsonPropertyName("location")]
        public string? Location { get; set; }
    }

    public class HeartbeatRequest
    {
        [JsonPropertyName("deviceId")]
        public string DeviceId { get; set; } = string.Empty;

        [JsonPropertyName("deviceName")]
        public string? DeviceName { get; set; }

        [JsonPropertyName("branchCode")]
        public string? BranchCode { get; set; }

        [JsonPropertyName("status")]
        public string Status { get; set; } = string.Empty;

        [JsonPropertyName("currentPlaylistId")]
        public string? CurrentPlaylistId { get; set; }

        [JsonPropertyName("currentPlaylistItemId")]
        public string? CurrentPlaylistItemId { get; set; }

        [JsonPropertyName("currentMediaId")]
        public string? CurrentMediaId { get; set; }

        [JsonPropertyName("currentPositionSec")]
        public int? CurrentPositionSec { get; set; }

        [JsonPropertyName("cacheProgress")]
        public int? CacheProgress { get; set; }

        [JsonPropertyName("errorMessage")]
        public string? ErrorMessage { get; set; }

        // --- Boot Report Fields (sent once on startup) ---
        [JsonPropertyName("appVersion")]
        public string? AppVersion { get; set; }

        [JsonPropertyName("ipAddress")]
        public string? IpAddress { get; set; }

        [JsonPropertyName("location")]
        public string? Location { get; set; }

        [JsonPropertyName("ratio")]
        public string? Ratio { get; set; }

        [JsonPropertyName("macAddress")]
        public string? MacAddress { get; set; }
    }

    public class BatchCommandRequest
    {
        [JsonPropertyName("deviceIds")]
        public List<string> DeviceIds { get; set; } = new List<string>();

        [JsonPropertyName("command")]
        public string Command { get; set; } = string.Empty;
    }
}
