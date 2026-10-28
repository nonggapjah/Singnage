namespace SignageUnicorn.Api.Constants
{
    public static class UserRoles
    {
        public const string Admin = "admin";
        public const string Editor = "editor";
        public const string Viewer = "viewer";

        // F02: the ONE canonical form every role goes through before an authorization decision.
        // Returns null for anything outside the known set so callers reject it outright.
        public static string? Canonical(string? role)
        {
            if (string.IsNullOrWhiteSpace(role)) return null;
            var r = role.Trim().ToLowerInvariant();
            return r is Admin or Editor or Viewer ? r : null;
        }

        // Round 4 (#11): null when the (canonical) requested role is the one the user already has,
        // so an ordinary profile save never turns into a role update (which revokes sessions).
        public static string? ChangeOrNull(string? currentRole, string? requestedCanonical)
        {
            if (requestedCanonical == null) return null;
            var current = Canonical(currentRole);
            return string.Equals(current, requestedCanonical, StringComparison.Ordinal) ? null : requestedCanonical;
        }
    }

    public static class RolePolicies
    {
        public const string AdminOnly = "AdminPolicy";
        public const string EditorOrAdmin = "EditorPolicy";
    }
}
