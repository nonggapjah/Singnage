namespace SignageUnicorn.Api.Constants
{
    public static class UserRoles
    {
        public const string Admin = "admin";
        public const string Editor = "editor";
        public const string Viewer = "viewer";
    }

    public static class RolePolicies
    {
        public const string AdminOnly = "AdminPolicy";
        public const string EditorOrAdmin = "EditorPolicy";
    }
}
