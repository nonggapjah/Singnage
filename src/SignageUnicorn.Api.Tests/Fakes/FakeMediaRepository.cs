using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Repositories.Interfaces;

namespace SignageUnicorn.Api.Tests.Fakes
{
    // In-memory IMediaRepository for MediaService tests. RenameFileAsync honours the same
    // conditional contract as sp_media_std RENAME_FILE: the rename applies only while the row's
    // blob_url still ends in '/<expectedBlobName>', otherwise 409. `BeforeRename` lets a test
    // simulate a transcode that publishes new bytes between the service's read and its rename.
    public sealed class FakeMediaRepository : IMediaRepository
    {
        public List<MediaFile> Rows { get; } = new();
        public List<(string MediaId, string NewName, string? ExpectedBlob)> RenameCalls { get; } = new();
        public int ReplaceCalls { get; private set; }
        public int SwapCalls { get; private set; }
        public Action<int>? BeforeRename { get; set; } // argument: attempt number (0-based)

        public FakeMediaRepository Add(MediaFile row)
        {
            Rows.Add(row);
            return this;
        }

        private MediaFile? Find(string id) => Rows.FirstOrDefault(r => r.MediaId == id);

        private static string BlobName(string? url)
        {
            if (string.IsNullOrEmpty(url)) return string.Empty;
            var i = url.LastIndexOf('/');
            return i >= 0 ? url[(i + 1)..] : url;
        }

        public Task<IEnumerable<MediaFile>> GetAllAsync(string? searchTerm = null, string? supplierCode = null, string? remark1 = null, string? remark2 = null, string? status = null, string? mediaType = null)
            => Task.FromResult<IEnumerable<MediaFile>>(Rows.ToList());

        public Task<MediaFile?> GetByIdAsync(string id) => Task.FromResult(Find(id));

        public Task<RepositoryResult<MediaFile>> CreateAsync(MediaFile media, long? userId = null) => throw new NotImplementedException();

        public Task<RepositoryResult<MediaFile>> UpdateAsync(MediaFile media, long? userId = null)
        {
            var row = Find(media.MediaId);
            if (row == null) return Task.FromResult(RepositoryResult<MediaFile>.Fail(404, "not found"));
            row.Active = media.Active;
            row.Remark2 = media.Remark2;
            return Task.FromResult(RepositoryResult<MediaFile>.Ok(row));
        }

        public Task<RepositoryResult> DeleteAsync(string id, long? userId = null, bool force = false) => Task.FromResult(RepositoryResult.Ok());
        public Task<IEnumerable<MediaUsageDto>> GetMediaUsageAsync(string mediaId) => Task.FromResult(Enumerable.Empty<MediaUsageDto>());

        public Task<RepositoryResult<MediaFile>> SwapMediaAsync(string oldId, string newId, long? userId = null)
        {
            SwapCalls++;
            var row = Find(newId);
            return Task.FromResult(row == null
                ? RepositoryResult<MediaFile>.Fail(404, "not found")
                : RepositoryResult<MediaFile>.Ok(row, "swapped"));
        }

        public Task<RepositoryResult<MediaFile>> ReplaceAsync(MediaFile media, long? userId = null, string? expectedBlobName = null)
        {
            ReplaceCalls++;
            var row = Find(media.MediaId);
            if (row == null) return Task.FromResult(RepositoryResult<MediaFile>.Fail(404, "not found"));
            row.FileName = media.FileName;
            row.BlobUrl = media.BlobUrl;
            row.FileHash = media.FileHash;
            row.FileSizeKb = media.FileSizeKb;
            return Task.FromResult(RepositoryResult<MediaFile>.Ok(row));
        }

        public Task<RepositoryResult<MediaFile>> RenameFileAsync(string mediaId, string newFileName, string? expectedBlobName, long? userId = null)
        {
            BeforeRename?.Invoke(RenameCalls.Count);
            RenameCalls.Add((mediaId, newFileName, expectedBlobName));
            var row = Find(mediaId);
            if (row == null) return Task.FromResult(RepositoryResult<MediaFile>.Fail(404, "Media not found."));
            if (expectedBlobName != null && !string.Equals(BlobName(row.BlobUrl), expectedBlobName, StringComparison.OrdinalIgnoreCase))
                return Task.FromResult(RepositoryResult<MediaFile>.Fail(409, "Media content changed since it was read; rename skipped."));
            row.FileName = newFileName;
            return Task.FromResult(RepositoryResult<MediaFile>.Ok(row, "Media file name updated."));
        }

        public Task<RepositoryResult> RestoreAsync(string id, long? userId = null) => Task.FromResult(RepositoryResult.Ok());
        public Task<bool> SyncMediaUrls(string targetUrl, string newUrl) => Task.FromResult(true);
        public Task<bool> NormalizeMediaUrlsToRelative() => Task.FromResult(true);
    }

    public sealed class FakeWebHostEnvironment : Microsoft.AspNetCore.Hosting.IWebHostEnvironment
    {
        public string WebRootPath { get; set; } = Path.GetTempPath();
        public Microsoft.Extensions.FileProviders.IFileProvider WebRootFileProvider { get; set; } = new Microsoft.Extensions.FileProviders.NullFileProvider();
        public string ApplicationName { get; set; } = "tests";
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } = new Microsoft.Extensions.FileProviders.NullFileProvider();
        public string ContentRootPath { get; set; } = Path.GetTempPath();
        public string EnvironmentName { get; set; } = "Test";
    }
}
