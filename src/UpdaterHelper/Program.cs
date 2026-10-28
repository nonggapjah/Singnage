// UpdaterHelper -- the single update coordinator for Signage Unicorn kiosks. CANONICAL copy.
//
// src/SmartUpdater.cs and src/UpdaterLauncher/Program.cs carry the same algorithm (only the
// namespace differs) so the already-deployed helper binaries can be rebuilt from any of the
// three. Change THIS file first, then copy the body to the other two.
//
// Usage:
//   UpdaterHelper.exe --server https://signage.aith123.com
//       reads LatestClientVersion / ClientDownloadUrl / ClientDownloadSha256 from the API
//   UpdaterHelper.exe --url https://host/setup/Signage_Unicorn_Setup_2.8.0.exe --version 2.8.0 [--sha256 <hex>]
//   optional: --log <path>   --no-restart   --allow-insecure (UNSAFE: permits http URLs on an isolated test network)
//
// Sequence: download (TLS validated, player keeps running) -> verify SHA-256 -> write update.lock
// -> stop player -> run installer /S, wait, check exit code -> verify installed exe + FileVersion
// -> start player -> remove lock. Any failure after the player was stopped restarts the previous
// installation and removes the lock.
// Exit codes: 0 ok, 1 bad arguments/settings, 2 download or hash failure (player untouched),
//             3 install failure (rolled back), 4 rollback failed.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace UpdaterHelper
{
    static class Program
    {
        const string ProcessName = "Signage Unicorn";
        static string logFile = Path.Combine(Path.GetTempPath(), "UpdaterHelper.log");

        static readonly string[] InstallPaths =
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Signage Unicorn", "Signage Unicorn.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "signage-unicorn-client", "Signage Unicorn.exe"),
        };

        // Electron userData = %APPDATA%\<app name>; both names the client has shipped under.
        static readonly string[] UserDataDirs =
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "signage-unicorn-client"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Signage Unicorn"),
        };

        // Redirects are followed MANUALLY so the https rule applies to every hop (round 3 / Codex #5),
        // and every request carries its own overall deadline token: HttpClient.Timeout stops covering
        // the body once headers arrived with ResponseHeadersRead (Codex #15).
        static readonly HttpClient Http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = Timeout.InfiniteTimeSpan };
        const int MaxRedirects = 5;
        static readonly TimeSpan SettingDeadline = TimeSpan.FromSeconds(30);
        static readonly TimeSpan DownloadDeadline = TimeSpan.FromMinutes(15);
        static readonly TimeSpan ReadInactivity = TimeSpan.FromSeconds(60);

        static void Log(string message)
        {
            var line = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {message}";
            Console.WriteLine(line);
            try { File.AppendAllText(logFile, line + Environment.NewLine); } catch { }
        }

        static int Main(string[] args)
        {
            try
            {
                return Run(args).GetAwaiter().GetResult();
            }
            catch (Exception ex)
            {
                Log("FATAL: " + ex);
                return 4;
            }
        }

        static async Task<int> Run(string[] args)
        {
            var opts = ParseArgs(args);
            if (opts.TryGetValue("log", out var customLog) && !string.IsNullOrWhiteSpace(customLog)) logFile = customLog;
            Log("=== Signage Unicorn Updater starting: " + string.Join(" ", args) + " ===");

            string? url = opts.GetValueOrDefault("url");
            string? version = opts.GetValueOrDefault("version");
            string? sha256 = opts.GetValueOrDefault("sha256");
            string? server = opts.GetValueOrDefault("server");
            // Contract T13 (Codex 12): installer bytes and the metadata naming them travel over TLS only
            // (plain http is accepted for loopback). --allow-insecure is the documented UNSAFE escape
            // hatch for an isolated test network.
            bool allowInsecure = opts.ContainsKey("allow-insecure");

            if (!string.IsNullOrWhiteSpace(server))
            {
                server = server.TrimEnd('/');
                if (!IsAllowedUpdateUrl(server, allowInsecure, out var serverReason))
                {
                    Log("ERROR: " + serverReason + " (--server). Use --allow-insecure only on an isolated test network.");
                    return 1;
                }
                url ??= await ReadSetting(server, "ClientDownloadUrl", allowInsecure);
                version ??= await ReadSetting(server, "LatestClientVersion", allowInsecure);
                sha256 ??= await ReadSetting(server, "ClientDownloadSha256", allowInsecure);
                if (url != null && !url.StartsWith("http", StringComparison.OrdinalIgnoreCase))
                    url = server + (url.StartsWith("/") ? url : "/" + url);
            }

            if (string.IsNullOrWhiteSpace(url) || string.IsNullOrWhiteSpace(version))
            {
                Log("ERROR: need --server <baseUrl> or --url <installer url> --version <x.y.z>");
                return 1;
            }
            if (!IsAllowedUpdateUrl(url, allowInsecure, out var urlReason))
            {
                Log("ERROR: " + urlReason + " (installer URL).");
                return 1;
            }
            if (!string.IsNullOrEmpty(urlReason)) Log("WARN: " + urlReason);
            sha256 = string.IsNullOrWhiteSpace(sha256) ? null : sha256.Trim().ToLowerInvariant();
            if (sha256 == null)
                Log("WARN: unverified installer (no ClientDownloadSha256 provided). Proceeding only because the download is TLS-validated.");

            string installer = Path.Combine(Path.GetTempPath(), $"Signage_Unicorn_Setup_{SafeFileName(version)}_{DateTime.UtcNow:yyyyMMddHHmmss}.exe");

            // 1. Download while the player keeps running.
            try
            {
                Log($"Downloading {url} -> {installer}");
                await Download(url, installer, allowInsecure);
            }
            catch (Exception ex)
            {
                Log($"ERROR: download failed: {ex.Message}. Player untouched.");
                TryDelete(installer);
                return 2;
            }

            // 2. Verify.
            string actual = ComputeSha256(installer);
            Log($"Installer SHA-256: {actual}");
            if (sha256 != null && !string.Equals(actual, sha256, StringComparison.OrdinalIgnoreCase))
            {
                Log($"ERROR: SHA-256 mismatch (expected {sha256}). Installer deleted; player untouched.");
                TryDelete(installer);
                return 2;
            }

            // 3. Lock, 4. stop, 5. install, 6. verify, 7. start.
            string? previousExe = InstallPaths.FirstOrDefault(File.Exists);
            WriteLock(version);
            bool playerStopped = false;
            try
            {
                Log("Stopping player...");
                StopPlayer();
                playerStopped = true;

                int code = RunInstaller(installer);
                if (code != 0) throw new Exception($"installer exited with code {code}");

                string? installed = await WaitForInstalledExe(version, TimeSpan.FromMinutes(2));
                if (installed == null) throw new Exception("installed executable not found, or its FileVersion does not match " + version);

                if (!opts.ContainsKey("no-restart")) StartPlayer(installed);
                Log($"SUCCESS: update to {version} complete ({installed}).");
                RemoveLock();
                TryDelete(installer);
                return 0;
            }
            catch (Exception ex)
            {
                Log($"ERROR: {ex.Message}. Rolling back.");
                RemoveLock();
                TryDelete(installer);
                if (!playerStopped) return 3;

                string? exe = previousExe ?? InstallPaths.FirstOrDefault(File.Exists);
                if (exe == null)
                {
                    Log("Rollback FAILED: no player executable found.");
                    return 4;
                }
                try
                {
                    StartPlayer(exe);
                    Log($"Rollback: restarted {exe}");
                    return 3;
                }
                catch (Exception rx)
                {
                    Log($"Rollback FAILED: {rx.Message}");
                    return 4;
                }
            }
        }

        static Dictionary<string, string> ParseArgs(string[] args)
        {
            var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < args.Length; i++)
            {
                if (!args[i].StartsWith("--")) continue;
                string key = args[i].Substring(2);
                string value = (i + 1 < args.Length && !args[i + 1].StartsWith("--")) ? args[++i] : "true";
                map[key] = value;
            }
            return map;
        }

        // Codex round-4 #1: a host counts as loopback only when it PARSES as a loopback IP address
        // (127.0.0.0/8, ::1) or is exactly "localhost". The former StartsWith("127.") also accepted
        // DNS names such as 127.attacker.example, which bypassed the https rule for installers.
        static bool IsLoopback(string host)
        {
            var h = (host ?? "").Trim().Trim('[', ']').ToLowerInvariant();
            if (h == "localhost") return true;
            return System.Net.IPAddress.TryParse(h, out var ip) && System.Net.IPAddress.IsLoopback(ip);
        }

        // Contract T13 rule for ONE url: https; or plain http to loopback (cannot be intercepted on
        // the wire); or http anywhere only with --allow-insecure. `reason` is non-empty for the
        // UNSAFE acceptance so callers can log a warning.
        static bool IsAllowedUpdateUrl(string url, bool allowInsecure, out string reason)
        {
            reason = "";
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) { reason = "INVALID_UPDATE_URL: not a valid URL: " + url; return false; }
            if (uri.Scheme == Uri.UriSchemeHttps) return true;
            if (uri.Scheme == Uri.UriSchemeHttp)
            {
                if (IsLoopback(uri.Host)) return true;
                if (allowInsecure) { reason = "--allow-insecure set: plain http accepted for " + uri.GetLeftPart(UriPartial.Authority) + " (UNSAFE)"; return true; }
                reason = "INSECURE_UPDATE_URL: plain http is not allowed for updates (" + uri.GetLeftPart(UriPartial.Authority) + ")";
                return false;
            }
            reason = "INVALID_UPDATE_URL: unsupported scheme " + uri.Scheme;
            return false;
        }

        // GET with MANUAL redirect following: every hop must satisfy IsAllowedUpdateUrl (Codex #5), so a
        // https -> http redirect is refused instead of silently followed.
        static async Task<HttpResponseMessage> GetWithPolicyAsync(string url, bool allowInsecure, HttpCompletionOption completion, CancellationToken ct)
        {
            string current = url;
            for (int hop = 0; ; hop++)
            {
                if (!IsAllowedUpdateUrl(current, allowInsecure, out var reason)) throw new InvalidOperationException(reason);
                var response = await Http.GetAsync(current, completion, ct);
                int code = (int)response.StatusCode;
                if (code >= 300 && code < 400 && response.Headers.Location != null)
                {
                    var next = response.Headers.Location.IsAbsoluteUri ? response.Headers.Location : new Uri(new Uri(current), response.Headers.Location);
                    response.Dispose();
                    if (hop + 1 > MaxRedirects) throw new InvalidOperationException("too many redirects");
                    if (!IsAllowedUpdateUrl(next.ToString(), allowInsecure, out var hopReason))
                        throw new InvalidOperationException("refusing redirect hop " + (hop + 1) + " to " + next + ": " + hopReason);
                    Log($"Following redirect {hop + 1}: {next}");
                    current = next.ToString();
                    continue;
                }
                return response;
            }
        }

        static async Task<string?> ReadSetting(string server, string key, bool allowInsecure)
        {
            try
            {
                using var cts = new CancellationTokenSource(SettingDeadline);
                using var res = await GetWithPolicyAsync($"{server}/api/v1/system/settings/{key}", allowInsecure, HttpCompletionOption.ResponseContentRead, cts.Token);
                if (!res.IsSuccessStatusCode) { Log($"Setting {key}: HTTP {(int)res.StatusCode}"); return null; }
                using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(cts.Token));
                if (doc.RootElement.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.String)
                {
                    var value = data.GetString();
                    return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
                }
                return null;
            }
            catch (Exception ex)
            {
                Log($"Setting {key}: {ex.Message}");
                return null;
            }
        }

        static async Task Download(string url, string target, bool allowInsecure)
        {
            // One overall deadline covers headers AND the body copy (Codex #15), plus a per-read
            // inactivity deadline: a body that stalls after the headers used to hang CopyToAsync forever.
            using var overall = new CancellationTokenSource(DownloadDeadline);
            using var response = await GetWithPolicyAsync(url, allowInsecure, HttpCompletionOption.ResponseHeadersRead, overall.Token);
            response.EnsureSuccessStatusCode();
            Log($"Response received. Content size: {response.Content.Headers.ContentLength?.ToString() ?? "unknown"} bytes.");
            using var body = await response.Content.ReadAsStreamAsync(overall.Token);
            using var fileStream = new FileStream(target, FileMode.Create, FileAccess.Write, FileShare.None);
            var buffer = new byte[81920];
            long total = 0;
            while (true)
            {
                using var readCts = CancellationTokenSource.CreateLinkedTokenSource(overall.Token);
                readCts.CancelAfter(ReadInactivity);
                int n;
                try
                {
                    n = await body.ReadAsync(buffer, 0, buffer.Length, readCts.Token);
                }
                catch (OperationCanceledException) when (!overall.IsCancellationRequested)
                {
                    throw new TimeoutException($"download stalled: no data for {ReadInactivity.TotalSeconds:0} s");
                }
                if (n <= 0) break;
                await fileStream.WriteAsync(buffer, 0, n, overall.Token);
                total += n;
            }
            Log($"Download completed ({total} bytes).");
        }

        static string ComputeSha256(string file)
        {
            using var sha = SHA256.Create();
            using var stream = File.OpenRead(file);
            return Convert.ToHexString(sha.ComputeHash(stream)).ToLowerInvariant();
        }

        static IEnumerable<string> LockPaths()
        {
            var existing = UserDataDirs.Where(Directory.Exists).ToList();
            if (existing.Count == 0)
            {
                Directory.CreateDirectory(UserDataDirs[0]);
                existing.Add(UserDataDirs[0]);
            }
            return existing.Select(d => Path.Combine(d, "update.lock"));
        }

        static void WriteLock(string version)
        {
            var payload = JsonSerializer.Serialize(new { version, startedAt = DateTime.UtcNow.ToString("o"), source = "UpdaterHelper", pid = Environment.ProcessId });
            foreach (var p in LockPaths())
            {
                try { File.WriteAllText(p, payload); } catch (Exception ex) { Log($"WARN: could not write {p}: {ex.Message}"); }
            }
        }

        static void RemoveLock()
        {
            foreach (var p in LockPaths())
            {
                try { if (File.Exists(p)) File.Delete(p); } catch (Exception ex) { Log($"WARN: could not remove {p}: {ex.Message}"); }
            }
        }

        static void StopPlayer()
        {
            foreach (var process in Process.GetProcessesByName(ProcessName))
            {
                try
                {
                    Log($"Stopping process {process.ProcessName} (PID {process.Id})");
                    process.Kill(true);
                    process.WaitForExit(15000);
                }
                catch (Exception ex)
                {
                    Log($"WARN: could not stop PID {process.Id}: {ex.Message}");
                }
            }
            System.Threading.Thread.Sleep(2000); // let file locks clear
        }

        static int RunInstaller(string installer)
        {
            Log("Running installer silently...");
            var psi = new ProcessStartInfo
            {
                FileName = installer,
                Arguments = "/S",
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            using var process = Process.Start(psi) ?? throw new Exception("failed to launch installer process");
            if (!process.WaitForExit((int)TimeSpan.FromMinutes(10).TotalMilliseconds))
            {
                try { process.Kill(true); } catch { }
                throw new Exception("installer did not finish within 10 minutes");
            }
            Log($"Installer exited with code {process.ExitCode}");
            return process.ExitCode;
        }

        // NSIS can hand off to a child process, so the exit code alone is not proof: poll until the
        // installed executable exists and (when readable) reports the target version.
        static async Task<string?> WaitForInstalledExe(string version, TimeSpan timeout)
        {
            var deadline = DateTime.UtcNow + timeout;
            string? lastSeen = null;
            while (DateTime.UtcNow < deadline)
            {
                foreach (var path in InstallPaths)
                {
                    if (!File.Exists(path)) continue;
                    lastSeen = path;
                    try
                    {
                        var info = FileVersionInfo.GetVersionInfo(path);
                        var fileVersion = info.FileVersion ?? info.ProductVersion;
                        if (string.IsNullOrWhiteSpace(fileVersion))
                        {
                            Log($"Installed exe found ({path}); version unreadable, accepting.");
                            return path;
                        }
                        if (fileVersion.StartsWith(version, StringComparison.OrdinalIgnoreCase))
                        {
                            Log($"Installed exe verified: {path} FileVersion={fileVersion}");
                            return path;
                        }
                        Log($"Installed exe at {path} reports {fileVersion}, waiting for {version}...");
                    }
                    catch (Exception ex)
                    {
                        Log($"Version check pending ({ex.Message})");
                    }
                }
                await Task.Delay(3000);
            }
            if (lastSeen != null) Log($"Timed out waiting for {lastSeen} to report version {version}.");
            return null;
        }

        static void StartPlayer(string path)
        {
            Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
            Log($"Started {path}");
        }

        static void TryDelete(string file)
        {
            try { if (File.Exists(file)) File.Delete(file); } catch { }
        }

        static string SafeFileName(string value)
        {
            var invalid = Path.GetInvalidFileNameChars();
            return new string(value.Select(c => invalid.Contains(c) ? '_' : c).ToArray());
        }
    }
}
