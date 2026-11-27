using SignageUnicorn.Api.Repositories.Interfaces;
using SignageUnicorn.Api.Services;

namespace SignageUnicorn.Api.Middleware
{
    /// <summary>
    /// Applies <see cref="MediaEgressGate"/> to GET responses under /media and /setup (the two static
    /// trees the screens download from). Sits right before UseStaticFiles. See the gate for why.
    ///
    /// Settings: code defaults &lt; appsettings Media:* &lt; sn_system_settings overrides
    /// (MediaMaxConcurrentDownloads, MediaMaxEgressMbps, MediaQueueWaitSeconds), the overrides being
    /// re-read at most every 30 s by whichever gated request comes first, so an operator can lift
    /// the cap for a night push and lower it again without touching the server.
    /// </summary>
    public sealed class MediaEgressMiddleware
    {
        public const string SlotsKey = "MediaMaxConcurrentDownloads";
        public const string MbpsKey = "MediaMaxEgressMbps";
        public const string WaitKey = "MediaQueueWaitSeconds";
        private static readonly TimeSpan SettingsRefresh = TimeSpan.FromSeconds(30);
        private static readonly TimeSpan RejectLogInterval = TimeSpan.FromSeconds(30);
        private static readonly TimeSpan SettingsReadTimeout = TimeSpan.FromSeconds(10);

        private readonly RequestDelegate _next;
        private readonly MediaEgressGate _gate;
        private readonly MediaEgressSettings _baseline;
        private readonly ILogger<MediaEgressMiddleware> _logger;
        private long _nextRefreshTicks;            // DateTime ticks (UTC) of the next settings read
        private int _refreshing;                   // 1 while a refresh is in progress
        private long _rejectedSinceLog;
        private long _nextRejectLogTicks;

        public MediaEgressMiddleware(RequestDelegate next, MediaEgressGate gate, IConfiguration configuration, ILogger<MediaEgressMiddleware> logger)
        {
            _next = next;
            _gate = gate;
            _logger = logger;
            _baseline = MediaEgressSettings.FromConfiguration(configuration);
            _gate.Apply(_baseline, "appsettings");
            _logger.LogInformation("[Egress] Media egress gate on: {Slots} concurrent downloads, {Wait}s queue, {Mbps} Mbit/s cap (hard max {HardMax}).",
                _baseline.MaxConcurrentDownloads, _baseline.QueueWaitSeconds, _baseline.MaxEgressMbps, MediaEgressSettings.HardMaxEgressMbps);
        }

        public static bool IsGated(PathString path, string method)
            => HttpMethods.IsGet(method)
               && (path.StartsWithSegments("/media") || path.StartsWithSegments("/setup"));

        public async Task InvokeAsync(HttpContext context)
        {
            if (!IsGated(context.Request.Path, context.Request.Method))
            {
                await _next(context);
                return;
            }

            // Overrides are refreshed in the background with their own deadline; this request proceeds
            // with the settings in force (Codex: three inline DB reads could push a queued request past
            // Cloudflare's 100 s before the gate's own 503).
            KickSettingsRefresh(context.RequestServices);

            var ct = context.RequestAborted;
            if (!await _gate.TryEnterAsync(ct))
            {
                if (ct.IsCancellationRequested) return;   // client gone while queued
                NoteRejected(context.Request.Path);
                context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
                context.Response.Headers["Retry-After"] = "30";
                context.Response.Headers["X-Egress-Gate"] = "queue-timeout";
                context.Response.ContentType = "text/plain";
                await context.Response.WriteAsync("Too many downloads in progress; retry later.", ct);
                return;
            }

            var original = context.Response.Body;
            var throttled = _gate.Throttle(original, ct);
            context.Response.Headers["X-Egress-Gate"] = "admitted";
            // Media integrity (2.8.15): count admitted downloads per file; a file fetched far more often
            // than there are screens is a re-download loop and gets quarantined by the worker.
            if (context.Request.Path.StartsWithSegments("/media"))
                SignageUnicorn.Api.Services.Media.MediaIntegrityState.Current?.NoteDownload(context.Request.Path.Value);
            try
            {
                context.Response.Body = throttled;
                await _next(context);
                await throttled.FlushAsync(ct);
            }
            finally
            {
                context.Response.Body = original;
                _gate.Exit();
            }
        }

        private void KickSettingsRefresh(IServiceProvider requestServices)
        {
            var now = DateTime.UtcNow.Ticks;
            if (now < Interlocked.Read(ref _nextRefreshTicks)) return;
            if (Interlocked.Exchange(ref _refreshing, 1) == 1) return;   // a refresh is already running
            // Own scope: the request's scope is disposed when the response ends, possibly before we finish.
            var scopeFactory = requestServices.GetRequiredService<IServiceScopeFactory>();
            _ = Task.Run(() => RefreshSettingsAsync(scopeFactory));
        }

        private async Task RefreshSettingsAsync(IServiceScopeFactory scopeFactory)
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var settings = scope.ServiceProvider.GetRequiredService<ISystemSettingsRepository>();
                using var deadline = new CancellationTokenSource(SettingsReadTimeout);
                string? slots, mbps, wait;
                try
                {
                    // The repository has no cancellation parameter; the deadline bounds how long we wait
                    // for it, the connection's own timeout bounds the call itself.
                    var read = Task.Run(async () => (
                        await settings.GetSettingAsync(SlotsKey),
                        await settings.GetSettingAsync(MbpsKey),
                        await settings.GetSettingAsync(WaitKey)));
                    var done = await Task.WhenAny(read, Task.Delay(Timeout.InfiniteTimeSpan, deadline.Token));
                    if (done != read) throw new TimeoutException($"settings read exceeded {SettingsReadTimeout.TotalSeconds:N0} s");
                    (slots, mbps, wait) = await read;
                }
                catch (Exception ex)
                {
                    // The DB being slow or unreachable must never change the gate: keep the current settings.
                    _logger.LogWarning(ex, "[Egress] Could not read egress overrides from sn_system_settings; keeping {Slots}/{Wait}s/{Mbps} Mbit/s.",
                        _gate.Settings.MaxConcurrentDownloads, _gate.Settings.QueueWaitSeconds, _gate.Settings.MaxEgressMbps);
                    return;
                }
                var overridden = !string.IsNullOrWhiteSpace(slots) || !string.IsNullOrWhiteSpace(mbps) || !string.IsNullOrWhiteSpace(wait);
                var next = MediaEgressSettings.WithOverrides(_baseline, slots, wait, mbps);
                var source = overridden ? "sn_system_settings" : "appsettings";
                if (_gate.Apply(next, source))
                {
                    _logger.LogInformation("[Egress] Settings changed: {Slots} concurrent downloads, {Wait}s queue, {Mbps} Mbit/s cap ({Source}).",
                        next.MaxConcurrentDownloads, next.QueueWaitSeconds, next.MaxEgressMbps, source);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "[Egress] Settings refresh failed unexpectedly; keeping the current settings.");
            }
            finally
            {
                Interlocked.Exchange(ref _nextRefreshTicks, DateTime.UtcNow.Add(SettingsRefresh).Ticks);
                Interlocked.Exchange(ref _refreshing, 0);
            }
        }

        private void NoteRejected(PathString path)
        {
            var n = Interlocked.Increment(ref _rejectedSinceLog);
            var now = DateTime.UtcNow.Ticks;
            if (now < Interlocked.Read(ref _nextRejectLogTicks)) return;
            Interlocked.Exchange(ref _nextRejectLogTicks, DateTime.UtcNow.Add(RejectLogInterval).Ticks);
            Interlocked.Exchange(ref _rejectedSinceLog, 0);
            var s = _gate.Snapshot();
            _logger.LogWarning("[Egress] {Count} download(s) refused with 503 in the last {Window}s (last: {Path}); in flight {InFlight}/{Slots}, waiting {Waiting}, cap {Mbps} Mbit/s. Screens retry on their 15-minute schedule refresh.",
                n, (int)RejectLogInterval.TotalSeconds, path.Value, s.InFlight, s.Settings.MaxConcurrentDownloads, s.Waiting, s.Settings.MaxEgressMbps);
        }
    }
}
