using System;
using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Http;

namespace SignageUnicorn.Api.Models
{
    public class MediaFile
    {
        public string MediaId { get; set; } = Guid.NewGuid().ToString();
        public string FileName { get; set; }
        public string? DisplayName { get; set; }
        public string BlobUrl { get; set; }
        public int DurationSec { get; set; }
        public string? Ratio { get; set; }
        public int? FileSizeKb { get; set; }
        public string? Supplier_Code { get; set; }
        public string? Remark1 { get; set; }
        public string? Remark2 { get; set; }
        public string? UploadedBy { get; set; }
        public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
        public string Active { get; set; } = "Y";
        public string? FileHash { get; set; }
        public DateTime? EndDate { get; set; }
    }

    public class MediaUploadRequest
    {
        [Required]
        public string FileName { get; set; }
        
        [Required]
        public string DisplayName { get; set; }
        
        public string? BlobUrl { get; set; } // Now optional if File is provided
        public IFormFile? File { get; set; } // For local upload
        public int DurationSec { get; set; }
        public string? Ratio { get; set; }
        public int? FileSizeKb { get; set; }
        
        [Required]
        public string Supplier_Code { get; set; }
        
        public string? Remark1 { get; set; }
        public string? Remark2 { get; set; }
        public DateTime? EndDate { get; set; }
    }
    // Chunked / resumable upload (bypasses the Cloudflare 100 MB per-request edge cap). The client
    // slices a large file into <100 MB parts, uploads each part, then asks the server to assemble +
    // validate + publish exactly as a single-shot upload would. See MediaService.Chunk* methods.
    public class ChunkedUploadInitRequest
    {
        [Required]
        public string FileName { get; set; } = string.Empty;
        // Total byte length of the whole file, declared up front so the server can bound it.
        public long TotalSize { get; set; }
        // How many parts the client will send (0 .. TotalChunks-1).
        public int TotalChunks { get; set; }
        // Optional lowercase hex SHA-256 of the whole file; verified on assembly when present.
        public string? Sha256 { get; set; }
    }

    public class ChunkedUploadInitResponse
    {
        public string UploadId { get; set; } = string.Empty;
        // The maximum bytes the server accepts per chunk (the client keeps each part at or below this).
        public int ChunkSize { get; set; }
    }

    public class ChunkedUploadStatusResponse
    {
        public string UploadId { get; set; } = string.Empty;
        public List<int> ReceivedChunks { get; set; } = new();
        public int TotalChunks { get; set; }
    }

    public class ChunkedUploadCompleteRequest
    {
        [Required]
        public string DisplayName { get; set; } = string.Empty;
        [Required]
        public string Supplier_Code { get; set; } = string.Empty;
        public string? FileName { get; set; }
        public int DurationSec { get; set; }
        public string? Ratio { get; set; }
        public int? FileSizeKb { get; set; }
        public string? Remark1 { get; set; }
        public string? Remark2 { get; set; }
        public DateTime? EndDate { get; set; }
    }

    public class MediaUsageDto
    {
        public string PlaylistId { get; set; } = string.Empty;
        public string PlaylistName { get; set; } = string.Empty;
        public string Active { get; set; } = string.Empty;
        public int UsageCount { get; set; }
        public int DurationSec { get; set; }
        public int DeviceCount { get; set; }
    }
}
