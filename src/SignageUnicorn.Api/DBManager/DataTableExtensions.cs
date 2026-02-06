using System.Data;
using System.Reflection;

namespace SignageUnicorn.Api.DBManager
{
    public static class DataTableExtensions
    {
        public static List<T> ToList<T>(this DataTable dt) where T : new()
        {
            var list = new List<T>();
            var properties = typeof(T).GetProperties();

            foreach (DataRow row in dt.Rows)
            {
                var item = new T();
                foreach (var prop in properties)
                {
                    if (dt.Columns.Contains(prop.Name) && row[prop.Name] != DBNull.Value)
                    {
                        var value = row[prop.Name];
                        var targetType = Nullable.GetUnderlyingType(prop.PropertyType) ?? prop.PropertyType;
                        
                        try
                        {
                            var safeValue = (value == null) ? null : Convert.ChangeType(value, targetType);
                            prop.SetValue(item, safeValue);
                        }
                        catch
                        {
                            // Fallback: If direct conversion fails (e.g. Int64 to String might work via ToString, but ChangeType should handle it)
                            // Specifically for Int64 -> String, ChangeType works.
                            // But what if target is String and value is Int64? Convert.ChangeType(123L, typeof(string)) returns "123". Correct.
                            // What if mismatched complex types? Ignore or log.
                            // For this specific error (Int64 -> String), Convert.ChangeType works.
                        }
                    }
                }
                list.Add(item);
            }

            return list;
        }

        public static T? FirstOrDefault<T>(this DataTable dt) where T : new()
        {
            var list = dt.ToList<T>();
            return list.Count > 0 ? list[0] : default;
        }
    }
}
