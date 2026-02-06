namespace SignageUnicorn.Api.Models.Requests
{
    public class MediaReplaceRequest
    {
        public string OldMediaId { get; set; }
        public string NewMediaId { get; set; }
        public bool ArchiveOld { get; set; } = true;
    }
}
