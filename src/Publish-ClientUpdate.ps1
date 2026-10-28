param(
    [Parameter(Mandatory = $true, HelpMessage = "Version number, e.g., 2.8.0")]
    [string]$Version,

    [Parameter(HelpMessage = "Repository root on THIS machine (dev box: C:\Singnage\Singnage, server: C:\git\Signage-Unicorn)")]
    [string]$RepoRoot = "C:\Singnage\Singnage",

    [Parameter(HelpMessage = "Path to the built installer. Defaults to <RepoRoot>\src\signage-unicorn-client\dist\Signage Unicorn Setup <Version>.exe")]
    [string]$SourceFile,

    [string]$ServerUrl = "https://signage.aith123.com",

    [string]$ConnectionString = "Server=SIGNAGE\SQLEXPRESS;Database=SignageUnicornDB;Trusted_Connection=True;TrustServerCertificate=True",

    [Parameter(HelpMessage = "Number of pilot devices to queue UPDATE_CLIENT for (1-5). UPDATE_RULES.md: never more than 5.")]
    [ValidateRange(1, 5)]
    [int]$CanaryCount = 1
)

# Any failure stops the script BEFORE it touches the database or queues a command: a half-published
# release (file missing, hash wrong, URL unreachable) used to be advertised to the fleet anyway.
$ErrorActionPreference = 'Stop'

# Contract T13: the fleet downloads installers and their SHA-256 from this URL; plain http would let
# an on-path attacker replace both. Refuse before anything is copied or written.
if (-not $ServerUrl.StartsWith('https://', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "ServerUrl must be https (got '$ServerUrl'). Installers and their hashes travel over TLS only."
}

if ([string]::IsNullOrWhiteSpace($SourceFile)) {
    $SourceFile = Join-Path $RepoRoot "src\signage-unicorn-client\dist\Signage Unicorn Setup $Version.exe"
}
$TargetDir = Join-Path $RepoRoot "src\SignageUnicorn.Api\wwwroot\setup"
$WebPublicDir = Join-Path $RepoRoot "src\signage-unicorn-web\public\setup"
$TargetFileName = "Signage_Unicorn_Setup_$Version.exe"
$TargetPath = Join-Path $TargetDir $TargetFileName
$WebTargetPath = Join-Path $WebPublicDir $TargetFileName
$DownloadUrl = "$($ServerUrl.TrimEnd('/'))/setup/$TargetFileName"

Write-Host "=========================================="
Write-Host "   Signage Unicorn - Automated Updater    "
Write-Host "=========================================="
Write-Host "Version      : $Version"
Write-Host "Repo root    : $RepoRoot"
Write-Host "Installer    : $SourceFile"
Write-Host "Download URL : $DownloadUrl"
Write-Host "Canary count : $CanaryCount"

# 1. Source installer
if (!(Test-Path -LiteralPath $SourceFile)) {
    throw "Installer not found at $SourceFile. Did you run 'npm run build' in the client folder first?"
}
$SourceHash = (Get-FileHash -LiteralPath $SourceFile -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host "1. Installer SHA-256: $SourceHash"

# 2. Copy to both publish locations and verify each copy by hash
Write-Host "2. Copying installer to web server dirs..."
foreach ($dir in @($TargetDir, $WebPublicDir)) {
    if (!(Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -ErrorAction Stop | Out-Null }
}
Copy-Item -LiteralPath $SourceFile -Destination $TargetPath -Force -ErrorAction Stop
Copy-Item -LiteralPath $SourceFile -Destination $WebTargetPath -Force -ErrorAction Stop
foreach ($copy in @($TargetPath, $WebTargetPath)) {
    $copyHash = (Get-FileHash -LiteralPath $copy -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($copyHash -ne $SourceHash) {
        throw "Copy verification FAILED for $copy (hash $copyHash != $SourceHash). Nothing was published."
    }
}
Write-Host "   -> OK: both copies verified ($TargetPath, $WebTargetPath)" -ForegroundColor Green

# 3. Make sure the fleet can actually reach the file before advertising it
Write-Host "3. Checking download URL..."
try {
    $head = Invoke-WebRequest -Uri $DownloadUrl -Method Head -UseBasicParsing -TimeoutSec 60
    if ($head.StatusCode -lt 200 -or $head.StatusCode -ge 300) { throw "HTTP $($head.StatusCode)" }
    Write-Host "   -> OK: $DownloadUrl responds $($head.StatusCode)" -ForegroundColor Green
}
catch {
    throw "Download URL is not reachable ($($_.Exception.Message)). Database NOT updated, no command queued."
}

# 4. Publish release metadata atomically (version + url + sha256 in ONE transaction)
Write-Host "4. Updating System Settings (transaction)..."
$conn = New-Object System.Data.SqlClient.SqlConnection($ConnectionString)
$conn.Open()
$tx = $conn.BeginTransaction()
try {
    $upsert = @"
UPDATE sn_system_settings SET config_value = @value, updated_at = SYSUTCDATETIME() WHERE config_key = @key;
IF @@ROWCOUNT = 0
    INSERT INTO sn_system_settings (config_key, config_value, description, updated_at)
    VALUES (@key, @value, @description, SYSUTCDATETIME());
"@
    $settings = @(
        @{ key = 'LatestClientVersion'; value = $Version;      description = 'Latest published client version' },
        @{ key = 'ClientDownloadUrl';   value = $DownloadUrl;  description = 'Installer download URL for the latest client' },
        @{ key = 'ClientDownloadSha256'; value = $SourceHash;  description = 'SHA-256 (lowercase hex) of the installer at ClientDownloadUrl' }
    )
    foreach ($s in $settings) {
        $cmd = New-Object System.Data.SqlClient.SqlCommand($upsert, $conn, $tx)
        [void]$cmd.Parameters.AddWithValue('@key', $s.key)
        [void]$cmd.Parameters.AddWithValue('@value', $s.value)
        [void]$cmd.Parameters.AddWithValue('@description', $s.description)
        [void]$cmd.ExecuteNonQuery()
    }
    $tx.Commit()
    Write-Host "   -> OK: LatestClientVersion=$Version, ClientDownloadUrl, ClientDownloadSha256 published together" -ForegroundColor Green
}
catch {
    try { $tx.Rollback() } catch { }
    $conn.Close()
    throw "Settings update FAILED and was rolled back: $($_.Exception.Message)"
}

# 5. Queue UPDATE_CLIENT for the canary group (UPDATE_RULES.md: max 5 pilot devices)
Write-Host "5. Queuing UPDATE_CLIENT for $CanaryCount canary device(s)..."
$queued = 0
try {
    $select = @"
SELECT TOP (@count) d.device_id
FROM sn_devices d
WHERE d.is_deleted = 0
  AND d.status IN ('PLAYING', 'IDLE', 'ONLINE', 'online')
  AND (d.app_version IS NULL OR d.app_version NOT LIKE @versionLike)
  AND NOT EXISTS (
        SELECT 1 FROM sn_device_commands c
        WHERE c.device_id = d.device_id AND c.command_type = 'UPDATE_CLIENT' AND c.status IN ('PENDING', 'POLLING') AND c.is_deleted = 0)
ORDER BY d.last_check_in DESC
"@
    $cmd = New-Object System.Data.SqlClient.SqlCommand($select, $conn)
    [void]$cmd.Parameters.AddWithValue('@count', $CanaryCount)
    [void]$cmd.Parameters.AddWithValue('@versionLike', "%$Version%")
    $reader = $cmd.ExecuteReader()
    $deviceIds = @()
    while ($reader.Read()) { $deviceIds += [int64]$reader['device_id'] }
    $reader.Close()

    foreach ($devId in $deviceIds) {
        $insert = @"
INSERT INTO sn_device_commands (command_uuid, device_id, command_type, status, created_at, created_by, is_deleted)
VALUES (@uuid, @deviceId, 'UPDATE_CLIENT', 'PENDING', SYSUTCDATETIME(), 1, 0)
"@
        $ins = New-Object System.Data.SqlClient.SqlCommand($insert, $conn)
        [void]$ins.Parameters.AddWithValue('@uuid', [guid]::NewGuid().ToString())
        [void]$ins.Parameters.AddWithValue('@deviceId', $devId)
        [void]$ins.ExecuteNonQuery()
        $queued++
        Write-Host "   -> queued device_id $devId"
    }
    Write-Host "   -> OK: Queued remote update command for $queued pilot device(s)." -ForegroundColor Green
    if ($queued -gt 0) {
        Write-Host "   -> IMPORTANT: verify these $queued device(s) come back online on v$Version and play media before expanding the rollout." -ForegroundColor Yellow
    }
}
catch {
    Write-Host "   -> FAILED to queue canary command: $($_.Exception.Message)" -ForegroundColor Red
}
finally {
    $conn.Close()
}

Write-Host "=========================================="
Write-Host " Canary Update Release Queued Successfully!" -ForegroundColor Cyan
Write-Host " Monitor the $queued updated device(s) to ensure they come back online with v$Version." -ForegroundColor Yellow
Write-Host " Check UPDATE_RULES.md for official update policy." -ForegroundColor White
