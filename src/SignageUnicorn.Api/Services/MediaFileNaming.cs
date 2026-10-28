using System.Text.RegularExpressions;

namespace SignageUnicorn.Api.Services
{
    // Round 4 (Codex round-4 finding 3). Screens running the deployed v2.7.x client key their media
    // cache by the LOGICAL file name (file_name) and skip the download when a file of that name is
    // already on disk, hash or not. Publishing new bytes under the same logical name therefore left
    // those screens playing the old bytes forever (converted MP4s, re-uploaded replacements, swaps
    // between two media rows that share a name). New clients key by the stored GUID name and are not
    // affected either way. So whenever the bytes behind a media row change, the logical name gets a
    // version suffix: "clip.mp4" -> "clip.v2.mp4" -> "clip.v3.mp4". display_name is never touched;
    // that is what the console shows.
    //
    // Round 5 (Codex round-5 item 3): the version is chosen from EVERY name in use for the stem, not
    // from the proposed name alone. Replacing "clip.v2.mp4" with an upload called "clip.mp4" must become
    // "clip.v3.mp4": going back to the bare name, or reusing v2, would resurrect a cached file on a screen.
    public static class MediaFileNaming
    {
        private static readonly Regex VersionSuffix = new(@"^(?<base>.*)\.v(?<n>\d+)$",
            RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);

        public readonly record struct NameParts(string Stem, int Version, string Extension);

        // "clip.v3.MP4" -> ("clip", 3, ".MP4"); a bare name has version 1. Null for an unusable name.
        public static NameParts? Split(string? fileName)
        {
            if (string.IsNullOrWhiteSpace(fileName)) return null;
            var trimmed = fileName.Trim();

            var ext = Path.GetExtension(trimmed);
            var stem = Path.GetFileNameWithoutExtension(trimmed);
            if (string.IsNullOrEmpty(stem)) stem = trimmed; // names like ".mp4"

            int version = 1;
            var m = VersionSuffix.Match(stem);
            if (m.Success && int.TryParse(m.Groups["n"].Value, out var n) && n >= 1)
            {
                stem = m.Groups["base"].Value;
                version = n;
            }
            return new NameParts(stem, version, ext);
        }

        // Returns the next versioned logical name derived from the name itself, or null when there is
        // no usable name (the caller then falls back to the stored GUID name). Prefer NextVersion when
        // other names may be in use for the same stem.
        public static string? BumpVersion(string? fileName, string? targetExtension = null)
        {
            var parts = Split(fileName);
            if (parts is null) return null;
            var ext = NormalizeExtension(targetExtension) ?? parts.Value.Extension;
            return $"{parts.Value.Stem}.v{parts.Value.Version + 1}{ext}";
        }

        // The fresh logical name for NEW BYTES: one above the highest version already used for the
        // proposed name's stem by the row itself or any other row (case-insensitive stem match,
        // extension ignored), and never below v2. `targetExtension` overrides the proposed extension
        // (a transcode always publishes ".mp4"); otherwise the proposed extension is kept as given.
        public static string? NextVersion(string? proposedName, IEnumerable<string?>? namesInUse, string? targetExtension = null)
        {
            var proposed = Split(proposedName);
            if (proposed is null) return null;
            var ext = NormalizeExtension(targetExtension) ?? proposed.Value.Extension;

            int highest = proposed.Value.Version;
            if (namesInUse != null)
            {
                foreach (var name in namesInUse)
                {
                    var p = Split(name);
                    if (p is null || !SameStem(p.Value.Stem, proposed.Value.Stem)) continue;
                    if (p.Value.Version > highest) highest = p.Value.Version;
                }
            }

            var next = Math.Max(2, highest + 1);
            return $"{proposed.Value.Stem}.v{next}{ext}";
        }

        // True when two logical names belong to the same stem ("clip.mp4" / "clip.v2.mp4" / "CLIP.mov"),
        // i.e. a legacy cache keyed by one of them could be mistaken for the other.
        public static bool SharesStem(string? a, string? b)
        {
            var pa = Split(a);
            var pb = Split(b);
            if (pa is null || pb is null) return false;
            return SameStem(pa.Value.Stem, pb.Value.Stem);
        }

        private static bool SameStem(string a, string b)
            => string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase);

        private static string? NormalizeExtension(string? ext)
        {
            if (string.IsNullOrEmpty(ext)) return null;
            return ext.StartsWith('.') ? ext : "." + ext;
        }
    }
}
