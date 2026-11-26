using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using SignageUnicorn.Api.Middleware;
using SignageUnicorn.Api.Services;
using Xunit;

namespace SignageUnicorn.Api.Tests
{
    // Media egress gate (API 2.8.12): slot admission, queue timeout, shared bandwidth cap, settings.
    public class MediaEgressGateTests
    {
        [Fact]
        public async Task SecondRequestWaitsForSlotAndTimesOut()
        {
            using var gate = new MediaEgressGate(new MediaEgressSettings(1, 0, 0), "test");
            Assert.True(await gate.TryEnterAsync(CancellationToken.None));
            // Only one slot and a 0 s queue: the next one is refused immediately and counted.
            Assert.False(await gate.TryEnterAsync(CancellationToken.None));
            var s = gate.Snapshot();
            Assert.Equal(1, s.InFlight);
            Assert.Equal(1, s.Admitted);
            Assert.Equal(1, s.Rejected);
            gate.Exit();
            Assert.True(await gate.TryEnterAsync(CancellationToken.None));
            gate.Exit();
            Assert.Equal(0, gate.Snapshot().InFlight);
        }

        [Fact]
        public async Task QueuedRequestIsAdmittedWhenASlotFrees()
        {
            using var gate = new MediaEgressGate(new MediaEgressSettings(1, 5, 0), "test");
            Assert.True(await gate.TryEnterAsync(CancellationToken.None));
            var second = gate.TryEnterAsync(CancellationToken.None);
            await Task.Delay(100);
            Assert.False(second.IsCompleted);
            Assert.Equal(1, gate.Snapshot().Waiting);
            gate.Exit();
            Assert.True(await second);
            gate.Exit();
            Assert.Equal(0, gate.Snapshot().Rejected);
        }

        [Fact]
        public async Task CancelledWhileQueuedIsNotCountedAsRejected()
        {
            using var gate = new MediaEgressGate(new MediaEgressSettings(1, 5, 0), "test");
            Assert.True(await gate.TryEnterAsync(CancellationToken.None));
            using var cts = new CancellationTokenSource(50);
            Assert.False(await gate.TryEnterAsync(cts.Token));
            Assert.Equal(0, gate.Snapshot().Rejected);
            gate.Exit();
        }

        [Fact]
        public async Task LoweringTheSlotLimitTakesEffectAsSlotsReturn()
        {
            using var gate = new MediaEgressGate(new MediaEgressSettings(2, 0, 0), "test");
            Assert.True(await gate.TryEnterAsync(CancellationToken.None));
            Assert.True(await gate.TryEnterAsync(CancellationToken.None));
            Assert.True(gate.Apply(new MediaEgressSettings(1, 0, 0), "test"));
            gate.Exit();                 // this permit is swallowed (limit went 2 -> 1)
            Assert.False(await gate.TryEnterAsync(CancellationToken.None));
            gate.Exit();                 // now one slot is really free
            Assert.True(await gate.TryEnterAsync(CancellationToken.None));
            gate.Exit();
            // Raising it again hands out new permits at once.
            Assert.True(gate.Apply(new MediaEgressSettings(3, 0, 0), "test"));
            Assert.True(await gate.TryEnterAsync(CancellationToken.None));
            Assert.True(await gate.TryEnterAsync(CancellationToken.None));
            Assert.True(await gate.TryEnterAsync(CancellationToken.None));
            Assert.False(await gate.TryEnterAsync(CancellationToken.None));
        }

        [Fact]
        public async Task ThrottledStreamPacesWritesToTheCap()
        {
            // 4 Mbit/s = 500 KB/s. The bucket starts full with one second's burst (500 KB), so writing
            // 1.5 MB needs about 2 s of replenishment. Assert a loose lower bound to stay robust on CI.
            using var gate = new MediaEgressGate(new MediaEgressSettings(10, 0, 4), "test");
            using var sink = new MemoryStream();
            var body = gate.Throttle(sink, CancellationToken.None);
            var payload = new byte[1_500_000];
            var sw = Stopwatch.StartNew();
            await body.WriteAsync(payload, CancellationToken.None);
            sw.Stop();
            Assert.Equal(payload.Length, sink.Length);
            Assert.True(sw.Elapsed >= TimeSpan.FromSeconds(1.0), $"took only {sw.Elapsed.TotalMilliseconds:N0} ms");
            Assert.Equal(payload.Length, gate.Snapshot().BytesSent);
            Assert.True(gate.Snapshot().ThrottleWaits > 0);
        }

        [Fact]
        public async Task UnlimitedCapDoesNotPace()
        {
            using var gate = new MediaEgressGate(new MediaEgressSettings(10, 0, 0), "test");
            using var sink = new MemoryStream();
            var body = gate.Throttle(sink, CancellationToken.None);
            await body.WriteAsync(new byte[4_000_000], CancellationToken.None);
            // No deadline on a wall clock (CI pauses); "never waited for tokens" is the real assertion.
            Assert.Equal(4_000_000, sink.Length);
            Assert.Equal(0, gate.Snapshot().ThrottleWaits);
        }

        [Fact]
        public async Task LoweringTheSlotLimitWhileIdleTakesBackPermitsAtOnce()
        {
            // Codex on the first cut: 40 idle permits stayed available after "limit = 1".
            using var gate = new MediaEgressGate(new MediaEgressSettings(40, 0, 0), "test");
            Assert.True(gate.Apply(new MediaEgressSettings(1, 0, 0), "test"));
            Assert.True(await gate.TryEnterAsync(CancellationToken.None));
            Assert.False(await gate.TryEnterAsync(CancellationToken.None));
            gate.Exit();
            Assert.True(await gate.TryEnterAsync(CancellationToken.None));
            gate.Exit();
        }

        [Fact]
        public async Task TinyCapIsHonouredNotRoundedUpToAChunkPerPeriod()
        {
            // 1 Mbit/s = 125 KB/s. Burst is 4 chunks (256 KB); the remaining 768 KB of a 1 MB write need
            // about 6 s. Codex: the first cut replenished a whole 64 KB chunk per 100 ms (5.2 Mbit/s).
            using var gate = new MediaEgressGate(new MediaEgressSettings(10, 0, 1), "test");
            using var sink = new MemoryStream();
            var body = gate.Throttle(sink, CancellationToken.None);
            var sw = Stopwatch.StartNew();
            await body.WriteAsync(new byte[1_048_576], CancellationToken.None);
            sw.Stop();
            Assert.Equal(1_048_576, sink.Length);
            Assert.True(sw.Elapsed >= TimeSpan.FromSeconds(4.5), $"took only {sw.Elapsed.TotalMilliseconds:N0} ms");
        }

        [Fact]
        public async Task RateChangeAppliesToWaitersAlreadyQueued()
        {
            // Start at 1 Mbit/s, queue a 1 MB write, then lift the cap: the write must finish promptly
            // instead of staying on the old rate (Codex: the first cut kept two limiters alive).
            using var gate = new MediaEgressGate(new MediaEgressSettings(10, 0, 1), "test");
            using var sink = new MemoryStream();
            var body = gate.Throttle(sink, CancellationToken.None);
            var write = body.WriteAsync(new byte[1_048_576], CancellationToken.None).AsTask();
            // Queued state is observed, not assumed: the writer has waited for tokens at least once.
            await WaitUntil(() => gate.Snapshot().ThrottleWaits > 0 || write.IsCompleted);
            gate.Apply(new MediaEgressSettings(10, 0, 0), "test");
            var finished = await Task.WhenAny(write, Task.Delay(TimeSpan.FromSeconds(20)));
            Assert.Same(write, finished);
            await write;
            Assert.Equal(1_048_576, sink.Length);
        }

        [Fact]
        public async Task CancelledWriterDoesNotBlockTheQueueBehindIt()
        {
            using var gate = new MediaEgressGate(new MediaEgressSettings(10, 0, 1), "test");
            // Drain the burst so the next writers must queue.
            using var sink0 = new MemoryStream();
            await gate.Throttle(sink0, CancellationToken.None).WriteAsync(new byte[256 * 1024], CancellationToken.None);
            using var cts = new CancellationTokenSource();
            using var sinkA = new MemoryStream();
            // A asks for a big write so it is still queued (far from done) when we cancel it.
            var a = gate.Throttle(sinkA, cts.Token).WriteAsync(new byte[4 * 1024 * 1024], CancellationToken.None).AsTask();
            await WaitUntil(() => gate.Snapshot().ThrottleWaits > 0);
            using var sinkB = new MemoryStream();
            var b = gate.Throttle(sinkB, CancellationToken.None).WriteAsync(new byte[64 * 1024], CancellationToken.None).AsTask();
            cts.Cancel();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => a);
            var finished = await Task.WhenAny(b, Task.Delay(TimeSpan.FromSeconds(20)));
            Assert.Same(b, finished);
            Assert.Equal(64 * 1024, sinkB.Length);
            Assert.True(sinkA.Length < 4 * 1024 * 1024, "A was cancelled before it could finish");
        }

        private static async Task WaitUntil(Func<bool> condition)
        {
            var deadline = DateTime.UtcNow.AddSeconds(20);
            while (!condition())
            {
                if (DateTime.UtcNow > deadline) throw new TimeoutException("condition not reached within 20 s");
                await Task.Delay(10);
            }
        }

        [Fact]
        public async Task LargeAcquireIsChargedInFull()
        {
            // Codex pass 2: a direct acquire above one chunk must not be clamped to 64 KB.
            using var gate = new MediaEgressGate(new MediaEgressSettings(10, 0, 1), "test");
            var sw = Stopwatch.StartNew();
            await gate.AcquireBytesAsync(512 * 1024, CancellationToken.None);   // 256 KB burst + 256 KB at 125 KB/s
            Assert.True(sw.Elapsed >= TimeSpan.FromSeconds(1.5), $"took only {sw.Elapsed.TotalMilliseconds:N0} ms");
            Assert.Equal(512 * 1024, gate.Snapshot().BytesSent);
        }

        [Fact]
        public void SettingsOverridesAreValidatedAndFallBack()
        {
            var baseline = new MediaEgressSettings(40, 60, 150);
            // Valid overrides win.
            var s = MediaEgressSettings.WithOverrides(baseline, "20", "30", "80");
            Assert.Equal(new MediaEgressSettings(20, 30, 80), s);
            // 0 Mbit/s = unlimited is allowed; 0 slots is not; a wait above Cloudflare's limit is not.
            s = MediaEgressSettings.WithOverrides(baseline, "0", "120", "0");
            Assert.Equal(new MediaEgressSettings(40, 60, 0), s);
            // Garbage, blanks and nulls keep the baseline.
            s = MediaEgressSettings.WithOverrides(baseline, "abc", " ", null);
            Assert.Equal(baseline, s);
            s = MediaEgressSettings.WithOverrides(baseline, "-5", "-1", "99999");
            Assert.Equal(baseline, s);
        }

        [Fact]
        public void SettingsFromConfigurationUseDefaultsWhenAbsent()
        {
            var empty = new ConfigurationBuilder().Build();
            Assert.Equal(MediaEgressSettings.Default, MediaEgressSettings.FromConfiguration(empty));
            var cfg = new ConfigurationBuilder().AddInMemoryCollection(new System.Collections.Generic.Dictionary<string, string?>
            {
                ["Media:MaxConcurrentDownloads"] = "25",
                ["Media:QueueWaitSeconds"] = "45",
                ["Media:MaxEgressMbps"] = "0",
            }).Build();
            Assert.Equal(new MediaEgressSettings(25, 45, 0), MediaEgressSettings.FromConfiguration(cfg));
        }

        [Theory]
        [InlineData("/media/clip.mp4", "GET", true)]
        [InlineData("/media/sub/clip.mp4", "GET", true)]
        [InlineData("/setup/Signage Unicorn Setup 2.8.8.exe", "GET", true)]
        [InlineData("/media/clip.mp4", "HEAD", false)]
        [InlineData("/api/v1/media/5", "GET", false)]
        [InlineData("/mediafiles/x", "GET", false)]
        [InlineData("/", "GET", false)]
        public void OnlyGetsUnderMediaAndSetupAreGated(string path, string method, bool expected)
            => Assert.Equal(expected, MediaEgressMiddleware.IsGated(new Microsoft.AspNetCore.Http.PathString(path), method));
    }
}
