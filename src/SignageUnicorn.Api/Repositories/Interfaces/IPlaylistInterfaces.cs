using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Models.Domain;

namespace SignageUnicorn.Api.Repositories.Interfaces
{
    public interface IPlaylistRepository
    {
        Task<IEnumerable<PlaylistDto>> GetAllPlaylistsAsync(bool activeOnly = false, string searchTerm = null);
        Task<PlaylistDto?> GetPlaylistByIdAsync(string playlistId);

        // Actions return RepositoryResult for better error handling
        Task<RepositoryResult> CreatePlaylistAsync(string playlistId, string playlistName, string description, string createdBy, string active);
        Task<RepositoryResult> UpdatePlaylistAsync(string playlistId, string playlistName, string description, string active, long? userId = null);
        Task<RepositoryResult> DeletePlaylistAsync(string playlistId, long? userId = null);

        // F16: header + complete item set in ONE transaction. A failure anywhere rolls everything back
        // so a playlist can never be left empty or half-replaced.
        Task<RepositoryResult> SavePlaylistAsync(string playlistId, string playlistName, string description, string active, IReadOnlyList<PlaylistItemWrite> items, long? userId = null);
        Task<RepositoryResult> CreatePlaylistWithItemsAsync(string playlistId, string playlistName, string description, string active, IReadOnlyList<PlaylistItemWrite> items, long? userId = null);

        Task<IEnumerable<PlaylistItemDto>> GetPlaylistItemsAsync(string playlistId);
        Task<RepositoryResult> AddPlaylistItemAsync(string playlistItemId, string playlistId, string mediaId, int positionOrder, int? durationOverride, long? userId = null);
        Task<RepositoryResult> RemovePlaylistItemAsync(string playlistItemId, long? userId = null);
        Task<RepositoryResult> ClearPlaylistItemsAsync(string playlistId, long? userId = null);
        Task<RepositoryResult> ReorderPlaylistItemAsync(string playlistItemId, int positionOrder, long? userId = null);
        Task<RepositoryResult> DeleteAllItemsByMediaIdAsync(string mediaId, long? userId = null);
    }

    public sealed class PlaylistItemWrite
    {
        public string MediaId { get; init; } = string.Empty;
        public int PositionOrder { get; init; }
        public int? DurationOverride { get; init; }
    }
}
