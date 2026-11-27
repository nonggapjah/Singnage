using System;

using System.Text.Json.Serialization;

namespace SignageUnicorn.Api.Models
{
    // A screen in the context of one playlist: which screens play it now, or have it assigned.
    // Returned by GET /playlists/{id}/devices for the "where is this playlist playing" view.
    public class PlaylistDeviceDto
    {
        public string DeviceId { get; set; } = string.Empty;
        public string? DeviceUuid { get; set; }
        public string? DeviceName { get; set; }
        public string? BranchCode { get; set; }
        public string? Status { get; set; }
        public DateTime? LastCheckIn { get; set; }
        // Seconds since the last heartbeat (computed with SYSUTCDATETIME() — last_check_in is UTC).
        // The UI treats <= 120 s as online. long (DATEDIFF_BIG) so a legacy 1900-01-01 row cannot
        // overflow a 32-bit DATEDIFF and throw.
        public long? SecondsSinceCheckIn { get; set; }
        // Reserved. The reliable view does not derive a real-time "playing now": current_playlist_id is
        // stale/ambiguous during SCHEDULE-mode playback (the client reports a placeholder, not the real
        // playlist), so this is left false. A future version that reports the real playing playlist can
        // populate it.
        public bool IsPlayingNow { get; set; }
        // This playlist is directly assigned to the screen (active sn_device_playlists row). The view
        // currently returns only directly-assigned screens, so this is true for every row.
        public bool IsAssigned { get; set; }
        // Reserved for a future "playing now" view; not populated by the reliable assigned-screens view.
        public string? CurrentMediaName { get; set; }
    }

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
        // Audio player: 'screen' (default, every kiosk) or 'audio' (see PlaybackModes).
        public string? PlaybackMode { get; set; }
        // Last level (0-100) an operator set with SET_VOLUME; null = never set.
        public int? Volume { get; set; }
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

        // Audio player: 'audio' from the Signage Unicorn Audio app; absent from every kiosk, which
        // leaves the row's mode untouched (new rows default to 'screen').
        [JsonPropertyName("playbackMode")]
        public string? PlaybackMode { get; set; }

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

        // Audio player 2.8.4: the box reports its real level (0 = muted) so the console slider follows
        // tray/F-key changes; screens send nothing and the stored value is kept (ISNULL in the procedure).
        [JsonPropertyName("volume")]
        public int? Volume { get; set; }

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
        // Dayparts (2.8.7): daily window 'HH:mm' in store time, ISO days "1,2,3" (Mon = 1), and for
        // audio players a repeat interval that turns the playlist into an announcement.
        public string? StartTime { get; set; }
        public string? EndTime { get; set; }
        public string? DaysOfWeek { get; set; }
        public int? RepeatEveryMinutes { get; set; }
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

        [JsonPropertyName("startTime")]
        public string? StartTime { get; set; }
        [JsonPropertyName("endTime")]
        public string? EndTime { get; set; }
        [JsonPropertyName("daysOfWeek")]
        public string? DaysOfWeek { get; set; }
        [JsonPropertyName("repeatEveryMinutes")]
        public int? RepeatEveryMinutes { get; set; }

        /// <summary>API 2.8.14: when present with byBranch = true, the screens are released one branch at a time.</summary>
        [JsonPropertyName("rollout")]
        public RolloutOptions? Rollout { get; set; }

        /// <summary>The schedule as the assignment store keeps it: "HH:mm" times, ISO day numbers, validated repeat
        /// (the same normalisation UpdateAssignedPlaylists applies, so a rollout header never holds a longer string).</summary>
        public PlaylistScheduleFields ToSchedule() => new(StartDate, EndDate,
            SignageUnicorn.Api.Services.ScheduleWindow.NormalizeTime(StartTime),
            SignageUnicorn.Api.Services.ScheduleWindow.NormalizeTime(EndTime),
            SignageUnicorn.Api.Services.ScheduleWindow.NormalizeDays(DaysOfWeek),
            SignageUnicorn.Api.Services.ScheduleWindow.NormalizeRepeat(RepeatEveryMinutes));
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
