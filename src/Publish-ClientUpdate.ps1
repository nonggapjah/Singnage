param(
    [Parameter(Mandatory = $true, HelpMessage = "Version number, e.g., 2.4.0")]
    [string]$Version,
    
    [Parameter(HelpMessage = "Path to the installer, defaults to the built 2.3.1 test. Only override if custom.")]
    [string]$SourceFile = "c:\git\Signage-Unicorn\src\signage-unicorn-client\dist\Signage Unicorn Setup $Version.exe"
)

$ServerUrl = "https://signage.aith123.com"
$TargetDir = "c:\git\Signage-Unicorn\src\SignageUnicorn.Api\wwwroot\setup"
$WebPublicDir = "c:\git\Signage-Unicorn\src\signage-unicorn-web\public\setup"
$TargetFileName = "Signage_Unicorn_Setup_$Version.exe"
$TargetPath = Join-Path $TargetDir $TargetFileName
$WebTargetPath = Join-Path $WebPublicDir $TargetFileName
$DownloadUrl = "$ServerUrl/setup/$TargetFileName"

Write-Host "=========================================="
Write-Host "   Signage Unicorn - Automated Updater    "
Write-Host "=========================================="

# 1. Check if source file exists
if (!(Test-Path $SourceFile)) {
    Write-Host "ERROR: Installer not found at $SourceFile" -ForegroundColor Red
    Write-Host "Did you run 'npm run build' in the client folder first?" -ForegroundColor Yellow
    exit
}

# 2. Copy file to API wwwroot
Write-Host "1. Copying installer to web server dir..."
try {
    if (!(Test-Path $TargetDir)) { New-Item -ItemType Directory -Path $TargetDir | Out-Null }
    if (!(Test-Path $WebPublicDir)) { New-Item -ItemType Directory -Path $WebPublicDir | Out-Null }
    Copy-Item -Path $SourceFile -Destination $TargetPath -Force
    Copy-Item -Path $SourceFile -Destination $WebTargetPath -Force
    Write-Host "   -> OK: Uploaded to $TargetPath and $WebTargetPath" -ForegroundColor Green
}
catch {
    Write-Host "   -> FAILED: $($_.Exception.Message)" -ForegroundColor Red
    exit
}

# 3. Update Database using proper connection 
Write-Host "2. Updating System Settings..."
$connStr = "Server=SIGNAGE\SQLEXPRESS;Database=SignageUnicornDB;Trusted_Connection=True;TrustServerCertificate=True"

function Invoke-SqlExec($query) {
    $conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
    $cmd = New-Object System.Data.SqlClient.SqlCommand($query, $conn)
    $conn.Open()
    $cmd.ExecuteNonQuery() | Out-Null
    $conn.Close()
}

function Invoke-SqlQuery($query) {
    $conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
    $cmd = New-Object System.Data.SqlClient.SqlCommand($query, $conn)
    $conn.Open()
    $adapter = New-Object System.Data.SqlClient.SqlDataAdapter($cmd)
    $ds = New-Object System.Data.DataSet
    $adapter.Fill($ds) | Out-Null
    $conn.Close()
    return $ds.Tables[0]
}

try {
    # Update Version
    Invoke-SqlExec "UPDATE sn_system_settings SET config_value = '$Version' WHERE config_key = 'LatestClientVersion'"
    
    # Update URL
    Invoke-SqlExec "UPDATE sn_system_settings SET config_value = '$DownloadUrl' WHERE config_key = 'ClientDownloadUrl'"
    
    Write-Host "   -> OK: System Settings Updated to v$Version" -ForegroundColor Green
}
catch {
    Write-Host "   -> FAILED: $($_.Exception.Message)" -ForegroundColor Red
    exit
}

# 4. Trigger Update Command for a Canary Group (Max 5 Devices)
Write-Host "3. Triggering UPDATE_CLIENT for CANARY group (Max 5 devices)..."
try {
    # CRITICAL RULE: Never update all devices at once. Select 1 active device.
    $devices = Invoke-SqlQuery "SELECT TOP 1 device_id FROM sn_devices WHERE is_deleted = 0 AND status IN ('PLAYING', 'IDLE') AND (app_version IS NULL OR app_version NOT LIKE '%$Version%') ORDER BY last_check_in DESC"
    $count = 0
    foreach ($row in $devices) {
        $devId = $row.device_id
        $uuid = [guid]::NewGuid().ToString()
        $sql = @"
            INSERT INTO sn_device_commands 
            (command_uuid, device_id, command_type, status, created_at, created_by, is_deleted)
            VALUES ('$uuid', $devId, 'UPDATE_CLIENT', 'PENDING', GETUTCDATE(), 1, 0)
"@
        Invoke-SqlExec $sql
        $count++
    }
    Write-Host "   -> OK: Queued remote update command for $count pilot devices." -ForegroundColor Green
    
    if ($count -gt 0) {
        Write-Host "   -> IMPORTANT: You MUST verify these $count devices update successfully before expanding the rollout." -ForegroundColor Yellow
    }
}
catch {
    Write-Host "   -> FAILED: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "=========================================="
Write-Host " Canary Update Release Queued Successfully!" -ForegroundColor Cyan
Write-Host " Monitor the 5 updated devices to ensure they come back online with v$Version." -ForegroundColor Yellow
Write-Host " Check UPDATE_RULES.md for official update policy." -ForegroundColor White
