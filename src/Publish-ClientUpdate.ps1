param(
    [Parameter(Mandatory=$true, HelpMessage="Version number, e.g., 2.4.0")]
    [string]$Version,
    
    [Parameter(HelpMessage="Path to the installer, defaults to the built 2.3.1 test. Only override if custom.")]
    [string]$SourceFile = "c:\git\Signage-Unicorn\src\signage-unicorn-client\dist\Signage Unicorn Setup $Version.exe"
)

$ServerUrl = "https://signage.aith123.com"
$TargetDir = "c:\git\Signage-Unicorn\src\SignageUnicorn.Api\wwwroot\setup"
$TargetFileName = "Signage_Unicorn_Setup_$Version.exe"
$TargetPath = Join-Path $TargetDir $TargetFileName
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
    Copy-Item -Path $SourceFile -Destination $TargetPath -Force
    Write-Host "   -> OK: Uploaded to $TargetPath" -ForegroundColor Green
} catch {
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
} catch {
    Write-Host "   -> FAILED: $($_.Exception.Message)" -ForegroundColor Red
    exit
}

# 4. Trigger Update Command for all Active Devices
Write-Host "3. Triggering UPDATE_CLIENT for all active devices..."
try {
    $devices = Invoke-SqlQuery "SELECT device_id FROM sn_devices WHERE is_deleted = 0 AND status IN ('PLAYING', 'IDLE')"
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
    Write-Host "   -> OK: Queued remote update command for $count devices." -ForegroundColor Green
} catch {
    Write-Host "   -> FAILED: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "=========================================="
Write-Host " Update Release Completed Successfully!" -ForegroundColor Cyan
Write-Host " All v2.3.1+ clients will download and install it during their next heartbeat." -ForegroundColor Yellow
