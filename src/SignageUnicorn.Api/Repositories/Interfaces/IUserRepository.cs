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
        // F12: a real deactivation (status = inactive, sessions revoked), not "Not Implemented".
        Task<RepositoryResult> DeleteAsync(string userId, string? executorId = null);
        Task<IEnumerable<User>> GetAllAsync();
        // F12: current token_version for revocation checks; null when the user does not exist.
        Task<int?> GetTokenVersionAsync(string userId);
        Task RecordLoginOutcomeAsync(string userId, bool success);
    }
}
