using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using System;
using System.Threading;
using System.Threading.Tasks;
using SignageUnicorn.Api.Services;
using SignageUnicorn.Api.Repositories.Interfaces;

namespace SignageUnicorn.Api.Services.Background
{
    public class MaintenanceWorker : BackgroundService
    {
        private readonly IServiceProvider _serviceProvider;
        private readonly ILogger<MaintenanceWorker> _logger;

        public MaintenanceWorker(IServiceProvider serviceProvider, ILogger<MaintenanceWorker> logger)
        {
            _serviceProvider = serviceProvider;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation("Maintenance Worker started.");

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await PerformMaintenanceAsync();
                    
                    // Wait for 24 hours before next run
                    // If you want to run at specific time (e.g. 2 AM), logic needs to be adjustments,
                    // but interval-based 24h is simple and robust for local apps.
                    await Task.Delay(TimeSpan.FromHours(24), stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    // Graceful shutdown
                    break;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error occurred during maintenance task.");
                    
                    // Retry in 1 hour if failed
                    await Task.Delay(TimeSpan.FromHours(1), stoppingToken);
                }
            }
        }

        private async Task PerformMaintenanceAsync()
        {
            using (var scope = _serviceProvider.CreateScope())
            {
                var systemLogRepo = scope.ServiceProvider.GetRequiredService<ISystemLogRepository>();
                var deviceService = scope.ServiceProvider.GetRequiredService<DeviceService>();

                _logger.LogInformation("[Maintenance] Starting Daily Cleanup...");

                // 1. Clear Old System Logs (> 3 Months)
                await systemLogRepo.ClearOldLogsAsync();
                _logger.LogInformation("[Maintenance] Old logs cleared.");

                // 2. Clean up Zombies/Offline Devices (DISABLED - Manual Only per Uni-102)
                // await deviceService.CleanupOfflineDevicesAsync();
                // _logger.LogInformation("[Maintenance] Offline devices cleaned up.");

                _logger.LogInformation("[Maintenance] Cleanup Completed Successfully.");
            }
        }
    }
}
