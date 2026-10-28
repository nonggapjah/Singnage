using System;

namespace SignageUnicorn.Api.Models
{
    public class PlaybackLogDto
    {
        public string LogId { get; set; } = string.Empty;
        public string DeviceId { get; set; } = string.Empty;
        public string MediaId { get; set; } = string.Empty;
        public string? PlaylistId { get; set; }
        public DateTime PlayedAt { get; set; }
        public int Duration { get; set; }
        public string? Result { get; set; } // success/error
        public string? ErrorMessage { get; set; }
    }

    public class CreatePlaybackLogRequest
    {
        // Contract item 4: client-generated UUID per playback event; makes ingestion idempotent.
        // Null for legacy clients.
        public string? EventId { get; set; }
        public string DeviceId { get; set; } = string.Empty;
        public string MediaId { get; set; } = string.Empty;
        public string? PlaylistId { get; set; }
        public int Duration { get; set; }
        public string? Result { get; set; }
        public string? ErrorMessage { get; set; }
        public DateTime? PlayedAt { get; set; }
    }

    public sealed class PlaybackIngestResult
    {
        public bool Accepted { get; init; }
        public bool Duplicate { get; init; }
        public string? Error { get; init; }
    }

    public sealed class PlaybackRejectedEvent
    {
        public string? EventId { get; init; }
        public string Reason { get; init; } = string.Empty;
    }

    public sealed class PlaybackBatchResult
    {
        public List<string> Accepted { get; } = new();
        public List<PlaybackRejectedEvent> Rejected { get; } = new();
        public int AcceptedCount => Accepted.Count;
        public int RejectedCount => Rejected.Count;
    }

    public class PlaybackSummaryDto
    {
        public string? DisplayName { get; set; }
        public string? FileName { get; set; }
        public int PlayCount { get; set; }
        public long TotalDurationSec { get; set; }
        public DateTime LastPlayed { get; set; }
    }

    public class BranchSummaryDto
    {
        public string? BranchCode { get; set; }
        public int PlayCount { get; set; }
        public int DeviceCount { get; set; }
    }

    public class PlaybackExportDto
    {
        public DateTime PlayedAt { get; set; }
        public string? DeviceId { get; set; }
        public string? DeviceName { get; set; }
        public string? BranchCode { get; set; }
        public string? MediaName { get; set; }
        public string? FileName { get; set; }
        public string? SupplierCode { get; set; }
        public string? PlaylistId { get; set; }
        public string? PlaylistName { get; set; }
        public string? MediaId { get; set; }
        public int DurationSec { get; set; }
        public string? Result { get; set; }
    }
}
