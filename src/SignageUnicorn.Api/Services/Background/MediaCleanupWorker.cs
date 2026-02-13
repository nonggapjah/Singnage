using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Data.SqlClient;
using Dapper;
using Microsoft.Extensions.Configuration;

namespace SignageUnicorn.Api.Services.Background
{
    public class MediaCleanupWorker : BackgroundService
    {
        private readonly ILogger<MediaCleanupWorker> _logger;
        private readonly IServiceProvider _serviceProvider;
        private readonly IConfiguration _configuration;
        private readonly TimeSpan _checkInterval = TimeSpan.FromHours(6); // Run every hour

        public MediaCleanupWorker(ILogger<MediaCleanupWorker> logger, IServiceProvider serviceProvider, IConfiguration configuration)
        {
            _logger = logger;
            _serviceProvider = serviceProvider;
            _configuration = configuration;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation("Media Cleanup Worker started. Interval: {interval}", _checkInterval);

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await PerformCleanupAsync(stoppingToken);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error occurred during Media Cleanup task.");
                }

                // Wait for next cycle
                await Task.Delay(_checkInterval, stoppingToken);
            }

            _logger.LogInformation("Media Cleanup Worker stopping.");
        }

        private async Task PerformCleanupAsync(CancellationToken cancellationToken)
        {
            using (var scope = _serviceProvider.CreateScope())
            {
                var mediaService = scope.ServiceProvider.GetRequiredService<SignageUnicorn.Api.Services.MediaService>();

                _logger.LogInformation("Checking for expired media...");
                
                int count = await mediaService.ProcessExpiredMediaAsync(cancellationToken);

                if (count > 0)
                {
                    _logger.LogInformation("Cleanup Complete. Expired {Count} media items.", count);
                }
                else
                {
                     _logger.LogDebug("No expired media found.");
                }
            }
        }
    }
}
