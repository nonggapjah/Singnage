using SignageUnicorn.Api.Models;

namespace SignageUnicorn.Api.Repositories.Interfaces
{
    public interface IUserRepository
    {
        Task<User?> GetByUsernameAsync(string username);
        Task<User?> GetByIdAsync(string userId);
        Task<RepositoryResult> CreateAsync(User user);
        Task<RepositoryResult> UpdateAsync(User user);
        Task<RepositoryResult> UpdatePasswordAsync(string userId, string passwordHash);
        Task<RepositoryResult> DeleteAsync(string userId);
        Task<IEnumerable<User>> GetAllAsync();
    }
}
