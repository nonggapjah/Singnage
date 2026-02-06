using System;
using System.Collections.Generic;

namespace SignageUnicorn.Api.Models
{
    public class DashboardStatsDto
    {
        public int TotalDevices { get; set; }
        public int OnlineDevices { get; set; }
        public int OfflineDevices { get; set; }
        public int TotalMedia { get; set; }
        public int TotalPlaylists { get; set; }
        public double AverageLatencyMs { get; set; }
        public double DynamicTxSpeedMbps { get; set; }
        public string SystemVersion { get; set; } = "1.7.6";
        public IEnumerable<PlaybackSummaryDto> TopMedia { get; set; } = new List<PlaybackSummaryDto>();
        public IEnumerable<SystemLogEntry> RecentAlerts { get; set; } = new List<SystemLogEntry>();
    }

    public class SystemLogEntry
    {
        public long LogId { get; set; }
        public string? DeviceId { get; set; }
        public string? Category { get; set; } // Maps to DB 'category'
        public string? LogType { get => Category; set => Category = value; } // Alias
        public string Message { get; set; }
        public string? SourceSystem { get; set; } // Maps to DB 'source_system'
        public string? Source { get => SourceSystem; set => SourceSystem = value; } // Alias
        public DateTime CreatedAt { get; set; }
    }
}
