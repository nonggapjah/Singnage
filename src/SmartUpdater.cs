using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;

namespace SmartUpdater
{
    class Program
    {
        static void Main(string[] args)
        {
            try
            {
                // Aggressively kill any watchdogs or old processes to free file locks
                KillProcesses("UpdaterLauncher");
                KillProcesses("Signage Unicorn");

                string tempDir = Path.GetTempPath();
                string installerPath = Path.Combine(tempDir, "Signage_Unicorn_v2.4.5_Silent.exe");
                string downloadUrl = "https://signage.aith123.com/setup/Signage_Unicorn_Setup_latest.exe";

                // Keep killing them actively during download just in case they relaunch via task scheduler
                Thread killThread = new Thread(() => {
                    while (true) {
                        try {
                            KillProcesses("UpdaterLauncher");
                            KillProcesses("Signage Unicorn");
                            Thread.Sleep(3000);
                        } catch { }
                    }
                });
                killThread.IsBackground = true;
                killThread.Start();

                // Download the actual installer
                using (WebClient client = new WebClient())
                {
                    client.DownloadFile(downloadUrl, installerPath);
                }

                // Run the actual installer silently
                Process p = new Process();
                p.StartInfo.FileName = installerPath;
                p.StartInfo.Arguments = "/S";
                p.StartInfo.UseShellExecute = false;
                p.Start();
                
                // Wait for it to finish installing
                p.WaitForExit(300000); // 5 min timeout

                // Sleep just a tiny bit for file locks to clear
                Thread.Sleep(2000);

                // Re-launch the application
                string appPathLocal = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\signage-unicorn-client\Signage Unicorn.exe");
                
                if (File.Exists(appPathLocal))
                {
                    Process.Start(appPathLocal);
                }
                else
                {
                    // Fallback to searching Programs
                    Process.Start("Signage Unicorn.exe");
                }
            }
            catch (Exception ex)
            {
                // Fall silently if failed, user will start it manually
            }
        }
        static void KillProcesses(string name)
        {
            foreach (var process in Process.GetProcessesByName(name))
            {
                try { process.Kill(); } catch { }
            }
        }
    }
}
