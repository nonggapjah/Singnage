using SignageUnicorn.Api.Models;

namespace SignageUnicorn.Api.Repositories.Interfaces
{
    public interface IUserRepository
    {
        Task<User?> GetByUsernameAsync(string username);
        Task<User?> GetByIdAsync(string userId);
        Task<RepositoryResult> CreateAsync(User user, string? executorId = null);
        Task<RepositoryResult> UpdateAsync(User user, string? executorId = null);
        Task<RepositoryResult> UpdatePasswordAsync(string userId, string passwordHash, string? executorId = null);
        Task<RepositoryResult> DeleteAsync(string userId);
        Task<IEnumerable<User>> GetAllAsync();
    }
}
