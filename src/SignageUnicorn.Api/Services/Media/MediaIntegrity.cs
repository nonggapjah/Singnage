using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using SignageUnicorn.Api.Repositories.Interfaces;

namespace SignageUnicorn.Api.Services.Media
{
    /// <summary>
    /// Media integrity (API 2.8.15). Incident 26/27-11-2026: one media row carried a hash that did not
    /// match the file the screens download, so 336 screens downloaded, failed the MD5 check, deleted and
    /// re-downloaded a 42 MB file without end. Three defences live here:
    /// <list type="bullet">
    /// <item>every live media row is compared with its file on disk (exists, size, MD5) at start-up and
    /// periodically; the verdict is stored on the row;</item>
    /// <item>a row that is not <c>ok</c> is <b>quarantined</b>: left out of every device schedule, so no
    /// screen is ever asked to fetch a file it cannot verify;</item>
    /// <item>a loop detector counts admitted downloads per file in a sliding hour; a file fetched far more
    /// often than there are screens is quarantined too, whatever the cause.</item>
    /// </list>
    /// </summary>
    public static class MediaIntegrityVerdict
    {
        public const string Unknown = "unknown";
        public const string Ok = "ok";
        public const string Mismatch = "mismatch";
        public const string Missing = "missing";
        public const string LoopSuspect = "loop-suspect";

        /// <summary>Pure verdict for one row from the disk facts. A row without a stored hash is 'ok' (the client skips the check) but noted.</summary>
        public static (string Status, string Note) Evaluate(string? dbHash, int? dbSizeKb, bool exists, string? diskMd5, long diskBytes)
        {
            if (!exists) return (Missing, "file is not on disk");
            var diskKb = (int)Math.Ceiling(diskBytes / 1024.0);
            if (string.IsNullOrWhiteSpace(dbHash))
                return (Ok, $"no stored hash; disk md5 {diskMd5}, {diskKb} KB (screens cannot verify this file)");
            if (!string.Equals(dbHash.Trim(), diskMd5, StringComparison.OrdinalIgnoreCase))
                return (Mismatch, $"stored hash {Short(dbHash)} / {dbSizeKb} KB but disk md5 {Short(diskMd5)} / {diskKb} KB");
            if (dbSizeKb.HasValue && dbSizeKb.Value > 0 && Math.Abs(dbSizeKb.Value - diskKb) > 1)
                return (Ok, $"hash ok; stored size {dbSizeKb} KB differs from disk {diskKb} KB");
            return (Ok, "");
        }

        /// <summary>
        /// The status to store given what was stored before and what the disk says now. A loop suspect
        /// stays a loop suspect until an admin clears it (Codex: the latch must not depend on the disk
        /// verdict of the moment).
        /// </summary>
        public static (string Status, string Note) Reconcile(string? previousStatus, string? previousNote, string diskStatus, string diskNote)
        {
            if (previousStatus == LoopSuspect)
                return (LoopSuspect, $"{previousNote ?? "loop suspect"} (now: {diskStatus}{(diskNote.Length > 0 ? ", " + diskNote : "")}; cleared only by an admin)");
            return (diskStatus, diskNote);
        }

        /// <summary>The stored file name the screens fetch: the last path segment of blob_url.</summary>
        public static string? StoredName(string? blobUrl)
        {
            if (string.IsNullOrWhiteSpace(blobUrl)) return null;
            var s = blobUrl.Split('?')[0].Split('#')[0];
            var name = s.Split('/', '\\').LastOrDefault();
            return string.IsNullOrWhiteSpace(name) ? null : Uri.UnescapeDataString(name);
        }

        /// <summary>
        /// True when the url names a file this API serves from wwwroot/media: a relative "/media/…" or an
        /// absolute url whose host is one of ours. "https://other.example/media/x.mp4" is external
        /// (Codex: the path alone is not enough).
        /// </summary>
        public static bool IsLocalMediaUrl(string? url, IEnumerable<string>? localHosts)
        {
            if (string.IsNullOrWhiteSpace(url)) return false;
            var u = url.Trim();
            if (u.StartsWith("/media/", StringComparison.OrdinalIgnoreCase)) return true;
            if (!Uri.TryCreate(u, UriKind.Absolute, out var abs)) return false;
            if (!abs.AbsolutePath.StartsWith("/media/", StringComparison.OrdinalIgnoreCase)) return false;
            var host = abs.Host;
            if (host.Equals("localhost", StringComparison.OrdinalIgnoreCase) || host == "127.0.0.1" || host == "::1") return true;
            return localHosts != null && localHosts.Any(h => !string.IsNullOrWhiteSpace(h) && host.Equals(h.Trim(), StringComparison.OrdinalIgnoreCase));
        }

        /// <summary>A stored verdict counts only for the file it was made for: <paramref name="verdictFile"/> (integrity_file)
        /// must equal the stored name of the row's current blob_url. A verdict without a file name is treated as stale.</summary>
        public static bool VerdictIsForFile(string? verdictFile, string? blobUrl)
        {
            if (string.IsNullOrEmpty(verdictFile)) return false;
            var current = StoredName(blobUrl);
            return current != null && string.Equals(current, verdictFile, StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>Downloads of one file per hour above which the file is a loop suspect: 3 fetches per live screen, never below 1500.</summary>
        public static int LoopThreshold(int liveScreens) => Math.Max(1500, 3 * Math.Max(0, liveScreens));

        private static string Short(string? h) => string.IsNullOrEmpty(h) ? "-" : (h.Length > 8 ? h.Substring(0, 8) : h);
    }

    /// <summary>Row as read for the check (Dapper maps by column name).</summary>
    public class MediaIntegrityRow
    {
        public long media_id { get; set; }
        public string media_uuid { get; set; } = string.Empty;
        public string? display_name { get; set; }
        public string? blob_url { get; set; }
        public string? file_hash { get; set; }
        public int? file_size_kb { get; set; }
        public string? integrity_status { get; set; }
        public DateTime? integrity_checked_at { get; set; }
        public string? integrity_note { get; set; }
        public string? integrity_file { get; set; }
        /// <summary>The stored verdict is about the row's current file (otherwise it is stale: the media was replaced).</summary>
        public bool VerdictIsCurrent => MediaIntegrityVerdict.VerdictIsForFile(integrity_file, blob_url);
    }

    public sealed class MediaIntegrityItem
    {
        public long MediaId { get; set; }
        public string MediaUuid { get; set; } = string.Empty;
        public string? DisplayName { get; set; }
        public string? StoredName { get; set; }
        public string Status { get; set; } = MediaIntegrityVerdict.Unknown;
        public string? Note { get; set; }
        public DateTime? CheckedUtc { get; set; }
        public int DownloadsLastHour { get; set; }
    }

    /// <summary>
    /// Process-wide state: which media are quarantined (checked by the schedule builder on every request)
    /// and the per-file download counter the loop detector reads. Singleton; also reachable through
    /// <see cref="Current"/> for the two call sites that have no constructor injection. The quarantine
    /// set is an immutable snapshot swapped atomically, so a schedule request never sees a half-built set.
    /// </summary>
    public sealed class MediaIntegrityState
    {
        public static MediaIntegrityState? Current { get; private set; }

        /// <summary>A verdict is about one stored file: <see cref="StoredName"/> is the file it was made for, so a
        /// replacement (new stored name) is never blocked by the old file's verdict, whatever else races.</summary>
        public sealed record QuarantineEntry(string Status, long MediaId, string? MediaUuid, string? StoredName);
        private volatile Dictionary<string, QuarantineEntry> _quarantined = new(StringComparer.OrdinalIgnoreCase); // media id AND uuid -> entry; replaced, never mutated
        private readonly object _swap = new();
        private readonly ConcurrentDictionary<string, byte> _recheck = new(StringComparer.OrdinalIgnoreCase);   // media ids/uuids written since the last pass
        private readonly ConcurrentDictionary<string, MinuteBucket> _buckets = new(StringComparer.OrdinalIgnoreCase);    // stored name -> sliding hour

        /// <summary>One check / accept / loop pass at a time (the admin's "run now" waits for the worker, and vice versa).</summary>
        public SemaphoreSlim Gate { get; } = new(1, 1);
        public DateTime? LastRunUtc { get; private set; }
        public string? LastRunSummary { get; private set; }
        public bool Loaded { get; set; }

        public MediaIntegrityState() { Current = this; }

        /// <summary>
        /// True when this media is held back for the file named by <paramref name="blobUrl"/>. With a null
        /// url the id alone decides (callers that have no url). An entry made for another stored file
        /// (a replacement happened) does not apply.
        /// </summary>
        public bool IsQuarantined(string? mediaIdOrUuid, string? blobUrl = null)
            => StatusOf(mediaIdOrUuid, blobUrl) != null;

        public string? StatusOf(string? mediaIdOrUuid, string? blobUrl = null)
        {
            if (string.IsNullOrEmpty(mediaIdOrUuid) || !_quarantined.TryGetValue(mediaIdOrUuid, out var e)) return null;
            if (blobUrl != null && e.StoredName != null)
            {
                var name = MediaIntegrityVerdict.StoredName(blobUrl);
                if (name != null && !string.Equals(name, e.StoredName, StringComparison.OrdinalIgnoreCase)) return null;
            }
            return e.Status;
        }

        public int QuarantinedCount => _quarantined.Values.Select(e => e.MediaId).Distinct().Count();

        public void SetQuarantine(long mediaId, string? mediaUuid, string status, string? storedName = null)
        {
            var e = new QuarantineEntry(status, mediaId, mediaUuid, storedName);
            Mutate(d => { d[mediaId.ToString()] = e; if (!string.IsNullOrEmpty(mediaUuid)) d[mediaUuid] = e; });
        }

        public void ClearQuarantine(long mediaId, string? mediaUuid)
            => Mutate(d => { d.Remove(mediaId.ToString()); if (!string.IsNullOrEmpty(mediaUuid)) d.Remove(mediaUuid); });

        /// <summary>Clears by whichever key the caller has (numeric id or uuid); the paired key goes too.</summary>
        public void ClearQuarantine(string? mediaIdOrUuid)
        {
            if (string.IsNullOrEmpty(mediaIdOrUuid)) return;
            Mutate(d =>
            {
                if (!d.TryGetValue(mediaIdOrUuid, out var e)) return;
                d.Remove(e.MediaId.ToString());
                if (!string.IsNullOrEmpty(e.MediaUuid)) d.Remove(e.MediaUuid);
                d.Remove(mediaIdOrUuid);
            });
        }

        /// <summary>Drops entries whose media id is not in <paramref name="liveIds"/> (deleted rows).</summary>
        public void KeepOnly(IEnumerable<long> liveIds)
        {
            var keep = new HashSet<long>(liveIds);
            Mutate(d =>
            {
                foreach (var key in d.Where(kv => !keep.Contains(kv.Value.MediaId)).Select(kv => kv.Key).ToList()) d.Remove(key);
            });
        }

        /// <summary>Publishes a complete new set in one reference swap.</summary>
        public void ReplaceQuarantine(IEnumerable<(long MediaId, string? MediaUuid, string Status, string? StoredName)> rows)
        {
            var d = new Dictionary<string, QuarantineEntry>(StringComparer.OrdinalIgnoreCase);
            foreach (var (id, uuid, status, storedName) in rows)
            {
                var e = new QuarantineEntry(status, id, uuid, storedName);
                d[id.ToString()] = e; if (!string.IsNullOrEmpty(uuid)) d[uuid] = e;
            }
            lock (_swap) _quarantined = d;
        }

        private void Mutate(Action<Dictionary<string, QuarantineEntry>> change)
        {
            lock (_swap)
            {
                var d = new Dictionary<string, QuarantineEntry>(_quarantined, StringComparer.OrdinalIgnoreCase);
                change(d);
                _quarantined = d;
            }
        }

        // ---- re-check requests: a media row that was just written is checked within a minute, not in 6 hours ----

        /// <summary>Called by MediaService after an upload, replace or transcode publish.</summary>
        public void RequestCheck(string? mediaIdOrUuid)
        {
            if (!string.IsNullOrEmpty(mediaIdOrUuid)) _recheck[mediaIdOrUuid] = 1;
        }

        /// <summary>Takes every pending re-check request (the worker drains this each tick).</summary>
        public List<string> DrainCheckRequests()
        {
            var keys = _recheck.Keys.ToList();
            foreach (var k in keys) _recheck.TryRemove(k, out _);
            return keys;
        }

        public void NoteRun(DateTime utc, string summary) { LastRunUtc = utc; LastRunSummary = summary; }

        // ---- loop detector: admitted downloads per stored file name, sliding 60 minutes ----

        private sealed class MinuteBucket
        {
            public readonly int[] Slots = new int[60];
            public long LastMinute;
            public MinuteBucket(long minute) { LastMinute = minute; }

            // Slots older than 60 minutes are zeroed on access. A clock step backwards never rolls back.
            public void Roll(long nowMinute)
            {
                if (nowMinute <= LastMinute) return;
                var gap = nowMinute - LastMinute;
                if (gap >= 60) Array.Clear(Slots, 0, Slots.Length);
                else for (var k = 1; k <= gap; k++) Slots[(int)((LastMinute + k) % 60)] = 0;
                LastMinute = nowMinute;
            }
        }

        private static long MinuteNow() => DateTime.UtcNow.Ticks / TimeSpan.TicksPerMinute;

        /// <summary>Called by the egress middleware for every admitted /media download.</summary>
        public void NoteDownload(string? requestPath) => NoteDownloadAt(MediaIntegrityVerdict.StoredName(requestPath), MinuteNow());

        /// <summary>Admitted downloads of one file in the last 60 minutes.</summary>
        public int DownloadsLastHour(string storedName) => DownloadsLastHourAt(storedName, MinuteNow());

        /// <summary>Files whose hourly download count exceeds <paramref name="threshold"/>.</summary>
        public List<(string StoredName, int Downloads)> FilesOver(int threshold) => FilesOverAt(threshold, MinuteNow());

        /// <summary>Forgets a file's downloads (after an admin accepted it, so the old loop's count cannot re-quarantine it).</summary>
        public void ResetDownloads(string? storedName)
        {
            if (!string.IsNullOrEmpty(storedName)) _buckets.TryRemove(storedName, out _);
        }

        internal void NoteDownloadAt(string? storedName, long minute)
        {
            if (string.IsNullOrEmpty(storedName)) return;
            var b = _buckets.GetOrAdd(storedName, _ => new MinuteBucket(minute));
            lock (b) { b.Roll(minute); b.Slots[(int)(minute % 60)]++; }
        }
        internal int DownloadsLastHourAt(string storedName, long minute)
        {
            if (!_buckets.TryGetValue(storedName, out var b)) return 0;
            lock (b) { b.Roll(minute); return b.Slots.Sum(); }
        }
        internal List<(string StoredName, int Downloads)> FilesOverAt(int threshold, long minute)
        {
            var list = new List<(string, int)>();
            foreach (var kv in _buckets) { var n = DownloadsLastHourAt(kv.Key, minute); if (n > threshold) list.Add((kv.Key, n)); }
            return list;
        }
    }

    /// <summary>
    /// The check itself (scoped: uses the repositories). Reads every live media row with plain SQL so no
    /// stored procedure has to change, writes the verdict columns added by migration 012, and keeps
    /// <see cref="MediaIntegrityState"/> in step. All mutations run under <see cref="MediaIntegrityState.Gate"/>.
    /// </summary>
    public sealed class MediaIntegrityService
    {
        private readonly IDeviceRepository _sql;          // carries the raw-SQL helpers (ExecuteSqlAsync / QueryListAsync)
        private readonly ISystemLogRepository _log;
        private readonly MediaIntegrityState _state;
        private readonly IWebHostEnvironment _env;
        private readonly IConfiguration _configuration;
        private readonly ILogger<MediaIntegrityService> _logger;

        public MediaIntegrityService(IDeviceRepository sql, ISystemLogRepository log, MediaIntegrityState state, IWebHostEnvironment env, IConfiguration configuration, ILogger<MediaIntegrityService> logger)
        {
            _sql = sql; _log = log; _state = state; _env = env; _configuration = configuration; _logger = logger;
        }

        public string MediaRoot()
        {
            var webRoot = _env.WebRootPath ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot");
            return Path.Combine(webRoot, "media");
        }

        /// <summary>Hosts whose "/media/…" urls are this server's own files (appsettings Media:LocalHosts).</summary>
        public IEnumerable<string> LocalHosts()
            => _configuration.GetSection("Media:LocalHosts").Get<string[]>() ?? Array.Empty<string>();

        private const string SelectRows = @"
            SELECT media_id, media_uuid, display_name, blob_url, file_hash, file_size_kb, integrity_status, integrity_checked_at, integrity_note, integrity_file
            FROM dbo.sn_media_files WHERE is_deleted = 0";

        public static bool IsQuarantineStatus(string? s) => s == MediaIntegrityVerdict.Mismatch || s == MediaIntegrityVerdict.Missing || s == MediaIntegrityVerdict.LoopSuspect;

        /// <summary>Loads the stored verdicts into memory (API start) without touching any file.</summary>
        public async Task LoadAsync()
        {
            var rows = await _sql.QueryListAsync<MediaIntegrityRow>(SelectRows);
            _state.ReplaceQuarantine(rows.Where(r => IsQuarantineStatus(r.integrity_status) && r.VerdictIsCurrent).Select(r => (r.media_id, (string?)r.media_uuid, r.integrity_status!, MediaIntegrityVerdict.StoredName(r.blob_url))));
            _state.Loaded = true;
        }

        /// <summary>
        /// Full check of every live row. Each row is handled on its own (a bad file or SQL hiccup on one
        /// never hides the others' verdicts), a newly found problem is quarantined at once, and the
        /// stored status is only overwritten if it is still what was read (a loop verdict that landed
        /// meanwhile wins). Returns (ok, quarantined, errors).
        /// </summary>
        public async Task<(int Ok, int Quarantined, int Errors)> RunAsync(CancellationToken ct)
        {
            await _state.Gate.WaitAsync(ct);
            try
            {
                var root = MediaRoot();
                var hosts = LocalHosts().ToList();
                var rows = (await _sql.QueryListAsync<MediaIntegrityRow>(SelectRows)).ToList();
                int ok = 0, bad = 0, errors = 0;
                var quarantine = new List<(long, string?, string)>();
                foreach (var r in rows)
                {
                    ct.ThrowIfCancellationRequested();
                    var (status, failed) = await CheckRowAsync(r, root, hosts, ct);
                    if (failed) errors++;
                    if (IsQuarantineStatus(status)) { bad++; quarantine.Add((r.media_id, r.media_uuid, status!)); }
                    else ok++;
                }
                // Per-row verdicts were applied as they were found; here only entries of rows that no longer
                // exist (deleted media) are dropped. A wholesale snapshot could resurrect a latch that a
                // replacement cleared while the pass was running (Codex).
                _state.KeepOnly(rows.Select(r => r.media_id));
                var summary = $"{rows.Count} media checked: {ok} ok, {bad} quarantined" + (errors > 0 ? $", {errors} not checked" : "");
                _state.NoteRun(DateTime.UtcNow, summary);
                _state.Loaded = true;
                _logger.LogInformation("[MediaIntegrity] {Summary}", summary);
                return (ok, bad, errors);
            }
            finally { _state.Gate.Release(); }
        }

        // Verdict + persistence for one row. Returns the status that applies now and whether anything failed.
        // Phase 1 (verdict) and phase 2 (persistence) fail independently: a problem found in phase 1 stays
        // quarantined even if phase 2 throws (Codex: a SQL hiccup must not release bad media).
        private async Task<(string Status, bool Failed)> CheckRowAsync(MediaIntegrityRow r, string root, List<string> hosts, CancellationToken ct)
        {
            // A loop verdict that is held in memory but whose row write failed must survive this pass
            // (Codex): the latch in memory counts as the previous status, the DB value only guards the UPDATE.
            var memoryLatched = _state.StatusOf(r.media_id.ToString(), r.blob_url) == MediaIntegrityVerdict.LoopSuspect;
            // A DB verdict made for another file (the media was replaced; the reset may have failed or raced)
            // is stale and ignored - it must never be carried onto the new bytes (Codex).
            var dbStatus = r.VerdictIsCurrent ? r.integrity_status : null;
            var dbNote = r.VerdictIsCurrent ? r.integrity_note : null;
            var previousStatus = memoryLatched ? MediaIntegrityVerdict.LoopSuspect : dbStatus;
            var previousNote = memoryLatched && dbStatus != MediaIntegrityVerdict.LoopSuspect ? "loop suspect (verdict not yet written)" : dbNote;
            var previous = previousStatus ?? MediaIntegrityVerdict.Unknown;
            string status, note;
            try
            {
                var name = MediaIntegrityVerdict.StoredName(r.blob_url);
                if (name == null || !MediaIntegrityVerdict.IsLocalMediaUrl(r.blob_url, hosts))
                {
                    // External storage: nothing to compare against. Keep whatever was recorded (a loop latch included).
                    (status, note) = (previous == MediaIntegrityVerdict.LoopSuspect ? MediaIntegrityVerdict.LoopSuspect : MediaIntegrityVerdict.Unknown,
                                      previous == MediaIntegrityVerdict.LoopSuspect ? (previousNote ?? "loop suspect") : "not a local /media file");
                }
                else
                {
                    var path = Path.Combine(root, name);
                    var exists = File.Exists(path);
                    string? md5 = null; long bytes = 0;
                    if (exists)
                    {
                        bytes = new FileInfo(path).Length;
                        md5 = await Task.Run(() => ComputeMd5(path), ct);
                    }
                    var (diskStatus, diskNote) = MediaIntegrityVerdict.Evaluate(r.file_hash, r.file_size_kb, exists, md5, bytes);
                    (status, note) = MediaIntegrityVerdict.Reconcile(previousStatus, previousNote, diskStatus, diskNote);
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[MediaIntegrity] media {Id}: file check failed; previous status kept", r.media_id);
                return (previous, true);
            }

            // A newly found problem takes effect in memory right away, before anything else can fail.
            var storedName = MediaIntegrityVerdict.StoredName(r.blob_url);
            if (IsQuarantineStatus(status)) _state.SetQuarantine(r.media_id, r.media_uuid, status, storedName);

            try
            {
                // Overwrite only the row that was inspected: same status, same blob_url, same stored hash. A
                // replace/transcode that published other bytes meanwhile, or a verdict that landed meanwhile
                // (loop detector, accept-disk), wins and is reported as the current one.
                await _sql.ExecuteSqlAsync(@"
                    UPDATE dbo.sn_media_files SET integrity_status = @status, integrity_checked_at = SYSUTCDATETIME(), integrity_note = @note, integrity_file = @file
                    WHERE media_id = @id AND ISNULL(integrity_status, '') = ISNULL(@prev, '')
                      AND ISNULL(blob_url, '') = ISNULL(@blob, '') AND ISNULL(file_hash, '') = ISNULL(@hash, '')",
                    new { status, note = Truncate(note, 400), file = storedName, id = r.media_id, prev = r.integrity_status, blob = r.blob_url, hash = r.file_hash });
                // ExecuteSqlAsync returns no row count; re-read to learn whether a concurrent change won (cheap, one row).
                var current = (await _sql.QueryListAsync<MediaIntegrityRow>(SelectRows + " AND media_id = @id", new { id = r.media_id })).FirstOrDefault();
                var replaced = current != null && (current.blob_url != r.blob_url || !string.Equals(current.file_hash, r.file_hash, StringComparison.OrdinalIgnoreCase));
                if (replaced)
                {
                    // Other bytes now: this verdict does not apply to them. Honour whatever status the new row
                    // carries (a loop latch stays), otherwise leave it for the next pass.
                    // Only a verdict made for the NEW file counts; an old-file status must not become a latch for the replacement (Codex pass 8).
                    var now = current!.VerdictIsCurrent ? current.integrity_status : null;
                    _logger.LogInformation("[MediaIntegrity] media {Id}: file replaced during the check; verdict dropped", r.media_id);
                    if (IsQuarantineStatus(now)) _state.SetQuarantine(r.media_id, r.media_uuid, now!, MediaIntegrityVerdict.StoredName(current.blob_url)); else _state.ClearQuarantine(r.media_id, r.media_uuid);
                    return (now ?? MediaIntegrityVerdict.Unknown, false);
                }
                var stored = current != null && current.VerdictIsCurrent ? (current.integrity_status ?? status) : status;
                if (stored != status)
                {
                    _logger.LogInformation("[MediaIntegrity] media {Id}: status changed meanwhile to {Stored}; keeping it", r.media_id, stored);
                    if (IsQuarantineStatus(stored)) _state.SetQuarantine(r.media_id, r.media_uuid, stored, storedName); else _state.ClearQuarantine(r.media_id, r.media_uuid);
                    return (stored, false);
                }

                var changed = status != previous;
                if (IsQuarantineStatus(status) && changed)
                {
                    _logger.LogError("[MediaIntegrity] media {Id} \"{Name}\" QUARANTINED ({Status}): {Note}", r.media_id, r.display_name, status, note);
                    await _log.LogAsync(null, "ERROR", $"[MediaIntegrity] QUARANTINED | media {r.media_id} \"{r.display_name}\" | {status} | {note} | held back from every screen until an admin accepts the file on disk or replaces it", "API");
                }
                else if (!IsQuarantineStatus(status))
                {
                    // A confirmed good verdict always clears memory, even when the DB never knew about the
                    // problem (a verdict whose row write had failed) (Codex).
                    var wasHeld = _state.IsQuarantined(r.media_id.ToString());
                    _state.ClearQuarantine(r.media_id, r.media_uuid);
                    if (IsQuarantineStatus(previous) || wasHeld)
                    {
                        _logger.LogInformation("[MediaIntegrity] media {Id} back to ok", r.media_id);
                        await _log.LogAsync(null, "INFO", $"[MediaIntegrity] RESTORED | media {r.media_id} \"{r.display_name}\" | {note}", "API");
                    }
                }
                return (status, false);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch (Exception ex)
            {
                // The verdict stands in memory (quarantine already applied); only the row write is missing.
                _logger.LogError(ex, "[MediaIntegrity] media {Id}: verdict {Status} not persisted; retrying next pass", r.media_id, status);
                return (status, true);
            }
        }

        /// <summary>
        /// Checks only the rows MediaService wrote since the last tick (upload / replace / transcode), so a
        /// bad hash is caught within a minute of arriving instead of at the next full pass.
        /// </summary>
        public async Task<int> RunPendingAsync(CancellationToken ct)
        {
            var keys = _state.DrainCheckRequests();
            if (keys.Count == 0) return 0;
            var pending = new Queue<string>(keys);
            try
            {
                await _state.Gate.WaitAsync(ct);
                try
                {
                    var root = MediaRoot();
                    var hosts = LocalHosts().ToList();
                    var checkedRows = 0;
                    while (pending.Count > 0)
                    {
                        ct.ThrowIfCancellationRequested();
                        var key = pending.Peek();
                        try
                        {
                            var row = (await _sql.QueryListAsync<MediaIntegrityRow>(SelectRows + " AND (CAST(media_id AS nvarchar(50)) = @k OR media_uuid = @k)", new { k = key })).FirstOrDefault();
                            if (row != null)
                            {
                                var (status, failed) = await CheckRowAsync(row, root, hosts, ct);
                                if (failed) _state.RequestCheck(key);   // try again next tick
                                checkedRows++;
                                _logger.LogInformation("[MediaIntegrity] media {Id} re-checked after a write: {Status}", row.media_id, status);
                            }
                        }
                        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
                        catch (Exception ex)
                        {
                            _logger.LogError(ex, "[MediaIntegrity] re-check of {Key} failed; queued again", key);
                            _state.RequestCheck(key);
                        }
                        pending.Dequeue();
                    }
                    return checkedRows;
                }
                finally { _state.Gate.Release(); }
            }
            finally
            {
                foreach (var k in pending) _state.RequestCheck(k);   // whatever was not processed (cancel, gate failure) is kept
            }
        }

        /// <summary>
        /// Loop detector pass: files fetched more than 3x per live screen in the last hour are quarantined.
        /// Runs every minute from the worker; cheap (in-memory counters, one query when something trips).
        /// </summary>
        public async Task<int> EvaluateLoopsAsync(int liveScreens, CancellationToken ct)
        {
            var threshold = MediaIntegrityVerdict.LoopThreshold(liveScreens);
            if (_state.FilesOver(threshold).Count == 0) return 0;   // cheap pre-check without the gate
            await _state.Gate.WaitAsync(ct);
            try
            {
                var over = _state.FilesOver(threshold);   // re-read under the gate: an accept-disk that just ran reset its counter
                if (over.Count == 0) return 0;
                var rows = (await _sql.QueryListAsync<MediaIntegrityRow>(SelectRows)).ToList();
                var tripped = 0;
                foreach (var (name, downloads) in over)
                {
                    // Several rows can point at the same stored file (replace-by-url); all of them serve it.
                    var matches = rows.Where(r => string.Equals(MediaIntegrityVerdict.StoredName(r.blob_url), name, StringComparison.OrdinalIgnoreCase)).ToList();
                    foreach (var row in matches)
                    {
                        if (row.integrity_status == MediaIntegrityVerdict.LoopSuspect && row.VerdictIsCurrent && _state.StatusOf(row.media_id.ToString(), row.blob_url) == MediaIntegrityVerdict.LoopSuspect) continue;
                        var note = $"{downloads} downloads in the last hour for {liveScreens} live screens (limit {threshold}): screens are fetching this file again and again";
                        // Memory first: even if the row write fails, the next full check keeps the latch and retries the write.
                        _state.SetQuarantine(row.media_id, row.media_uuid, MediaIntegrityVerdict.LoopSuspect, name);
                        try
                        {
                            await _sql.ExecuteSqlAsync(@"UPDATE dbo.sn_media_files SET integrity_status = @status, integrity_checked_at = SYSUTCDATETIME(), integrity_note = @note, integrity_file = @file
                                                        WHERE media_id = @id AND ISNULL(blob_url, '') = ISNULL(@blob, '') AND ISNULL(file_hash, '') = ISNULL(@hash, '')",
                                new { status = MediaIntegrityVerdict.LoopSuspect, note = Truncate(note, 400), file = name, id = row.media_id, blob = row.blob_url, hash = row.file_hash });
                        }
                        catch (Exception ex)
                        {
                            _logger.LogError(ex, "[MediaIntegrity] media {Id}: loop verdict not persisted; kept in memory, retried on the next full check", row.media_id);
                        }
                        tripped++;
                        _logger.LogError("[MediaIntegrity] media {Id} \"{Name}\" QUARANTINED (loop-suspect): {Note}", row.media_id, row.display_name, note);
                        try { await _log.LogAsync(null, "ERROR", $"[MediaIntegrity] LOOP_SUSPECT | media {row.media_id} \"{row.display_name}\" | {note} | held back from every screen; check its hash with media-integrity / accept-disk", "API"); } catch { }
                    }
                }
                return tripped;
            }
            finally { _state.Gate.Release(); }
        }

        /// <summary>
        /// Admin accepted the file on disk as the truth: hash and size are taken from it and the flag
        /// cleared. The update is conditioned on the blob_url and hash that were inspected, so a replace
        /// or transcode that published other bytes meanwhile is never overwritten (Codex).
        /// </summary>
        public async Task<(bool Ok, string Message)> AcceptDiskAsync(string mediaIdOrUuid, long? userId)
        {
            await _state.Gate.WaitAsync();
            try
            {
                var row = (await _sql.QueryListAsync<MediaIntegrityRow>(SelectRows + " AND (CAST(media_id AS nvarchar(50)) = @k OR media_uuid = @k)", new { k = mediaIdOrUuid })).FirstOrDefault();
                if (row == null) return (false, "media not found");
                var name = MediaIntegrityVerdict.StoredName(row.blob_url);
                if (name == null || !MediaIntegrityVerdict.IsLocalMediaUrl(row.blob_url, LocalHosts())) return (false, "not a local /media file");
                var path = Path.Combine(MediaRoot(), name);
                if (!File.Exists(path)) return (false, $"file {name} is not on disk; replace the media instead");
                var fi = new FileInfo(path);
                if (fi.Length <= 0) return (false, "file on disk is empty");
                var md5 = ComputeMd5(path);
                var kb = (int)Math.Ceiling(fi.Length / 1024.0);
                await _sql.ExecuteSqlAsync(@"
                    UPDATE dbo.sn_media_files SET file_hash = @md5, file_size_kb = @kb, integrity_status = 'ok', integrity_checked_at = SYSUTCDATETIME(),
                           integrity_note = @note, integrity_file = @file, updated_at = SYSUTCDATETIME(), updated_by = @userId
                    WHERE media_id = @id AND blob_url = @blob AND ISNULL(file_hash, '') = ISNULL(@oldHash, '')",
                    new { md5, kb, note = $"accepted file on disk (was {row.file_hash ?? "-"} / {row.file_size_kb} KB)", file = name, userId, id = row.media_id, blob = row.blob_url, oldHash = row.file_hash });
                var after = (await _sql.QueryListAsync<MediaIntegrityRow>(SelectRows + " AND media_id = @id", new { id = row.media_id })).FirstOrDefault();
                if (after == null || !string.Equals(after.file_hash, md5, StringComparison.OrdinalIgnoreCase) || after.blob_url != row.blob_url)
                    return (false, "the media changed while it was being accepted (new upload or transcode); re-check and try again");
                _state.ClearQuarantine(row.media_id, row.media_uuid);
                _state.ResetDownloads(name);
                await _log.LogAsync(null, "WARNING", $"[MediaIntegrity] ACCEPT_DISK | media {row.media_id} \"{row.display_name}\" | hash {row.file_hash ?? "-"} -> {md5}, {row.file_size_kb} -> {kb} KB", "API", userId);
                return (true, $"media {row.media_id}: hash set to {md5}, {kb} KB; released to the screens");
            }
            finally { _state.Gate.Release(); }
        }

        public async Task<List<MediaIntegrityItem>> ListAsync(bool onlyProblems)
        {
            var rows = await _sql.QueryListAsync<MediaIntegrityRow>(SelectRows + " ORDER BY media_id");
            var list = new List<MediaIntegrityItem>();
            foreach (var r in rows)
            {
                var status = string.IsNullOrEmpty(r.integrity_status) ? MediaIntegrityVerdict.Unknown : r.integrity_status!;
                var note = r.integrity_note;
                if (!string.IsNullOrEmpty(r.integrity_status) && !r.VerdictIsCurrent) { status = MediaIntegrityVerdict.Unknown; note = "file replaced since the last verdict; re-check pending"; }
                // What the schedules actually enforce is the in-memory set; a verdict whose row write failed
                // is still a quarantine and must show up here (Codex).
                var effective = _state.StatusOf(r.media_id.ToString(), r.blob_url);
                if (effective != null && effective != status) { status = effective; note = (note ?? "") + " (verdict held in memory, row write pending)"; }
                if (onlyProblems && !IsQuarantineStatus(status)) continue;
                var name = MediaIntegrityVerdict.StoredName(r.blob_url);
                list.Add(new MediaIntegrityItem
                {
                    MediaId = r.media_id, MediaUuid = r.media_uuid, DisplayName = r.display_name, StoredName = name,
                    Status = status, Note = note, CheckedUtc = r.integrity_checked_at,
                    DownloadsLastHour = name == null ? 0 : _state.DownloadsLastHour(name),
                });
            }
            return list;
        }

        public async Task<int> LiveScreensAsync()
            => await _sql.QueryScalarAsync<int>("SELECT COUNT(*) FROM dbo.sn_devices WHERE is_deleted = 0 AND ISNULL(playback_mode, 'screen') <> 'audio' AND last_check_in >= DATEADD(HOUR, -24, SYSUTCDATETIME())");

        private static string ComputeMd5(string path)
        {
            using var md5 = System.Security.Cryptography.MD5.Create();
            using var stream = File.OpenRead(path);
            return Convert.ToHexString(md5.ComputeHash(stream)).ToLowerInvariant();
        }

        private static string Truncate(string s, int max) => s.Length <= max ? s : s.Substring(0, max);
    }
}
