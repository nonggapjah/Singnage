using System.Threading.Tasks;

namespace SignageUnicorn.Api.Repositories.Interfaces
{
    public interface ISystemSettingsRepository
    {
        Task<string?> GetSettingAsync(string key);
        Task SetSettingAsync(string key, string value);
    }
}
