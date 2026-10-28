using System.Reflection;

namespace SignageUnicorn.Api.Services
{
    // One place that knows which API build is running (csproj <Version>), used by the dashboard and
    // by GET /api/v1/system/capabilities so clients can tell a new API from the deployed one.
    public static class ApiVersion
    {
        private static readonly Lazy<string> Resolved = new(Resolve);

        public static string Current => Resolved.Value;

        private static string Resolve()
        {
            var asm = Assembly.GetExecutingAssembly();
            var informational = asm.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
            if (!string.IsNullOrWhiteSpace(informational))
            {
                // Strip the "+commit" suffix the SDK appends.
                var plus = informational.IndexOf('+');
                return plus > 0 ? informational.Substring(0, plus) : informational;
            }
            return asm.GetName().Version?.ToString(3) ?? "unknown";
        }
    }
}
