namespace SignageUnicorn.Api.Services
{
    // F11: the signing key used to be resolved twice -- Program.cs generated a random development
    // key when the configured secret was blank/placeholder, while AuthService independently re-read
    // the ORIGINAL configuration value (or a hard-coded fallback). Tokens were then minted with one
    // key and validated with another. This object is resolved exactly once at startup and injected
    // into both the bearer validation and the token issuer, so there is a single source of truth.
    public sealed class JwtOptions
    {
        public string Secret { get; init; } = string.Empty;
        public string Issuer { get; init; } = string.Empty;
        public string Audience { get; init; } = string.Empty;
        public int ExpiryMinutes { get; init; } = 1440;

        public byte[] KeyBytes => System.Text.Encoding.ASCII.GetBytes(Secret);
    }
}
