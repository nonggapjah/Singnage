namespace SignageUnicorn.Api.Services
{
    /// <summary>
    /// Settings of the media egress gate. Defaults come from code / appsettings <c>Media:*</c>; the
    /// operator can override each one at runtime through <c>sn_system_settings</c>
    /// (<c>MediaMaxConcurrentDownloads</c>, <c>MediaMaxEgressMbps</c>, <c>MediaQueueWaitSeconds</c>).
    /// </summary>
    public sealed record MediaEgressSettings(int MaxConcurrentDownloads, int QueueWaitSeconds, int MaxEgressMbps)
    {
        public const int DefaultMaxConcurrentDownloads = 40;
        public const int DefaultQueueWaitSeconds = 60;   // must stay below Cloudflare's 100 s origin timeout
        public const int DefaultMaxEgressMbps = 150;
        /// <summary>
        /// Commander, 27-11-2026: the Symphony line is 600 Mbit/s and shared with several other servers,
        /// so this server never takes more than 250 Mbit/s. Any setting above it is clamped to it and
        /// "unlimited" (0) is no longer accepted from configuration or the settings table.
        /// </summary>
        public const int HardMaxEgressMbps = 250;

        public static MediaEgressSettings Default { get; } =
            new(DefaultMaxConcurrentDownloads, DefaultQueueWaitSeconds, DefaultMaxEgressMbps);

        /// <summary>Reads <c>Media:*</c> from configuration; absent or invalid keys keep the code defaults.</summary>
        public static MediaEgressSettings FromConfiguration(IConfiguration config)
        {
            var d = Default;
            return new MediaEgressSettings(
                ClampSlots(config.GetValue<int?>("Media:MaxConcurrentDownloads")) ?? d.MaxConcurrentDownloads,
                ClampWait(config.GetValue<int?>("Media:QueueWaitSeconds")) ?? d.QueueWaitSeconds,
                ClampMbps(config.GetValue<int?>("Media:MaxEgressMbps")) ?? d.MaxEgressMbps);
        }

        /// <summary>Applies the operator's overrides (raw strings from the settings table) on top of <paramref name="baseline"/>.
        /// Null, empty or out-of-range values are ignored, so a typo can never switch the gate off.</summary>
        public static MediaEgressSettings WithOverrides(MediaEgressSettings baseline, string? slots, string? waitSeconds, string? mbps)
            => new(
                ClampSlots(ParseInt(slots)) ?? baseline.MaxConcurrentDownloads,
                ClampWait(ParseInt(waitSeconds)) ?? baseline.QueueWaitSeconds,
                ClampMbps(ParseInt(mbps)) ?? baseline.MaxEgressMbps);

        private static int? ParseInt(string? raw)
            => int.TryParse((raw ?? string.Empty).Trim(), System.Globalization.NumberStyles.Integer,
                            System.Globalization.CultureInfo.InvariantCulture, out var v) ? v : null;

        // 1..1000 concurrent responses. 0 would wedge every download.
        private static int? ClampSlots(int? v) => v is >= 1 and <= 1000 ? v : null;
        // 0 (reject at once) .. 90 s (Cloudflare 524s a response that has not started after 100 s).
        private static int? ClampWait(int? v) => v is >= 0 and <= 90 ? v : null;
        // 1..HardMaxEgressMbps. 0 or negative (= unlimited) is ignored; anything above the hard cap is
        // pulled down to it rather than ignored, so an operator asking for "more" gets the most allowed.
        private static int? ClampMbps(int? v) => v is null or <= 0 ? null : Math.Min(v.Value, HardMaxEgressMbps);
    }

    /// <summary>Point-in-time counters for <c>GET /api/v1/system/egress</c> and the periodic log line.</summary>
    public sealed record MediaEgressSnapshot(
        int InFlight, int Waiting, long Admitted, long Rejected, long BytesSent, long ThrottleWaits,
        MediaEgressSettings Settings, string SettingsSource, DateTime SettingsAppliedUtc);

    /// <summary>
    /// Media egress gate (API 2.8.12). Every byte a screen downloads leaves this server through the
    /// public hostname, so the server's upload rate is the number of screens downloading at once times
    /// their speed. On 26-11-2026 a monthly campaign push (335 screens) held 278 concurrent /media
    /// downloads at 567 Mbit/s for hours and the ISP flagged the line. The gate bounds both factors:
    ///   1. a slot limit: at most <see cref="MediaEgressSettings.MaxConcurrentDownloads"/> responses in
    ///      flight; the rest wait up to <see cref="MediaEgressSettings.QueueWaitSeconds"/> and are then
    ///      refused (the middleware answers 503 + Retry-After; the client retries later)
    ///   2. a shared token bucket: all admitted responses together send at most
    ///      <see cref="MediaEgressSettings.MaxEgressMbps"/> (settings never exceed
    ///      <see cref="MediaEgressSettings.HardMaxEgressMbps"/>; 0 = unlimited exists only for tests)
    /// Singleton; settings can change at runtime via <see cref="Apply"/>.
    /// </summary>
    public sealed class MediaEgressGate : IDisposable
    {
        private const int ChunkBytes = 64 * 1024;                  // throttle granularity

        private readonly object _lock = new();
        private readonly SemaphoreSlim _slots;
        private readonly ByteBucket _bucket;
        private int _slotDebt;              // permits to swallow on Exit after the limit was lowered while busy
        private int _inFlight;
        private int _waiting;
        private long _admitted;
        private long _rejected;
        private long _bytesSent;
        private long _throttleWaits;
        private MediaEgressSettings _settings;
        private string _settingsSource;
        private DateTime _settingsAppliedUtc;

        public MediaEgressGate(MediaEgressSettings? initial = null, string source = "defaults")
        {
            _settings = initial ?? MediaEgressSettings.Default;
            _settingsSource = source;
            _settingsAppliedUtc = DateTime.UtcNow;
            _slots = new SemaphoreSlim(_settings.MaxConcurrentDownloads, int.MaxValue);
            _bucket = new ByteBucket(BytesPerSecond(_settings.MaxEgressMbps), ChunkBytes);
        }

        public MediaEgressSettings Settings => _settings;

        /// <summary>Switches to new settings without disturbing responses in flight: a lower slot limit
        /// first takes back idle permits and swallows the rest as downloads finish; a higher one hands out
        /// permits at once; a new byte rate applies from the next chunk of every stream. No-op when unchanged.</summary>
        public bool Apply(MediaEgressSettings next, string source)
        {
            lock (_lock)
            {
                var changed = next != _settings;
                if (changed)
                {
                    var delta = next.MaxConcurrentDownloads - _settings.MaxConcurrentDownloads;
                    if (delta > 0)
                    {
                        // Pay off any outstanding debt first, then hand out the remainder.
                        var pay = Math.Min(delta, _slotDebt);
                        _slotDebt -= pay;
                        if (delta - pay > 0) _slots.Release(delta - pay);
                    }
                    else if (delta < 0)
                    {
                        // Take back whatever is idle right now (Codex: otherwise 40 idle permits stay
                        // available after "limit = 1"); permits held by downloads in flight are swallowed
                        // one by one as they return.
                        var toRemove = -delta;
                        while (toRemove > 0 && _slots.Wait(0)) toRemove--;
                        _slotDebt += toRemove;
                    }
                    _bucket.SetRate(BytesPerSecond(next.MaxEgressMbps));
                    _settings = next;
                }
                _settingsSource = source;
                _settingsAppliedUtc = DateTime.UtcNow;
                return changed;
            }
        }

        /// <summary>Waits for a slot for up to QueueWaitSeconds. True = admitted (caller MUST call <see cref="Exit"/>).</summary>
        public async Task<bool> TryEnterAsync(CancellationToken ct)
        {
            Interlocked.Increment(ref _waiting);
            try
            {
                var wait = TimeSpan.FromSeconds(_settings.QueueWaitSeconds);
                bool ok;
                try
                {
                    ok = await _slots.WaitAsync(wait, ct).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    // The screen went away while queued: not a rejection, just nothing to serve.
                    return false;
                }
                if (!ok)
                {
                    Interlocked.Increment(ref _rejected);
                    return false;
                }
                Interlocked.Increment(ref _inFlight);
                Interlocked.Increment(ref _admitted);
                return true;
            }
            finally
            {
                Interlocked.Decrement(ref _waiting);
            }
        }

        public void Exit()
        {
            Interlocked.Decrement(ref _inFlight);
            // Debt check and release under the same lock as Apply(): otherwise an Exit that saw no debt
            // could release after a concurrent Apply(2 -> 1) booked the debt, leaving two downloads
            // running under a limit of one (Codex pass 2).
            lock (_lock)
            {
                if (_slotDebt > 0) { _slotDebt--; return; }
                _slots.Release();
            }
        }

        /// <summary>Blocks the caller until <paramref name="bytes"/> may be sent under the shared cap.</summary>
        public async ValueTask AcquireBytesAsync(int bytes, CancellationToken ct)
        {
            // Charged in chunks of at most ChunkBytes so a large request is paced like many small ones
            // (Codex pass 2: the bucket must never be asked for more than one chunk at a time).
            var remaining = bytes;
            while (remaining > 0)
            {
                var n = Math.Min(ChunkBytes, remaining);
                if (!_bucket.TryTakeNow(n))
                {
                    Interlocked.Increment(ref _throttleWaits);
                    await _bucket.TakeAsync(n, ct).ConfigureAwait(false);
                }
                Interlocked.Add(ref _bytesSent, n);
                remaining -= n;
            }
        }

        public MediaEgressSnapshot Snapshot() => new(
            Volatile.Read(ref _inFlight), Volatile.Read(ref _waiting), Interlocked.Read(ref _admitted),
            Interlocked.Read(ref _rejected), Interlocked.Read(ref _bytesSent), Interlocked.Read(ref _throttleWaits),
            _settings, _settingsSource, _settingsAppliedUtc);

        /// <summary>Wraps a response body so every write is paced by this gate.</summary>
        public Stream Throttle(Stream inner, CancellationToken ct) => new ThrottledStream(inner, this, ct);

        private static double BytesPerSecond(int mbps) => mbps <= 0 ? 0 : mbps * 1_000_000.0 / 8;

        public void Dispose()
        {
            _slots.Dispose();
            _bucket.Dispose();
        }

        /// <summary>
        /// One token bucket shared by every gated response. Tokens are bytes; the rate can change at any
        /// time and applies from the next grant (no second limiter, nothing to retire or dispose while a
        /// writer waits: Codex on the first cut). Waiters are served strictly in arrival order, so 300
        /// slow streams share the line evenly instead of the newest starving the oldest.
        /// Capacity (burst) is one second of the rate, but at least four chunks, so a single stream on a
        /// tiny cap is still granted whole chunks and the sustained rate stays exactly the configured one.
        /// </summary>
        internal sealed class ByteBucket : IDisposable
        {
            private readonly object _lock = new();
            private readonly Queue<Waiter> _queue = new();
            private readonly Timer _timer;
            private readonly int _chunk;
            private double _rate;        // bytes per second; 0 = unlimited
            private double _capacity;    // max tokens
            private double _tokens;
            private long _lastTicks;     // Stopwatch ticks of the last refill
            private bool _disposed;

            private sealed class Waiter
            {
                public int Bytes;
                public TaskCompletionSource<bool> Tcs = new(TaskCreationOptions.RunContinuationsAsynchronously);
                public CancellationTokenRegistration Reg;
            }

            public ByteBucket(double bytesPerSecond, int chunk)
            {
                _chunk = chunk;
                _timer = new Timer(_ => Pump(), null, Timeout.Infinite, Timeout.Infinite);
                _lastTicks = System.Diagnostics.Stopwatch.GetTimestamp();
                SetRate(bytesPerSecond);
            }

            public void SetRate(double bytesPerSecond)
            {
                lock (_lock)
                {
                    Refill();
                    _rate = Math.Max(0, bytesPerSecond);
                    _capacity = Math.Max(4.0 * _chunk, _rate);   // one second of burst, at least 4 chunks
                    _tokens = Math.Min(_tokens, _capacity);
                    if (_rate <= 0) _tokens = _capacity;
                }
                Pump();
            }

            /// <summary>Non-blocking: true when the bytes were granted at once (queue empty and tokens available).</summary>
            public bool TryTakeNow(int bytes)
            {
                lock (_lock)
                {
                    if (_rate <= 0) return true;
                    Refill();
                    if (_queue.Count == 0 && _tokens >= bytes)
                    {
                        _tokens -= bytes;
                        return true;
                    }
                    return false;
                }
            }

            public Task TakeAsync(int bytes, CancellationToken ct)
            {
                if (bytes <= 0 || bytes > _chunk) throw new ArgumentOutOfRangeException(nameof(bytes), bytes, $"1..{_chunk} bytes per take");
                var w = new Waiter { Bytes = bytes };
                lock (_lock)
                {
                    if (_disposed) return Task.CompletedTask;
                    if (_rate <= 0) return Task.CompletedTask;
                    _queue.Enqueue(w);
                }
                if (ct.CanBeCanceled)
                {
                    w.Reg = ct.Register(static state =>
                    {
                        // Leave the entry in the queue; Pump skips completed waiters. The bytes are
                        // not charged because nothing will be sent.
                        ((Waiter)state!).Tcs.TrySetCanceled();
                    }, w);
                }
                Pump();
                return w.Tcs.Task;
            }

            private void Refill()
            {
                var now = System.Diagnostics.Stopwatch.GetTimestamp();
                var elapsed = (now - _lastTicks) / (double)System.Diagnostics.Stopwatch.Frequency;
                _lastTicks = now;
                if (_rate <= 0) { _tokens = _capacity; return; }
                _tokens = Math.Min(_capacity, _tokens + elapsed * _rate);
            }

            /// <summary>Grants queued waiters in order while tokens last; if the head still cannot be served,
            /// arms the timer for the moment it can. Runs from TakeAsync, SetRate and the timer itself; any
            /// extra run is harmless (Change() simply re-arms), so no "armed" bookkeeping is needed.</summary>
            private void Pump()
            {
                List<Waiter>? granted = null;
                lock (_lock)
                {
                    if (_disposed) return;
                    Refill();
                    while (_queue.Count > 0)
                    {
                        var head = _queue.Peek();
                        if (head.Tcs.Task.IsCompleted) { _queue.Dequeue(); head.Reg.Dispose(); continue; }   // cancelled while queued
                        if (_rate > 0 && _tokens < head.Bytes) break;
                        if (_rate > 0) _tokens -= head.Bytes;
                        _queue.Dequeue();
                        (granted ??= new List<Waiter>()).Add(head);
                    }
                    if (_queue.Count > 0)
                    {
                        var need = _queue.Peek().Bytes - _tokens;
                        var ms = (int)Math.Clamp(Math.Ceiling(need / _rate * 1000.0), 1, 1000);
                        _timer.Change(ms, Timeout.Infinite);
                    }
                }
                if (granted == null) return;
                foreach (var w in granted)
                {
                    w.Reg.Dispose();
                    w.Tcs.TrySetResult(true);
                }
            }

            public void Dispose()
            {
                Waiter[] pending;
                lock (_lock)
                {
                    _disposed = true;
                    pending = _queue.ToArray();
                    _queue.Clear();
                }
                _timer.Dispose();
                foreach (var w in pending) { w.Reg.Dispose(); w.Tcs.TrySetResult(true); }
            }
        }

        /// <summary>
        /// Write-only pass-through that hands the gate at most 64 KB at a time. Replacing
        /// <c>HttpResponse.Body</c> with it makes the static file middleware copy the file through here
        /// (Kestrel's zero-copy SendFile is bypassed for gated paths; that is the point).
        /// </summary>
        private sealed class ThrottledStream : Stream
        {
            private readonly Stream _inner;
            private readonly MediaEgressGate _gate;
            private readonly CancellationToken _ct;

            public ThrottledStream(Stream inner, MediaEgressGate gate, CancellationToken ct)
            {
                _inner = inner; _gate = gate; _ct = ct;
            }

            public override bool CanRead => false;
            public override bool CanSeek => false;
            public override bool CanWrite => true;
            public override long Length => throw new NotSupportedException();
            public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

            public override void Flush() => _inner.Flush();
            public override Task FlushAsync(CancellationToken cancellationToken) => _inner.FlushAsync(cancellationToken);
            public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
            public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
            public override void SetLength(long value) => throw new NotSupportedException();

            public override void Write(byte[] buffer, int offset, int count)
                => WriteAsync(new ReadOnlyMemory<byte>(buffer, offset, count), CancellationToken.None).AsTask().GetAwaiter().GetResult();

            public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
                => WriteAsync(new ReadOnlyMemory<byte>(buffer, offset, count), cancellationToken).AsTask();

            public override async ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default)
            {
                using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, _ct);
                var ct = linked.Token;
                while (buffer.Length > 0)
                {
                    var n = Math.Min(ChunkBytes, buffer.Length);
                    await _gate.AcquireBytesAsync(n, ct).ConfigureAwait(false);
                    await _inner.WriteAsync(buffer.Slice(0, n), ct).ConfigureAwait(false);
                    buffer = buffer.Slice(n);
                }
            }

            protected override void Dispose(bool disposing) { /* the response body is owned by the server */ }
            public override ValueTask DisposeAsync() => ValueTask.CompletedTask;
        }
    }
}
