using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using SignageUnicorn.Api.Services.Rollout;

namespace SignageUnicorn.Api.Services.Background
{
    /// <summary>
    /// Releases the waves of branch-by-branch playlist rollouts (API 2.8.14). Every 30 s it asks
    /// <see cref="RolloutService"/> to assign the screens whose wave time has come; the media egress
    /// gate's queue length decides whether a new branch may start yet. State lives in the rollout
    /// tables, so a restart simply continues.
    /// </summary>
    public sealed class PlaylistRolloutWorker : BackgroundService
    {
        private static readonly TimeSpan Interval = TimeSpan.FromSeconds(30);
        private static readonly TimeSpan StartupDelay = TimeSpan.FromSeconds(10);

        private readonly IServiceProvider _services;
        private readonly MediaEgressGate _gate;
        private readonly ILogger<PlaylistRolloutWorker> _logger;

        public PlaylistRolloutWorker(IServiceProvider services, MediaEgressGate gate, ILogger<PlaylistRolloutWorker> logger)
        {
            _services = services;
            _gate = gate;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation("[Rollout] Playlist rollout worker started (interval {Interval}).", Interval);
            try { await Task.Delay(StartupDelay, stoppingToken); } catch (OperationCanceledException) { return; }

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    using var scope = _services.CreateScope();
                    var service = scope.ServiceProvider.GetRequiredService<RolloutService>();
                    var assigned = await service.RunDuePassAsync(DateTime.UtcNow, _gate.Snapshot().Waiting, stoppingToken);
                    if (assigned > 0) _logger.LogInformation("[Rollout] Pass assigned {Count} screen(s).", assigned);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    // Typically the tables are not there yet (schema apply pending) or SQL is down; the
                    // next pass retries. Items touched before the failure are already marked.
                    _logger.LogError(ex, "[Rollout] Pass failed; retrying next interval.");
                }

                try { await Task.Delay(Interval, stoppingToken); } catch (OperationCanceledException) { break; }
            }
        }
    }
}
