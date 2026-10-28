namespace SignageUnicorn.Api.Services
{
    // F07 / contract item 9: uploads used to keep whatever extension the editor chose, and wwwroot
    // served it back from the application origin. An .html or .svg upload was therefore a stored
    // script with access to the admin's localStorage token. The allowlist is by extension AND by
    // leading bytes, so a renamed file is caught too.
    public static class MediaFileValidator
    {
        public static readonly string[] AllowedExtensions =
        {
            ".jpg", ".jpeg", ".png", ".gif", ".webp",
            ".mp4", ".webm", ".mov", ".avi", ".mkv",
            ".mp3", ".wav"
        };

        public static bool IsAllowedExtension(string? extension)
        {
            if (string.IsNullOrEmpty(extension)) return false;
            return AllowedExtensions.Contains(extension.ToLowerInvariant());
        }

        public static bool IsVideoExtension(string? extension)
        {
            var e = extension?.ToLowerInvariant();
            return e == ".mp4" || e == ".mov" || e == ".avi" || e == ".webm" || e == ".mkv";
        }

        // Returns null when the first bytes are consistent with the extension, otherwise a reason.
        public static string? CheckMagic(string extension, ReadOnlySpan<byte> head)
        {
            var ext = extension.ToLowerInvariant();
            if (head.Length < 12) return "file is too small to be a valid media file";

            bool ok = ext switch
            {
                ".jpg" or ".jpeg" => head[0] == 0xFF && head[1] == 0xD8 && head[2] == 0xFF,
                ".png" => head[0] == 0x89 && head[1] == 0x50 && head[2] == 0x4E && head[3] == 0x47
                          && head[4] == 0x0D && head[5] == 0x0A && head[6] == 0x1A && head[7] == 0x0A,
                ".gif" => Ascii(head, 0, "GIF87a") || Ascii(head, 0, "GIF89a"),
                ".webp" => Ascii(head, 0, "RIFF") && Ascii(head, 8, "WEBP"),
                ".avi" => Ascii(head, 0, "RIFF") && Ascii(head, 8, "AVI "),
                ".wav" => Ascii(head, 0, "RIFF") && Ascii(head, 8, "WAVE"),
                ".webm" or ".mkv" => head[0] == 0x1A && head[1] == 0x45 && head[2] == 0xDF && head[3] == 0xA3,
                ".mp4" or ".mov" => IsIsoBmff(head),
                ".mp3" => Ascii(head, 0, "ID3") || (head[0] == 0xFF && (head[1] & 0xE0) == 0xE0),
                _ => false
            };
            return ok ? null : $"content does not look like a {ext} file";
        }

        private static bool IsIsoBmff(ReadOnlySpan<byte> head)
        {
            // ISO base media files start with a box; bytes 4..7 hold its type. QuickTime files
            // occasionally lead with a free/wide/mdat/moov box instead of ftyp.
            return Ascii(head, 4, "ftyp") || Ascii(head, 4, "moov") || Ascii(head, 4, "mdat")
                || Ascii(head, 4, "free") || Ascii(head, 4, "wide") || Ascii(head, 4, "skip");
        }

        private static bool Ascii(ReadOnlySpan<byte> data, int offset, string literal)
        {
            if (data.Length < offset + literal.Length) return false;
            for (int i = 0; i < literal.Length; i++)
            {
                if (data[offset + i] != (byte)literal[i]) return false;
            }
            return true;
        }
    }

    public sealed class MediaValidationException : Exception
    {
        public MediaValidationException(string message) : base(message) { }
    }
}
