namespace SignageUnicorn.Api.Services
{
    // Contract T12. The admin console used to keep the JWT in localStorage, where any script that
    // ever ran on the origin (an uploaded file served inline, a dependency) could read it. The login
    // response now ALSO sets this HttpOnly cookie; the bearer validator falls back to it when no
    // Authorization header is present. Because a cookie is sent automatically, every state-changing
    // request authenticated by it must prove it came from our own code: the X-Requested-With header
    // cannot be set by a cross-site form post and is only sent cross-origin after a CORS preflight
    // that the browser performs against our policy. GET/HEAD/OPTIONS carry no such requirement.
    public static class SessionCookie
    {
        public const string Name = "su_session";
        public const string CsrfHeaderName = "X-Requested-With";
        public const string CsrfHeaderValue = "SignageUnicorn";
        public const string AuthSourceItem = "SignageUnicorn.AuthSource";
        public const string CsrfBlockedItem = "SignageUnicorn.CsrfBlocked";

        public static bool IsSafeMethod(string? method)
        {
            var m = (method ?? string.Empty).ToUpperInvariant();
            return m is "GET" or "HEAD" or "OPTIONS";
        }

        // Whether a cookie-authenticated request may be honoured.
        public static bool IsCsrfSafe(string? method, string? requestedWithHeader)
        {
            if (IsSafeMethod(method)) return true;
            return string.Equals((requestedWithHeader ?? string.Empty).Trim(), CsrfHeaderValue, StringComparison.Ordinal);
        }
    }
}
