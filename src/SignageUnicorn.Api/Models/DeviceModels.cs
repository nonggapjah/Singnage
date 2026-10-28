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
        // Contract item 6: 'inherit' | 'explicit' (see migration 002).
        public string? ScheduleMode { get; set; }
        // Contract item 1: set ONLY on the register response when a token was issued or rotated.
        // Never populated from the database (only the hash is stored) and never listed.
        public string? DeviceToken { get; set; }
        // Contract T11: rollout visibility. Operators switch Security:DeviceAuth to Required only once
        // every screen shows HasDeviceToken and ClientProtocol >= 2.
        public bool HasDeviceToken { get; set; }
        public DateTime? DeviceTokenIssuedAt { get; set; }
        public int ClientProtocol { get; set; } = 1;
        // Round 3 (R2): an operator cleared the token and the screen has not claimed a new one yet.
        public bool TokenResetPending { get; set; }
    }

    public class DeviceCommandDto
    {
        public string CommandId { get; set; } = string.Empty;
        public string? DeviceCommandId { get; set; } // Holds the UUID for client ACK
        public string DeviceId { get; set; } = string.Empty;
        public string? CommandType { get; set; } // RESTART, REFRESH, UPDATE_PLAYLIST
        public string? Payload { get; set; }
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

        // Contract T1: only a client that can persist a token asks for one (header
        // X-Device-Token-Capable: 1 is equivalent). Absent on deployed v2.7.x clients.
        [JsonPropertyName("tokenCapable")]
        public bool? TokenCapable { get; set; }

        [JsonPropertyName("macAddress")]
        public string? MacAddress { get; set; }
    }

    // Contract T2: body of POST /devices/{id}/token/claim.
    public class DeviceTokenClaimRequest
    {
        [JsonPropertyName("deviceKey")]
        public string? DeviceKey { get; set; }

        [JsonPropertyName("macAddress")]
        public string? MacAddress { get; set; }

        [JsonPropertyName("appVersion")]
        public string? AppVersion { get; set; }
    }

    public class DeviceTokenClaimResponse
    {
        public string DeviceId { get; set; } = string.Empty;
        public string? DeviceUuid { get; set; }
        public string DeviceToken { get; set; } = string.Empty;
    }

    public class HeartbeatRequest
    {
        [JsonPropertyName("deviceId")]
        public string DeviceId { get; set; } = string.Empty;

        [JsonPropertyName("deviceKey")]
        public string? DeviceKey { get; set; }

        // Contract item 1: the X-Device-Token header is preferred; the body field is accepted for
        // clients that cannot set headers.
        [JsonPropertyName("deviceToken")]
        public string? DeviceToken { get; set; }

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

        // Contract T5: 1 = legacy, 2+ = lease/ack client. The X-Client-Protocol header wins.
        [JsonPropertyName("clientProtocol")]
        public int? ClientProtocol { get; set; }

        // Contract T3: filled by the controller after authentication with the ONE row the request
        // was authenticated as. When set, the repository passes this pair to the procedure instead of
        // the raw deviceId/deviceKey, so a token for screen A can never update screen B.
        [JsonIgnore]
        public long? CanonicalDeviceId { get; set; }

        [JsonIgnore]
        public string? CanonicalDeviceUuid { get; set; }

        [JsonIgnore]
        public int ResolvedProtocol { get; set; } = 1;

        // Round 3 (#1): set to false by the controller when sp_device_std must not adopt a
        // token-protected row by MAC for this (unknown-key) heartbeat.
        [JsonIgnore]
        public bool AllowMacAdoption { get; set; } = true;
    }

    public class BatchCommandRequest
    {
        [JsonPropertyName("deviceIds")]
        public List<string> DeviceIds { get; set; } = new List<string>();

        [JsonPropertyName("command")]
        public string Command { get; set; } = string.Empty;

        [JsonPropertyName("playlistIds")]
        public List<string>? PlaylistIds { get; set; }
    }

    public class DevicePlaylistDto
    {
        public int Id { get; set; }
        public string DeviceId { get; set; } = string.Empty;
        public string PlaylistId { get; set; } = string.Empty;
        public string? PlaylistName { get; set; }
        public DateTime? StartDate { get; set; }
        public DateTime? EndDate { get; set; }
        public bool IsActive { get; set; } = true;
    }

    public class BatchAddScheduleRequest
    {
        [JsonPropertyName("deviceIds")]
        public List<string> DeviceIds { get; set; } = new List<string>();

        [JsonPropertyName("playlistId")]
        public string PlaylistId { get; set; } = string.Empty;

        [JsonPropertyName("startDate")]
        public DateTime? StartDate { get; set; }

        [JsonPropertyName("endDate")]
        public DateTime? EndDate { get; set; }
    }

    public class CommandAckRequest
    {
        [JsonPropertyName("commandId")]
        public string CommandId { get; set; } = string.Empty;

        [JsonPropertyName("status")]
        public string Status { get; set; } = "EXECUTED";

        // Contract item 2: free-text reason stored in fail_reason when status is FAILED.
        [JsonPropertyName("message")]
        public string? Message { get; set; }
    }

    public class ScreenshotUploadRequest
    {
        [JsonPropertyName("base64Image")]
        public string Base64Image { get; set; } = string.Empty;
    }
}
