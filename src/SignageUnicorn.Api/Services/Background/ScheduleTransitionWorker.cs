using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Repositories.Interfaces;

namespace SignageUnicorn.Api.Services.Background
{
    // F17 / contract item 6: a schedule's start or end date was only honoured when a client happened
    // to ask for its schedule (boot, SYNC_SCHEDULE). A campaign set to start at 09:00 did not start
    // until something else poked the screen, and an expired one kept playing. This worker watches
    // the clock server-side and queues one SYNC_SCHEDULE for every device whose assignment crossed a
    // boundary in the last interval. It needs no new client behaviour, so screens still running the
    // old client benefit too.
    //
    // Round 3 (#12 / Codex round-3 finding 12): the window's lower bound is persisted after every
    // pass (sn_system_settings 'ScheduleTransitionCheckpointUtc'), so a boundary crossed while the
    // API was down is still reconciled at the next start instead of being lost. The look-back is
    // capped at 7 days: older transitions are long superseded by later edits/boundaries.
    //
    // Round 5 (Codex round-5 item 4): a device whose SYNC_SCHEDULE could not be queued is never
    // dropped. Its id goes into a durable pending list (sn_system_settings
    // 'ScheduleTransitionPendingDevices'); every pass retries that list first and only then scans
    // the window. The checkpoint advances whenever the SCAN itself succeeded (the window was read
    // and every device in it was attempted): failed enqueues move to the pending list, not back
    // into the window, so one broken device can no longer hold up the whole fleet's boundaries.
    public class ScheduleTransitionWorker : BackgroundService
    {
        public const string CheckpointKey = "ScheduleTransitionCheckpointUtc";
        public const string PendingKey = "ScheduleTransitionPendingDevices";
        internal const int MaxPending = 5000;
        internal static readonly TimeSpan Interval = TimeSpan.FromSeconds(60);
        internal static readonly TimeSpan MaxLookBack = TimeSpan.FromDays(7);
        private static readonly TimeSpan StartupDelay = TimeSpan.FromSeconds(5);

        private readonly IServiceProvider _serviceProvider;
        private readonly ILogger<ScheduleTransitionWorker> _logger;

        // Working copy of the durable pending list; loaded once at start, persisted after every pass
        // that changed it. Memory keeps what a failed persist could not write.
        private List<string> _pending = new();

        public ScheduleTransitionWorker(IServiceProvider serviceProvider, ILogger<ScheduleTransitionWorker> logger)
        {
            _serviceProvider = serviceProvider;
            _logger = logger;
        }

        // Where the first pass after a start begins. Pure so it is unit-testable.
        //   no checkpoint        -> one interval back (first ever run; nothing older is known)
        //   checkpoint in future -> clock went backwards; use now - interval
        //   older than 7 days    -> cap at now - 7 days
        internal static DateTime ComputeStartWindow(string? storedCheckpoint, DateTime nowUtc)
        {
            if (!string.IsNullOrWhiteSpace(storedCheckpoint)
                && DateTime.TryParse(storedCheckpoint, System.Globalization.CultureInfo.InvariantCulture,
                                     System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal,
                                     out var parsed))
            {
                if (parsed > nowUtc) return nowUtc - Interval;
                if (nowUtc - parsed > MaxLookBack) return nowUtc - MaxLookBack;
                return parsed;
            }
            return nowUtc - Interval;
        }

        // Pending-list codec (sn_system_settings value). Anything unreadable counts as empty.
        internal static List<string> ParsePending(string? json)
        {
            if (string.IsNullOrWhiteSpace(json)) return new List<string>();
            try
            {
                var ids = JsonSerializer.Deserialize<List<string>>(json);
                return ids == null ? new List<string>() : Dedupe(ids);
            }
            catch (JsonException)
            {
                return new List<string>();
            }
        }

        internal static string SerializePending(IEnumerable<string> ids) => JsonSerializer.Serialize(Dedupe(ids));

        // Next pending list after a pass: the previous entries minus the ones that succeeded, plus the
        // ones that failed this pass (new or still failing), deduplicated, oldest first, capped so the
        // setting cannot grow without bound. Pure so it is unit-testable.
        internal static List<string> MergePending(IEnumerable<string> previous, IEnumerable<string> succeeded, IEnumerable<string> failed, int cap = MaxPending)
        {
            var ok = new HashSet<string>(succeeded, StringComparer.Ordinal);
            var next = new List<string>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var id in previous.Concat(failed))
            {
                if (string.IsNullOrWhiteSpace(id) || ok.Contains(id)) continue;
                if (seen.Add(id)) next.Add(id);
            }
            if (next.Count > cap) next = next.Take(cap).ToList();
            return next;
        }

        // The checkpoint moves only when the window itself was read and every device in it was
        // attempted; enqueue failures are carried by the pending list instead. Pure for tests.
        internal static bool ShouldAdvance(bool scanSucceeded) => scanSucceeded;

        private static List<string> Dedupe(IEnumerable<string> ids)
        {
            var seen = new HashSet<string>(StringComparer.Ordinal);
            var list = new List<string>();
            foreach (var id in ids)
            {
                if (string.IsNullOrWhiteSpace(id)) continue;
                if (seen.Add(id)) list.Add(id);
            }
            return list;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation("Schedule transition worker started (interval {Interval}).", Interval);

            try { await Task.Delay(StartupDelay, stoppingToken); } catch (OperationCanceledException) { return; }

            var lastCheckUtc = await LoadCheckpointAsync(DateTime.UtcNow);
            if (DateTime.UtcNow - lastCheckUtc > Interval + Interval)
                _logger.LogInformation("[ScheduleTransition] Reconciling boundaries since {Checkpoint:u} (API was down or first run).", lastCheckUtc);

            _pending = await LoadPendingAsync();
            if (_pending.Count > 0)
                _logger.LogInformation("[ScheduleTransition] {Count} device(s) still waiting for a SYNC_SCHEDULE from earlier passes.", _pending.Count);

            while (!stoppingToken.IsCancellationRequested)
            {
                var nowUtc = DateTime.UtcNow;
                try
                {
                    using var scope = _serviceProvider.CreateScope();
                    var devices = scope.ServiceProvider.GetRequiredService<IDeviceRepository>();

                    // 1. Retry everything that failed earlier.
                    var succeeded = new List<string>();
                    foreach (var deviceId in _pending)
                    {
                        if (await TryQueueAsync(devices, deviceId)) succeeded.Add(deviceId);
                    }
                    if (succeeded.Count > 0)
                        _logger.LogInformation("[ScheduleTransition] Delivered {Count} previously failed SYNC_SCHEDULE command(s).", succeeded.Count);

                    // 2. Scan the window. If the query itself fails the window is kept (exception path).
                    var deviceIds = (await devices.GetDevicesWithScheduleTransitionsAsync(lastCheckUtc, nowUtc)).ToList();
                    var failedNow = new List<string>();
                    foreach (var deviceId in deviceIds)
                    {
                        if (!await TryQueueAsync(devices, deviceId)) failedNow.Add(deviceId);
                    }
                    if (deviceIds.Count > 0)
                        _logger.LogInformation("[ScheduleTransition] Queued SYNC_SCHEDULE for {Count} device(s) crossing a schedule boundary ({Failed} deferred to the pending list).", deviceIds.Count - failedNow.Count, failedNow.Count);

                    // 3. Carry failures durably; they never touch the window.
                    var merged = MergePending(_pending, succeeded, failedNow);
                    if (!merged.SequenceEqual(_pending, StringComparer.Ordinal))
                    {
                        _pending = merged;
                        await SavePendingAsync(scope.ServiceProvider, _pending);
                    }
                    if (failedNow.Count > 0)
                        _logger.LogWarning("[ScheduleTransition] {Count} device(s) kept for retry: {Devices}", _pending.Count, string.Join(",", _pending.Take(20)));

                    // 4. The scan completed, so the window is done regardless of per-device failures.
                    if (ShouldAdvance(scanSucceeded: true))
                    {
                        lastCheckUtc = nowUtc;
                        await SaveCheckpointAsync(scope.ServiceProvider, nowUtc);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "[ScheduleTransition] Cycle failed; the same window will be re-checked next interval.");
                }

                try
                {
                    await Task.Delay(Interval, stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }
        }

        private async Task<bool> TryQueueAsync(IDeviceRepository devices, string deviceId)
        {
            RepositoryResult result;
            try
            {
                result = await devices.AddCommandAsync(deviceId, "SYNC_SCHEDULE");
            }
            catch (Exception ex)
            {
                result = RepositoryResult.Fail(500, ex.Message);
            }
            if (!result.Success)
                _logger.LogWarning("[ScheduleTransition] Could not queue SYNC_SCHEDULE for device {DeviceId}: {Message}", deviceId, result.Message);
            return result.Success;
        }

        private async Task<DateTime> LoadCheckpointAsync(DateTime nowUtc)
        {
            try
            {
                using var scope = _serviceProvider.CreateScope();
                var settings = scope.ServiceProvider.GetRequiredService<ISystemSettingsRepository>();
                var stored = await settings.GetSettingAsync(CheckpointKey);
                return ComputeStartWindow(stored, nowUtc);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "[ScheduleTransition] Could not read the checkpoint; starting one interval back.");
                return nowUtc - Interval;
            }
        }

        private async Task<List<string>> LoadPendingAsync()
        {
            try
            {
                using var scope = _serviceProvider.CreateScope();
                var settings = scope.ServiceProvider.GetRequiredService<ISystemSettingsRepository>();
                return ParsePending(await settings.GetSettingAsync(PendingKey));
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "[ScheduleTransition] Could not read the pending list; starting with none.");
                return new List<string>();
            }
        }

        private async Task SaveCheckpointAsync(IServiceProvider scoped, DateTime nowUtc)
        {
            try
            {
                var settings = scoped.GetRequiredService<ISystemSettingsRepository>();
                await settings.SetSettingAsync(CheckpointKey, nowUtc.ToString("o", System.Globalization.CultureInfo.InvariantCulture));
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "[ScheduleTransition] Could not persist the checkpoint.");
            }
        }

        private async Task SavePendingAsync(IServiceProvider scoped, List<string> pending)
        {
            try
            {
                var settings = scoped.GetRequiredService<ISystemSettingsRepository>();
                await settings.SetSettingAsync(PendingKey, SerializePending(pending));
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "[ScheduleTransition] Could not persist the pending list; it is kept in memory for the next pass.");
            }
        }
    }
}
