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
