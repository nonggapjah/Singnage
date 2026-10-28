using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace SignageUnicorn.Api.Models.Json
{
    // Every DateTime the API stores is UTC (SYSUTCDATETIME() everywhere), but values read through
    // Dapper come back with Kind = Unspecified and System.Text.Json then serializes them WITHOUT a
    // trailing "Z". Browsers parse such strings as local time, which is how the admin console ended
    // up showing times shifted by the server/browser offset and why several stored procedures grew
    // DATEADD(HOUR, 7, ...) "fixes" that only held for one timezone. Contract (playback logs, item 4):
    // every DateTime leaves the API as ISO-8601 UTC with "Z", and every DateTime that arrives without
    // an explicit offset is taken to be UTC.
    public sealed class UtcDateTimeJsonConverter : JsonConverter<DateTime>
    {
        public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType != JsonTokenType.String)
                throw new JsonException("Expected an ISO-8601 date-time string.");

            var text = reader.GetString() ?? string.Empty;
            return Normalize(text);
        }

        public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options)
        {
            writer.WriteStringValue(ToUtc(value).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture));
        }

        internal static DateTime Normalize(string text)
        {
            // DateTimeOffset keeps an explicit offset ("Z", "+07:00") honest; a value with no offset
            // is treated as UTC rather than as the server's local time.
            if (DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var dto))
            {
                return DateTime.SpecifyKind(dto.UtcDateTime, DateTimeKind.Utc);
            }
            if (DateTime.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var dt))
            {
                return DateTime.SpecifyKind(dt, DateTimeKind.Utc);
            }
            throw new JsonException($"Invalid date-time value '{text}'.");
        }

        internal static DateTime ToUtc(DateTime value)
        {
            return value.Kind switch
            {
                DateTimeKind.Utc => value,
                DateTimeKind.Local => value.ToUniversalTime(),
                _ => DateTime.SpecifyKind(value, DateTimeKind.Utc)
            };
        }
    }

    public sealed class UtcNullableDateTimeJsonConverter : JsonConverter<DateTime?>
    {
        public override DateTime? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType == JsonTokenType.Null) return null;
            if (reader.TokenType != JsonTokenType.String)
                throw new JsonException("Expected an ISO-8601 date-time string or null.");
            var text = reader.GetString();
            if (string.IsNullOrWhiteSpace(text)) return null;
            return UtcDateTimeJsonConverter.Normalize(text);
        }

        public override void Write(Utf8JsonWriter writer, DateTime? value, JsonSerializerOptions options)
        {
            if (value == null) { writer.WriteNullValue(); return; }
            writer.WriteStringValue(UtcDateTimeJsonConverter.ToUtc(value.Value).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture));
        }
    }
}
