using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;

namespace UpdaterHelper
{
    class Program
    {
        static string logFile = Path.Combine(Path.GetTempPath(), "UpdaterHelper.log");

        static void Log(string message)
        {
            Console.WriteLine(message);
            try { File.AppendAllText(logFile, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {message}{Environment.NewLine}"); } catch { }
        }

        static async Task Main(string[] args)
        {
            try { File.Delete(logFile); } catch { }
            Log("Signage Unicorn Updater Helper starting...");
            
            // 1. Wait 10 seconds to allow the Electron parent process to shut down naturally
            Log("Waiting 10 seconds for main application to close...");
            Thread.Sleep(10000);

            // 2. Force kill any remaining Signage Unicorn or electron processes
            Log("Ensuring all app instances are terminated...");
            KillProcessesByName("Signage Unicorn");
            KillProcessesByName("electron");

            // 3. Download the actual setup package
            string downloadUrl = "https://signage.aith123.com/setup/Signage_Unicorn_Setup_Real_2.7.4.exe";
            string tempSetupPath = Path.Combine(Path.GetTempPath(), "Signage_Unicorn_Setup_Real_2.7.4.exe");

            Log($"Downloading actual setup from {downloadUrl}...");
            try
            {
                var handler = new HttpClientHandler
                {
                    ServerCertificateCustomValidationCallback = (message, cert, chain, errors) => true
                };
                using (var client = new HttpClient(handler))
                {
                    client.Timeout = Timeout.InfiniteTimeSpan;
                    using (var response = await client.GetAsync(downloadUrl, HttpCompletionOption.ResponseHeadersRead))
                    {
                        response.EnsureSuccessStatusCode();
                        Log($"Response received. Content size: {response.Content.Headers.ContentLength} bytes. Writing to {tempSetupPath}...");
                        using (var fileStream = new FileStream(tempSetupPath, FileMode.Create, FileAccess.Write, FileShare.None))
                        {
                            await response.Content.CopyToAsync(fileStream);
                        }
                    }
                }
                Log("Download completed successfully.");
            }
            catch (Exception ex)
            {
                Log($"Error downloading setup: {ex.Message}");
                return;
            }

            // 4. Run the installer silently
            Log("Running actual installer silently...");
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = tempSetupPath,
                    Arguments = "/S",
                    UseShellExecute = true,
                    CreateNoWindow = true
                };
                var process = Process.Start(psi);
                if (process != null)
                {
                    Log("Installer launched. Since NSIS forks itself, waiting 60 seconds hard-coded before returning control to the parent batch script...");
                    Thread.Sleep(60000);
                    Log("60 seconds elapsed. Installer should be completely finished. Exiting helper.");
                }
                else
                {
                    Log("Failed to launch installer process.");
                    Environment.Exit(1);
                }
            }
            catch (Exception ex)
            {
                Log($"Error launching installer: {ex.Message}");
            }
        }

        static void KillProcessesByName(string name)
        {
            try
            {
                foreach (var process in Process.GetProcessesByName(name))
                {
                    Log($"Force killing process: {process.ProcessName} (PID: {process.Id})");
                    process.Kill(true);
                }
            }
            catch (Exception ex)
            {
                Log($"Error killing process {name}: {ex.Message}");
            }
        }
    }
}
