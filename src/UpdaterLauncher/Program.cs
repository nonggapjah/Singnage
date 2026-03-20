using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;

namespace UpdaterLauncher
{
    class Program
    {
        static async Task Main(string[] args)
        {
            // NEW LOGIC (v3): Download, Kill, Install, and then RE-START the app automatically.

            string installerUrl = "https://signage.aith123.com/setup/Signage_Unicorn_Setup_2.3.7.exe";
            string tempInstallerFile = Path.Combine(Path.GetTempPath(), "SignageUnicornSetup_Final.exe");

            try
            {
                // 1. Download (Safe v2 logic)
                using (HttpClient client = new HttpClient())
                {
                    client.Timeout = TimeSpan.FromHours(2);
                    using (var response = await client.GetAsync(installerUrl, HttpCompletionOption.ResponseHeadersRead))
                    {
                        response.EnsureSuccessStatusCode();
                        using (var stream = await response.Content.ReadAsStreamAsync())
                        using (var fileStream = new FileStream(tempInstallerFile, FileMode.Create, FileAccess.Write, FileShare.None))
                        {
                            await stream.CopyToAsync(fileStream);
                        }
                    }
                }

                // 2. Kill app
                try {
                    Process[] processes = Process.GetProcessesByName("Signage Unicorn");
                    foreach (Process p in processes) { p.Kill(); }
                    Thread.Sleep(2000); 
                } catch { }

                // 3. Run the installer AND WAIT for it to finish
                Process installerProcess = Process.Start(tempInstallerFile, "/S");
                if (installerProcess != null) {
                    installerProcess.WaitForExit(300000); // Wait up to 5 minutes for install
                }

                // 4. FIND AND RESTART THE APP!
                string[] possiblePaths = {
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\signage-unicorn-client\Signage Unicorn.exe"),
                    @"C:\Users\" + Environment.UserName + @"\AppData\Local\Programs\signage-unicorn-client\Signage Unicorn.exe"
                };

                foreach (string path in possiblePaths) {
                    if (File.Exists(path)) {
                        Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
                        break; 
                    }
                }
            }
            catch (Exception ex)
            {
                File.WriteAllText(Path.Combine(Path.GetTempPath(), "UpdaterLauncher_Error.txt"), ex.ToString());
            }
        }
    }
}
