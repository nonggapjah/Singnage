using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace SignageUnicorn.Api.Models
{
    /// <summary>
    /// Optional part of <see cref="BatchAddScheduleRequest"/>: release the selection one branch at a
    /// time instead of assigning every screen at once (API 2.8.14).
    /// </summary>
    public class RolloutOptions
    {
        [JsonPropertyName("byBranch")]
        public bool ByBranch { get; set; }

        /// <summary>Minutes between two branches; clamped to 5..120, default 10.</summary>
        [JsonPropertyName("waveMinutes")]
        public int? WaveMinutes { get; set; }
    }

    /// <summary>The six schedule fields an assignment carries; shared by the batch request and the rollout rows.</summary>
    public sealed record PlaylistScheduleFields(
        DateTime? StartDate, DateTime? EndDate,
        string? StartTime, string? EndTime, string? DaysOfWeek, int? RepeatEveryMinutes);

    /// <summary>What the batch endpoint answers when it started a rollout instead of assigning everything.</summary>
    public class RolloutStartResult
    {
        public long RolloutId { get; set; }
        public int Waves { get; set; }
        public int TotalDevices { get; set; }
        public int WaveMinutes { get; set; }
        public string FirstBranch { get; set; } = string.Empty;
        public int FirstWaveDevices { get; set; }
        public int FirstWaveApplied { get; set; }
        public int FirstWaveFailed { get; set; }
        public DateTime LastWaveUtc { get; set; }
        /// <summary>Selected ids that matched no live screen (deleted meanwhile); not part of the rollout.</summary>
        public List<string> UnknownDevices { get; set; } = new();
    }

    public class RolloutWaveDto
    {
        public int WaveNo { get; set; }
        public string BranchCode { get; set; } = string.Empty;
        public int Devices { get; set; }
        public int Applied { get; set; }
        public int Failed { get; set; }
        public DateTime NotBeforeUtc { get; set; }
        public bool Started { get; set; }
        public bool Done { get; set; }
    }

    public class RolloutDto
    {
        public long RolloutId { get; set; }
        public string PlaylistId { get; set; } = string.Empty;
        public string? PlaylistName { get; set; }
        public string Status { get; set; } = string.Empty;
        public int WaveMinutes { get; set; }
        public string? HoldNote { get; set; }
        public DateTime CreatedUtc { get; set; }
        public DateTime UpdatedUtc { get; set; }
        public int TotalDevices { get; set; }
        public int AppliedDevices { get; set; }
        public int FailedDevices { get; set; }
        public int WaveCount { get; set; }
        public int WavesDone { get; set; }
        public DateTime? NextWaveUtc { get; set; }
        public string? NextBranch { get; set; }
        public DateTime? StartDate { get; set; }
        public DateTime? EndDate { get; set; }
        public string? StartTime { get; set; }
        public string? EndTime { get; set; }
        public string? DaysOfWeek { get; set; }
        public int? RepeatEveryMinutes { get; set; }
        public List<RolloutWaveDto> Waves { get; set; } = new();
    }

    // ---- storage rows (Dapper maps by column name) ----

    public class RolloutHeaderRow
    {
        public long rollout_id { get; set; }
        public long playlist_id { get; set; }
        public string playlist_uuid { get; set; } = string.Empty;
        public string? playlist_name { get; set; }
        public string status { get; set; } = string.Empty;
        public int wave_minutes { get; set; }
        public DateTime? start_date { get; set; }
        public DateTime? end_date { get; set; }
        public string? start_time { get; set; }
        public string? end_time { get; set; }
        public string? days_of_week { get; set; }
        public int? repeat_every_minutes { get; set; }
        public string? hold_note { get; set; }
        public long? created_by { get; set; }
        public DateTime created_at { get; set; }
        public DateTime updated_at { get; set; }

        public PlaylistScheduleFields Schedule() => new(start_date, end_date, start_time, end_time, days_of_week, repeat_every_minutes);
    }

    public class RolloutItemRow
    {
        public long item_id { get; set; }
        public long rollout_id { get; set; }
        public long playlist_id { get; set; }
        public string playlist_uuid { get; set; } = string.Empty;
        public long device_id { get; set; }
        public string branch_code { get; set; } = string.Empty;
        public int wave_no { get; set; }
        public DateTime not_before_utc { get; set; }
        public DateTime? applied_utc { get; set; }
        public int attempts { get; set; }
        public string? last_error { get; set; }
        /// <summary>True when any item of the same wave was already attempted or applied.</summary>
        public bool wave_started { get; set; }
    }

    public class RolloutWaveRow
    {
        public long rollout_id { get; set; }
        public int wave_no { get; set; }
        public string branch_code { get; set; } = string.Empty;
        public int devices { get; set; }
        public int applied { get; set; }
        public int failed { get; set; }
        public DateTime not_before_utc { get; set; }
        public bool started { get; set; }
    }

    public class DeviceBranchRow
    {
        public long device_id { get; set; }
        public string? device_uuid { get; set; }
        public string? branch_code { get; set; }
    }

    public class PlaylistRefRow
    {
        public long playlist_id { get; set; }
        public string playlist_uuid { get; set; } = string.Empty;
        public string? playlist_name { get; set; }
    }

    /// <summary>One planned item: which screen goes in which wave, and when that wave may start.</summary>
    public sealed record RolloutPlanItem(long DeviceId, string BranchCode, int WaveNo, DateTime NotBeforeUtc);
}
