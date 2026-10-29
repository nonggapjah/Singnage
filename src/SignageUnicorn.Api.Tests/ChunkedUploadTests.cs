using System.Security.Cryptography;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Services;
using SignageUnicorn.Api.Tests.Fakes;
using Xunit;

namespace SignageUnicorn.Api.Tests
{
    // Chunked / resumable upload: a file arrives as a sequence of parts (each kept under the
    // Cloudflare 100 MB per-request cap), and the server assembles, validates and publishes it
    // through the same pipeline as a single-shot upload. These tests pin the assembly order, the
    // integrity checks (size + sha256 + magic bytes), and the incomplete-session guards.
    public class ChunkedUploadTests : IDisposable
    {
        private readonly string _webRoot;
        private readonly MediaService _service;
        private readonly FakeMediaRepository _repo;

        public ChunkedUploadTests()
        {
            _webRoot = Path.Combine(Path.GetTempPath(), "su_chunk_test_" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(_webRoot);
            _repo = new FakeMediaRepository();
            _service = new MediaService(
                _repo,
                new FakeWebHostEnvironment { WebRootPath = _webRoot },
                new HttpContextAccessor(),
                new ConfigurationBuilder().Build(),
                new FakeSystemLogRepository(),
                new FakeDeviceRepository());
        }

        public void Dispose()
        {
            try { Directory.Delete(_webRoot, true); } catch { }
        }

        // A minimal byte payload whose first bytes satisfy the .jpg magic-byte check (0xFF 0xD8 0xFF)
        // and is long enough (>= 12 bytes) to pass validation. Using an image keeps NeedsTranscoding
        // false, so completing the upload never triggers the background ffmpeg transcode.
        private static byte[] JpegBytes(int length)
        {
            var b = new byte[Math.Max(length, 16)];
            b[0] = 0xFF; b[1] = 0xD8; b[2] = 0xFF; b[3] = 0xE0;
            for (int i = 4; i < b.Length; i++) b[i] = (byte)(i % 251);
            return b;
        }

        private static string Sha256Hex(byte[] data)
            => Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();

        private async Task SaveChunkAsync(string uploadId, int index, byte[] data)
        {
            using var ms = new MemoryStream(data);
            await _service.ChunkSaveAsync(uploadId, index, ms);
        }

        [Fact]
        public void Init_rejects_a_disallowed_extension()
        {
            var ex = Assert.Throws<MediaValidationException>(() =>
                _service.ChunkInit(new ChunkedUploadInitRequest { FileName = "evil.html", TotalSize = 100, TotalChunks = 1 }));
            Assert.Contains("not allowed", ex.Message);
        }

        [Theory]
        [InlineData(0, 1)]                 // zero size
        [InlineData(100, 0)]               // zero chunks
        [InlineData(100, 101)]             // more chunks than bytes
        public void Init_rejects_bad_size_or_chunk_count(long totalSize, int totalChunks)
        {
            Assert.Throws<MediaValidationException>(() =>
                _service.ChunkInit(new ChunkedUploadInitRequest { FileName = "a.jpg", TotalSize = totalSize, TotalChunks = totalChunks }));
        }

        [Fact]
        public async Task Happy_path_assembles_chunks_in_index_order_and_publishes()
        {
            var payload = JpegBytes(40);
            var first = payload[..25];
            var second = payload[25..];
            var sha = Sha256Hex(payload);

            var init = _service.ChunkInit(new ChunkedUploadInitRequest
            {
                FileName = "clip.jpg",
                TotalSize = payload.Length,
                TotalChunks = 2,
                Sha256 = sha
            });

            // Upload OUT OF ORDER (part 1 before part 0) to prove the server assembles by index.
            await SaveChunkAsync(init.UploadId, 1, second);
            await SaveChunkAsync(init.UploadId, 0, first);

            var status = _service.ChunkStatus(init.UploadId);
            Assert.Equal(new[] { 0, 1 }, status.ReceivedChunks);
            Assert.Equal(2, status.TotalChunks);

            var result = await _service.ChunkCompleteAsync(init.UploadId, new ChunkedUploadCompleteRequest
            {
                DisplayName = "Clip",
                Supplier_Code = "ACME"
            }, userId: 1);

            Assert.NotNull(result);
            Assert.Equal("/media/", result!.BlobUrl[..7]);

            // The published file holds the original bytes in the original order.
            var publishedName = result.BlobUrl.Replace("/media/", "");
            var publishedPath = Path.Combine(_webRoot, "media", publishedName);
            Assert.True(File.Exists(publishedPath));
            Assert.Equal(payload, await File.ReadAllBytesAsync(publishedPath));

            // The session folder is cleaned up.
            Assert.Empty(Directory.GetDirectories(Path.Combine(_webRoot, "media", "_staging")));
        }

        [Fact]
        public async Task Complete_rejects_a_missing_chunk()
        {
            var payload = JpegBytes(40);
            var init = _service.ChunkInit(new ChunkedUploadInitRequest { FileName = "clip.jpg", TotalSize = payload.Length, TotalChunks = 2 });
            await SaveChunkAsync(init.UploadId, 0, payload[..25]); // never send chunk 1

            var ex = await Assert.ThrowsAsync<MediaValidationException>(() =>
                _service.ChunkCompleteAsync(init.UploadId, new ChunkedUploadCompleteRequest { DisplayName = "Clip", Supplier_Code = "ACME" }, 1));
            Assert.Contains("missing chunk", ex.Message);
        }

        [Fact]
        public async Task Complete_rejects_a_size_mismatch()
        {
            var payload = JpegBytes(40);
            // Declare a larger total than what we actually send.
            var init = _service.ChunkInit(new ChunkedUploadInitRequest { FileName = "clip.jpg", TotalSize = payload.Length + 10, TotalChunks = 1 });
            await SaveChunkAsync(init.UploadId, 0, payload);

            var ex = await Assert.ThrowsAsync<MediaValidationException>(() =>
                _service.ChunkCompleteAsync(init.UploadId, new ChunkedUploadCompleteRequest { DisplayName = "Clip", Supplier_Code = "ACME" }, 1));
            Assert.Contains("does not match", ex.Message);
        }

        [Fact]
        public async Task Complete_rejects_a_checksum_mismatch()
        {
            var payload = JpegBytes(40);
            var init = _service.ChunkInit(new ChunkedUploadInitRequest
            {
                FileName = "clip.jpg",
                TotalSize = payload.Length,
                TotalChunks = 1,
                Sha256 = new string('0', 64) // wrong hash
            });
            await SaveChunkAsync(init.UploadId, 0, payload);

            var ex = await Assert.ThrowsAsync<MediaValidationException>(() =>
                _service.ChunkCompleteAsync(init.UploadId, new ChunkedUploadCompleteRequest { DisplayName = "Clip", Supplier_Code = "ACME" }, 1));
            Assert.Contains("Checksum", ex.Message);
        }

        [Fact]
        public async Task Complete_rejects_content_that_is_not_the_declared_type()
        {
            // 40 bytes that are NOT a JPEG, uploaded as a .jpg: the magic-byte check must reject it.
            var notJpeg = new byte[40];
            for (int i = 0; i < notJpeg.Length; i++) notJpeg[i] = (byte)i;
            var init = _service.ChunkInit(new ChunkedUploadInitRequest { FileName = "clip.jpg", TotalSize = notJpeg.Length, TotalChunks = 1 });
            await SaveChunkAsync(init.UploadId, 0, notJpeg);

            await Assert.ThrowsAsync<MediaValidationException>(() =>
                _service.ChunkCompleteAsync(init.UploadId, new ChunkedUploadCompleteRequest { DisplayName = "Clip", Supplier_Code = "ACME" }, 1));
        }

        [Fact]
        public async Task Resending_a_chunk_is_idempotent()
        {
            var payload = JpegBytes(40);
            var init = _service.ChunkInit(new ChunkedUploadInitRequest { FileName = "clip.jpg", TotalSize = payload.Length, TotalChunks = 1 });
            await SaveChunkAsync(init.UploadId, 0, payload);
            await SaveChunkAsync(init.UploadId, 0, payload); // retry/resume sends it again

            var status = _service.ChunkStatus(init.UploadId);
            Assert.Equal(new[] { 0 }, status.ReceivedChunks);

            var result = await _service.ChunkCompleteAsync(init.UploadId, new ChunkedUploadCompleteRequest { DisplayName = "Clip", Supplier_Code = "ACME" }, 1);
            Assert.NotNull(result);
        }

        [Fact]
        public async Task Abort_discards_the_session()
        {
            var init = _service.ChunkInit(new ChunkedUploadInitRequest { FileName = "clip.jpg", TotalSize = 40, TotalChunks = 1 });
            await SaveChunkAsync(init.UploadId, 0, JpegBytes(40));

            await _service.ChunkAbortAsync(init.UploadId);

            Assert.Throws<MediaValidationException>(() => _service.ChunkStatus(init.UploadId));
        }

        [Fact]
        public async Task A_part_over_the_declared_total_is_rejected_and_not_stored()
        {
            // Declared total is 40 bytes but the client pushes a 60-byte part: it must be refused and
            // nothing committed, so a client ignoring the 400 cannot pile unbounded data on disk.
            var init = _service.ChunkInit(new ChunkedUploadInitRequest { FileName = "clip.jpg", TotalSize = 40, TotalChunks = 1 });

            await Assert.ThrowsAsync<MediaValidationException>(() => SaveChunkAsync(init.UploadId, 0, JpegBytes(60)));

            var status = _service.ChunkStatus(init.UploadId);
            Assert.Empty(status.ReceivedChunks); // the rejected part left nothing behind
        }

        [Fact]
        public async Task A_second_part_that_would_exceed_the_total_is_rejected()
        {
            // 40-byte total split into 2 declared parts; the first 30-byte part fits, a second 30-byte
            // part would make 60 > 40 and must be refused without being stored.
            var init = _service.ChunkInit(new ChunkedUploadInitRequest { FileName = "clip.jpg", TotalSize = 40, TotalChunks = 2 });
            await SaveChunkAsync(init.UploadId, 0, JpegBytes(30));

            await Assert.ThrowsAsync<MediaValidationException>(() => SaveChunkAsync(init.UploadId, 1, JpegBytes(30)));

            var status = _service.ChunkStatus(init.UploadId);
            Assert.Equal(new[] { 0 }, status.ReceivedChunks); // only the first part survived
        }

        [Fact]
        public async Task A_session_is_only_accessible_to_its_owner()
        {
            var init = _service.ChunkInit(new ChunkedUploadInitRequest { FileName = "clip.jpg", TotalSize = 40, TotalChunks = 1 }, userId: 1);

            // A different user may not read, write, complete or abort it.
            Assert.Throws<MediaValidationException>(() => _service.ChunkStatus(init.UploadId, userId: 2));
            await Assert.ThrowsAsync<MediaValidationException>(async () =>
            {
                using var ms = new MemoryStream(JpegBytes(40));
                await _service.ChunkSaveAsync(init.UploadId, 0, ms, userId: 2);
            });
            await Assert.ThrowsAsync<MediaValidationException>(() =>
                _service.ChunkCompleteAsync(init.UploadId, new ChunkedUploadCompleteRequest { DisplayName = "Clip", Supplier_Code = "ACME" }, userId: 2));

            // The owner still can.
            using (var ms = new MemoryStream(JpegBytes(40)))
                await _service.ChunkSaveAsync(init.UploadId, 0, ms, userId: 1);
            var result = await _service.ChunkCompleteAsync(init.UploadId, new ChunkedUploadCompleteRequest { DisplayName = "Clip", Supplier_Code = "ACME" }, userId: 1);
            Assert.NotNull(result);
        }

        [Fact]
        public async Task Concurrent_parts_cannot_both_survive_over_the_total_cap()
        {
            // Two 30-byte parts fired at once into a session that declared 40 bytes. The per-session
            // lock makes the read-sum-then-commit atomic, so exactly one commits and the other is
            // rejected — total stored can never exceed the declared size even under concurrency.
            var init = _service.ChunkInit(new ChunkedUploadInitRequest { FileName = "clip.jpg", TotalSize = 40, TotalChunks = 2 });

            async Task<Exception?> Save(int i)
            {
                using var ms = new MemoryStream(JpegBytes(30));
                return await Record.ExceptionAsync(() => _service.ChunkSaveAsync(init.UploadId, i, ms));
            }

            var t0 = Save(0);
            var t1 = Save(1);
            await Task.WhenAll(t0, t1);

            Assert.Equal(1, new[] { t0.Result, t1.Result }.Count(e => e is MediaValidationException)); // exactly one rejected
            var status = _service.ChunkStatus(init.UploadId);
            Assert.Single(status.ReceivedChunks); // only one part survived
        }
    }
}
