namespace SignageUnicorn.Api.Models
{
    // Round 5 (Codex round-5 item 10): the outcome of a usage swap. A swap can succeed while the
    // follow-up filename versioning of the new row hits a concurrent transcode (409 on the
    // conditional rename); that is reported here instead of being hidden behind a bool.
    public sealed class MediaSwapResult
    {
        public bool Success { get; init; }
        public string Message { get; init; } = string.Empty;
        // True when the new row's content changed concurrently and its logical name could not be
        // versioned; the swap itself still completed and no stale metadata was written.
        public bool RenameConflict { get; init; }
        public string? NewFileName { get; init; }

        public static MediaSwapResult Failed(string message) => new() { Success = false, Message = message };
    }
}
