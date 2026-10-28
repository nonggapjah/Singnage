using System.Text.Json;
using SignageUnicorn.Api.Constants;
using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Models.Json;
using SignageUnicorn.Api.Repositories;
using SignageUnicorn.Api.Repositories.Implementations;
using SignageUnicorn.Api.Services;
using Xunit;

namespace SignageUnicorn.Api.Tests
{
    public class SqlTransientErrorsTests
    {
        [Theory]
        [InlineData(-2, true)]      // timeout
        [InlineData(1205, true)]    // deadlock victim
        [InlineData(4060, true)]    // database unavailable
        [InlineData(10054, true)]   // connection reset
        [InlineData(40501, true)]   // service busy
        [InlineData(547, false)]    // FK violation: the data is wrong, not the connection
        [InlineData(2627, false)]   // unique violation
        [InlineData(8152, false)]   // string truncation
        [InlineData(0, false)]
        public void Retryable_numbers_are_the_transient_ones(int number, bool expected)
            => Assert.Equal(expected, SqlTransientErrors.IsRetryableNumber(number));

        [Fact]
        public void Timeouts_and_pool_exhaustion_are_retryable_but_ordinary_exceptions_are_not()
        {
            Assert.True(SqlTransientErrors.IsRetryable(new TimeoutException("x")));
            Assert.True(SqlTransientErrors.IsRetryable(new InvalidOperationException("Timeout expired. The timeout period elapsed prior to obtaining a connection from the pool.")));
            Assert.True(SqlTransientErrors.IsRetryable(new Exception("outer", new TimeoutException("inner"))));
            Assert.False(SqlTransientErrors.IsRetryable(new ArgumentException("bad")));
            Assert.False(SqlTransientErrors.IsRetryable(null));
        }

        [Fact]
        public void A_batch_without_event_ids_is_legacy()
        {
            Assert.True(SpPlaybackLogRepository.IsLegacyBatch(new[] { new CreatePlaybackLogRequest(), new CreatePlaybackLogRequest { EventId = " " } }));
            Assert.False(SpPlaybackLogRepository.IsLegacyBatch(new[] { new CreatePlaybackLogRequest(), new CreatePlaybackLogRequest { EventId = "e1" } }));
        }
    }

    public class UtcDateTimeJsonConverterTests
    {
        private static readonly JsonSerializerOptions Options = new()
        {
            Converters = { new UtcDateTimeJsonConverter(), new UtcNullableDateTimeJsonConverter() }
        };

        [Fact]
        public void Unspecified_kind_is_written_as_utc_with_Z()
        {
            var value = new DateTime(2026, 10, 27, 7, 30, 0, DateTimeKind.Unspecified);
            Assert.Equal("\"2026-10-27T07:30:00.000Z\"", JsonSerializer.Serialize(value, Options));
        }

        [Fact]
        public void Local_kind_is_converted_to_utc()
        {
            var local = new DateTime(2026, 10, 27, 7, 30, 0, DateTimeKind.Local);
            var expected = local.ToUniversalTime();
            var json = JsonSerializer.Serialize(local, Options);
            Assert.Equal(expected.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'"), json.Trim('"'));
        }

        [Fact]
        public void Offsets_are_honoured_and_offsetless_input_is_utc()
        {
            var withOffset = JsonSerializer.Deserialize<DateTime>("\"2026-10-27T10:00:00+07:00\"", Options);
            Assert.Equal(DateTimeKind.Utc, withOffset.Kind);
            Assert.Equal(new DateTime(2026, 10, 27, 3, 0, 0), withOffset);

            var noOffset = JsonSerializer.Deserialize<DateTime>("\"2026-10-27T10:00:00\"", Options);
            Assert.Equal(DateTimeKind.Utc, noOffset.Kind);
            Assert.Equal(new DateTime(2026, 10, 27, 10, 0, 0), noOffset);

            var nullable = JsonSerializer.Deserialize<DateTime?>("null", Options);
            Assert.Null(nullable);
        }
    }

    public class UserRolesTests
    {
        [Theory]
        [InlineData("Admin ", "admin")]
        [InlineData("EDITOR", "editor")]
        [InlineData("viewer", "viewer")]
        [InlineData("root", null)]
        [InlineData("", null)]
        [InlineData(null, null)]
        public void Canonical_lowercases_and_rejects_unknown_roles(string? input, string? expected)
            => Assert.Equal(expected, UserRoles.Canonical(input));
    }

    public class SessionCookieTests
    {
        [Theory]
        [InlineData("GET", null, true)]
        [InlineData("head", null, true)]
        [InlineData("OPTIONS", "", true)]
        [InlineData("POST", null, false)]
        [InlineData("POST", "XMLHttpRequest", false)]
        [InlineData("POST", "SignageUnicorn", true)]
        [InlineData("DELETE", " SignageUnicorn ", true)]
        [InlineData("PUT", "signageunicorn", false)]
        public void Cookie_auth_is_honoured_only_for_safe_methods_or_with_the_header(string method, string? header, bool expected)
            => Assert.Equal(expected, SessionCookie.IsCsrfSafe(method, header));
    }
}
