using System.Text.Json.Serialization;
using SignageUnicorn.Api.Models;

namespace SignageUnicorn.Api.Models.Domain
{
    // ... MediaDto skipped ...

    public class PlaylistDto
    {
        [JsonPropertyName("playlistId")]
        public string PlaylistId { get; set; } = string.Empty;
        
        [JsonPropertyName("playlistName")]
        public string PlaylistName { get; set; } = string.Empty;
        
        [JsonPropertyName("description")]
        public string? Description { get; set; }
        
        [JsonPropertyName("createdBy")]
        public string? CreatedBy { get; set; }
        
        [JsonPropertyName("createdAt")]
        public DateTime CreatedAt { get; set; }
        
        [JsonPropertyName("active")]
        public string Active { get; set; } = "N"; // Default to N for safety
        
        [JsonPropertyName("items")]
        public List<PlaylistItemDto> Items { get; set; } = new();

        [JsonPropertyName("itemCount")]
        public int ItemCount { get; set; }

        [JsonPropertyName("totalDuration")]
        public int TotalDuration { get; set; }

        // IMPORTANT: Database compatibility layer
        // DB returns 'status' column as 'active' or 'inactive'
        // This setter intercepts that value and converts it to our 'Active' property format (Y/N)
        [JsonIgnore]
        public string status
        {
            set 
            {
                // Only override if value is not null/empty
                if (!string.IsNullOrEmpty(value))
                {
                    Active = (value.Trim().ToLower() == "active") ? "Y" : "N";
                }
            }
        }
    }

    public class PlaylistItemDto
    {
        [JsonPropertyName("playlistItemId")]
        public string PlaylistItemId { get; set; } = string.Empty;
        
        [JsonPropertyName("playlistId")]
        public string PlaylistId { get; set; } = string.Empty;
        
        [JsonPropertyName("mediaId")]
        public string MediaId { get; set; } = string.Empty;
        
        [JsonPropertyName("positionOrder")]
        public int PositionOrder { get; set; }
        
        [JsonPropertyName("durationOverride")]
        public int? DurationOverride { get; set; }
        
        [JsonPropertyName("active")]
        public string Active { get; set; } = "Y";

        // Join data - properties usually output ONLY, so defaults (Pascal) are fine if frontend accepts them.
        // But for consistency let's map them too if needed.
        // Join data
        [JsonPropertyName("fileName")]
        public string? FileName { get; set; }
        
        [JsonPropertyName("displayName")]
        public string? DisplayName { get; set; }
        
        [JsonPropertyName("blobUrl")]
        public string? BlobUrl { get; set; }
        
        [JsonPropertyName("originalDuration")]
        public int? OriginalDuration { get; set; }
        
        [JsonPropertyName("ratio")]
        public string? Ratio { get; set; }
        
        [JsonPropertyName("fileSizeKB")]
        public int? FileSizeKB { get; set; }

        [JsonPropertyName("media")]
        public MediaFile? Media { get; set; }

        // Database Mapping Helpers (Shadow Properties)
        // These properties match the snake_case column names returned by SPs
        [JsonIgnore] public string playlist_item_uuid { set => PlaylistItemId = value; }
        [JsonIgnore] public string playlist_id { set => PlaylistId = value; } // Or long? SP might return long ID? No, GET_ITEMS joined
        // Wait, GET_ITEMS in SP:
        // SELECT pi.playlist_item_uuid, pi.position_order, pi.duration_override, m.media_id, ...
        // media_id is likely BIGINT. PlaylistItemDto.MediaId is string.
        // We need to handle type conversion too.
        [JsonIgnore] public long media_id { set => MediaId = value.ToString(); }
        [JsonIgnore] public int position_order { set => PositionOrder = value; }
        [JsonIgnore] public int? duration_override { set => DurationOverride = value; }
        [JsonIgnore] public string file_name { set => FileName = value; }
        [JsonIgnore] public string display_name { set => DisplayName = value; }
        [JsonIgnore] public string blob_url { set => BlobUrl = value; }
        // original_duration alias in SP is correct?
        // m.duration_sec AS original_duration.
        [JsonIgnore] public int? original_duration { set => OriginalDuration = value; }
        [JsonIgnore] public string ratio { set => Ratio = value; }
        // file_size_kb is now selected
        [JsonIgnore] public long? file_size_kb { set => FileSizeKB = (int?)value; } // DB might be BIGINT, DTO is int? 
        
        // Extended Media Properties Mapping
        [JsonIgnore] public string uploaded_by { set { if (Media == null) Media = new MediaFile(); Media.UploadedBy = value; } }
        [JsonIgnore] public DateTime uploaded_at { set { if (Media == null) Media = new MediaFile(); Media.UploadedAt = value; } }
        [JsonIgnore] public string supplier_code { set { if (Media == null) Media = new MediaFile(); Media.Supplier_Code = value; } }
        [JsonIgnore] public string remark1 { set { if (Media == null) Media = new MediaFile(); Media.Remark1 = value; } }
        [JsonIgnore] public string remark2 { set { if (Media == null) Media = new MediaFile(); Media.Remark2 = value; } }
        [JsonIgnore] public string active { set { if (Media == null) Media = new MediaFile(); Media.Active = value; } }
    }
}
