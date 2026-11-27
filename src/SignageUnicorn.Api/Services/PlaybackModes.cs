using System;

namespace SignageUnicorn.Api.Services
{
    // Audio player (20-11-2026). Which kind of client a device row is, and what each kind may play.
    // 'screen' is every device that exists today (the kiosk client); 'audio' is a row registered by
    // the separate Signage Unicorn Audio app. Nothing here changes what a screen receives, except
    // that audio files are kept away from it.
    public static class PlaybackModes
    {
        public const string Screen = "screen";
        public const string Audio = "audio";

        public static string Normalize(string? raw)
            => string.Equals(raw?.Trim(), Audio, StringComparison.OrdinalIgnoreCase) ? Audio : Screen;

        // Register path: null means "not sent, keep what the row has" (every 2.8.0 kiosk sends nothing).
        public static string? NormalizeOrNull(string? raw)
            => string.IsNullOrWhiteSpace(raw) ? null : Normalize(raw);

        public static bool IsAudio(string? raw) => Normalize(raw) == Audio;

        // A screen never receives an audio file: the deployed kiosk client does not know the type and
        // would show it as a broken image for its slot length. An audio player never receives an
        // image: there is nothing to hear. Video goes to both (an audio player plays its sound track).
        // Unknown extensions pass, as they do today.
        public static bool Accepts(string? mode, string? fileName)
        {
            var ext = ExtensionOf(fileName);
            if (ext == null) return true;
            return Normalize(mode) == Audio
                ? !MediaFileValidator.IsImageExtension(ext)
                : !MediaFileValidator.IsAudioExtension(ext);
        }

        internal static string? ExtensionOf(string? fileName)
        {
            if (string.IsNullOrWhiteSpace(fileName)) return null;
            var name = fileName;
            var q = name.IndexOfAny(new[] { '?', '#' });
            if (q >= 0) name = name.Substring(0, q);
            var dot = name.LastIndexOf('.');
            if (dot < 0 || dot == name.Length - 1) return null;
            var slash = name.LastIndexOfAny(new[] { '/', '\\' });
            if (slash > dot) return null;
            return name.Substring(dot).ToLowerInvariant();
        }
    }

    // Commands the console sends to an audio player, beyond the ones every device already knows.
    public static class DeviceCommands
    {
        // SET_VOLUME:<0-100>. The level is also remembered on the row (DeviceDto.Volume).
        public const string SetVolumePrefix = "SET_VOLUME:";

        public static bool TryParseVolume(string? command, out int level)
        {
            level = 0;
            if (string.IsNullOrWhiteSpace(command)) return false;
            var c = command.Trim();
            if (!c.StartsWith(SetVolumePrefix, StringComparison.OrdinalIgnoreCase)) return false;
            if (!int.TryParse(c.Substring(SetVolumePrefix.Length).Trim(), out var v)) return false;
            level = Math.Clamp(v, 0, 100);
            return true;
        }

        public static string VolumeCommand(int level) => SetVolumePrefix + Math.Clamp(level, 0, 100);
    }
}
