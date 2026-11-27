using System.Text;
using SignageUnicorn.Api.Services;
using Xunit;

namespace SignageUnicorn.Api.Tests
{
    // Audio player (API 2.8.6): what a device of each playback mode may receive, how audio files are
    // recognised, and the SET_VOLUME command.
    public class AudioPlayerTests
    {
        [Theory]
        [InlineData(null, "screen")]
        [InlineData("", "screen")]
        [InlineData("screen", "screen")]
        [InlineData("AUDIO", "audio")]
        [InlineData(" audio ", "audio")]
        [InlineData("tv", "screen")]
        public void Normalize_defaults_to_screen(string? raw, string expected)
            => Assert.Equal(expected, PlaybackModes.Normalize(raw));

        [Fact]
        public void NormalizeOrNull_keeps_the_row_untouched_when_nothing_was_sent()
        {
            Assert.Null(PlaybackModes.NormalizeOrNull(null));
            Assert.Null(PlaybackModes.NormalizeOrNull("  "));
            Assert.Equal("audio", PlaybackModes.NormalizeOrNull("Audio"));
            Assert.Equal("screen", PlaybackModes.NormalizeOrNull("anything-else"));
        }

        [Theory]
        // screens: today's content unchanged, audio kept away
        [InlineData("screen", "clip.mp4", true)]
        [InlineData("screen", "poster.jpg", true)]
        [InlineData("screen", "spot.mp3", false)]
        [InlineData("screen", "/media/abc.m4a", false)]
        [InlineData("screen", "https://host/media/x.wav?v=2", false)]
        // audio players: sound only
        [InlineData("audio", "spot.mp3", true)]
        [InlineData("audio", "bgm.m4a", true)]
        [InlineData("audio", "clip.mp4", true)]
        [InlineData("audio", "poster.jpg", false)]
        [InlineData("audio", "banner.PNG", false)]
        // unknown or missing names pass, as before
        [InlineData("screen", null, true)]
        [InlineData("audio", "", true)]
        [InlineData("screen", "weird.bin", true)]
        [InlineData("audio", "noext", true)]
        [InlineData(null, "spot.mp3", false)]
        public void Accepts_filters_by_mode_and_file_kind(string? mode, string? fileName, bool expected)
            => Assert.Equal(expected, PlaybackModes.Accepts(mode, fileName));

        [Theory]
        [InlineData("a/b/c.MP3", ".mp3")]
        [InlineData("c.mp3?x=1#frag", ".mp3")]
        [InlineData("folder.v2/noext", null)]
        [InlineData("trailingdot.", null)]
        [InlineData(null, null)]
        public void ExtensionOf_reads_the_last_segment_only(string? name, string? expected)
            => Assert.Equal(expected, PlaybackModes.ExtensionOf(name));

        [Theory]
        [InlineData(".mp3", true)]
        [InlineData(".WAV", true)]
        [InlineData(".m4a", true)]
        [InlineData(".aac", true)]
        [InlineData(".mp4", false)]
        [InlineData(".jpg", false)]
        [InlineData(null, false)]
        public void IsAudioExtension(string? ext, bool expected)
            => Assert.Equal(expected, MediaFileValidator.IsAudioExtension(ext));

        [Theory]
        [InlineData(".jpg", true)]
        [InlineData(".jpeg", true)]
        [InlineData(".png", true)]
        [InlineData(".gif", true)]
        [InlineData(".webp", true)]
        [InlineData(".mp4", false)]
        [InlineData(".mp3", false)]
        public void IsImageExtension(string ext, bool expected)
            => Assert.Equal(expected, MediaFileValidator.IsImageExtension(ext));

        [Fact]
        public void Audio_extensions_are_allowed_uploads()
        {
            Assert.True(MediaFileValidator.IsAllowedExtension(".m4a"));
            Assert.True(MediaFileValidator.IsAllowedExtension(".aac"));
            Assert.True(MediaFileValidator.IsAllowedExtension(".mp3"));
            Assert.False(MediaFileValidator.IsAllowedExtension(".flac"));
            Assert.False(MediaFileValidator.IsAllowedExtension(".ogg"));
        }

        [Fact]
        public void Magic_bytes_of_audio_containers()
        {
            // m4a = ISO BMFF: size box then 'ftyp'
            var m4a = new byte[] { 0, 0, 0, 0x20, (byte)'f', (byte)'t', (byte)'y', (byte)'p', (byte)'M', (byte)'4', (byte)'A', (byte)' ', 0, 0, 0, 0 };
            Assert.Null(MediaFileValidator.CheckMagic(".m4a", m4a));
            Assert.NotNull(MediaFileValidator.CheckMagic(".m4a", Encoding.ASCII.GetBytes("RIFFxxxxWAVEfmt ")));

            // aac = ADTS sync word FFF1 / FFF9, or an ID3 tag
            Assert.Null(MediaFileValidator.CheckMagic(".aac", new byte[] { 0xFF, 0xF1, 0x50, 0x80, 0, 0, 0, 0, 0, 0, 0, 0 }));
            Assert.Null(MediaFileValidator.CheckMagic(".aac", new byte[] { 0xFF, 0xF9, 0x50, 0x80, 0, 0, 0, 0, 0, 0, 0, 0 }));
            Assert.Null(MediaFileValidator.CheckMagic(".aac", Encoding.ASCII.GetBytes("ID3\u0004\0\0\0\0\0\0\0\0\0")));
            Assert.NotNull(MediaFileValidator.CheckMagic(".aac", new byte[] { 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 })); // mp3 sync, not ADTS
            Assert.NotNull(MediaFileValidator.CheckMagic(".aac", m4a));

            // the existing ones still hold
            Assert.Null(MediaFileValidator.CheckMagic(".mp3", Encoding.ASCII.GetBytes("ID3\u0003\0\0\0\0\0\0\0\0\0")));
            Assert.Null(MediaFileValidator.CheckMagic(".wav", Encoding.ASCII.GetBytes("RIFFxxxxWAVEfmt ")));
        }

        [Theory]
        [InlineData("SET_VOLUME:70", true, 70)]
        [InlineData("set_volume: 35 ", true, 35)]
        [InlineData("SET_VOLUME:150", true, 100)]
        [InlineData("SET_VOLUME:-5", true, 0)]
        [InlineData("SET_VOLUME:", false, 0)]
        [InlineData("SET_VOLUME:loud", false, 0)]
        [InlineData("REBOOT", false, 0)]
        [InlineData(null, false, 0)]
        public void TryParseVolume(string? command, bool ok, int level)
        {
            Assert.Equal(ok, DeviceCommands.TryParseVolume(command, out var parsed));
            if (ok) Assert.Equal(level, parsed);
        }

        [Fact]
        public void VolumeCommand_is_canonical_and_clamped()
        {
            Assert.Equal("SET_VOLUME:55", DeviceCommands.VolumeCommand(55));
            Assert.Equal("SET_VOLUME:100", DeviceCommands.VolumeCommand(999));
            Assert.Equal("SET_VOLUME:0", DeviceCommands.VolumeCommand(-1));
        }
    }
}
