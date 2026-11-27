using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using SignageUnicorn.Api.Services.Media;

namespace SignageUnicorn.Api.Services.Background
{
    /// <summary>
    /// Runs the media integrity check at start-up (after the schema apply) and every
    /// <c>Media:IntegrityCheckMinutes</c> (default 360), and the loop detector every minute.
    /// See <see cref="MediaIntegrityService"/> for what each pass does.
    /// </summary>
    public sealed class MediaIntegrityWorker : BackgroundService
    {
        private static readonly TimeSpan StartupDelay = TimeSpan.FromSeconds(45);
        private static readonly TimeSpan LoopTick = TimeSpan.FromMinutes(1);
        private static readonly TimeSpan LiveCountTtl = TimeSpan.FromMinutes(10);

        private readonly IServiceProvider _services;
        private readonly IConfiguration _configuration;
        private readonly ILogger<MediaIntegrityWorker> _logger;

        public MediaIntegrityWorker(IServiceProvider services, IConfiguration configuration, ILogger<MediaIntegrityWorker> logger)
        {
            _services = services; _configuration = configuration; _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            var minutes = Math.Clamp(_configuration.GetValue<int?>("Media:IntegrityCheckMinutes") ?? 360, 15, 24 * 60);
            var interval = TimeSpan.FromMinutes(minutes);
            _logger.LogInformation("[MediaIntegrity] worker started: full check at start and every {Minutes} min, loop detector every minute.", minutes);
            try { await Task.Delay(StartupDelay, stoppingToken); } catch (OperationCanceledException) { return; }

            var nextFull = DateTime.UtcNow;
            var loaded = false;
            var liveScreens = 0; var liveAt = DateTime.MinValue;
            while (!stoppingToken.IsCancellationRequested)
            {
                // Stored verdicts take effect before the first (slow) file pass; retried every tick until
                // migration 012 is there (Codex: a failure must not wait for the next interval).
                if (!loaded)
                    loaded = await Guarded(async svc => await svc.LoadAsync(), "load", stoppingToken);

                if (loaded && DateTime.UtcNow >= nextFull)
                {
                    var rowErrors = 0;
                    var done = await Guarded(async svc => { var (ok, bad, errors) = await svc.RunAsync(stoppingToken); rowErrors = errors; }, "full check", stoppingToken);
                    // A pass that threw, or that could not check some rows, is repeated after a minute (Codex).
                    nextFull = done && rowErrors == 0 ? DateTime.UtcNow + interval : DateTime.UtcNow + LoopTick;
                    if (done && rowErrors > 0) _logger.LogWarning("[MediaIntegrity] {Count} row(s) could not be checked; full check repeats in a minute.", rowErrors);
                }
                if (loaded)
                {
                    await Guarded(async svc => { var n = await svc.RunPendingAsync(stoppingToken); if (n > 0) _logger.LogInformation("[MediaIntegrity] {Count} freshly written media re-checked.", n); }, "re-check", stoppingToken);
                    await Guarded(async svc =>
                    {
                        if (DateTime.UtcNow - liveAt > LiveCountTtl) { liveScreens = await svc.LiveScreensAsync(); liveAt = DateTime.UtcNow; }
                        var tripped = await svc.EvaluateLoopsAsync(liveScreens, stoppingToken);
                        if (tripped > 0) _logger.LogError("[MediaIntegrity] loop detector quarantined {Count} file(s).", tripped);
                    }, "loop detector", stoppingToken);
                }

                try { await Task.Delay(LoopTick, stoppingToken); } catch (OperationCanceledException) { break; }
            }
        }

        private async Task<bool> Guarded(Func<MediaIntegrityService, Task> action, string what, CancellationToken ct)
        {
            try
            {
                using var scope = _services.CreateScope();
                await action(scope.ServiceProvider.GetRequiredService<MediaIntegrityService>());
                return true;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch (Exception ex)
            {
                // Typically migration 012 not applied yet or SQL down; the next tick retries.
                _logger.LogError(ex, "[MediaIntegrity] {What} failed; retrying next tick.", what);
                return false;
            }
        }
    }
}
