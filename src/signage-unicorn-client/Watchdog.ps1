# Signage Unicorn Watchdog
# ตรวจสอบโปรแกรมเล่นป้ายโฆษณาทุก 30 วินาที และเปิดใหม่อัตโนมัติเมื่อ
#   1) ไม่พบ process ของโปรแกรม หรือ
#   2) ไฟล์ health.json (ที่โปรแกรมเขียนทุก 30 วินาที) ไม่ถูกอัปเดตเกิน 5 นาที = โปรแกรมค้าง
# จะไม่แตะต้องโปรแกรมระหว่างมี update.lock (กำลังติดตั้งอัปเดต) และเปิดใหม่ได้ไม่เกิน 1 ครั้งต่อ 2 นาที
# บันทึก log ที่ %LOCALAPPDATA%\signage-watchdog.log

$ProcessName = "Signage Unicorn"
$AppPaths = @(
    "$env:LOCALAPPDATA\Programs\Signage Unicorn\Signage Unicorn.exe",
    "$env:LOCALAPPDATA\Programs\signage-unicorn-client\Signage Unicorn.exe"
)
# Electron userData: <APPDATA>\<app name>. The app name is the package.json "name".
$UserDataDirs = @(
    "$env:APPDATA\signage-unicorn-client",
    "$env:APPDATA\Signage Unicorn"
)
$LogFile = "$env:LOCALAPPDATA\signage-watchdog.log"

$PollSeconds = 30
$HealthStaleSeconds = 300        # health.json older than this = frozen app
$UpdateLockMaxMinutes = 30       # an update.lock older than this is stale and ignored
$MinRestartIntervalSeconds = 120 # never restart more than once per 2 minutes
$LogMaxBytes = 1MB

$script:LastRestart = [DateTime]::MinValue
$script:LastStaleReason = $null

function Write-Log {
    param([string]$Message)
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
    Write-Output $line
    try {
        if ((Test-Path -LiteralPath $LogFile) -and ((Get-Item -LiteralPath $LogFile).Length -gt $LogMaxBytes)) {
            $keep = Get-Content -LiteralPath $LogFile -Tail 500
            Set-Content -LiteralPath $LogFile -Value $keep
        }
        Add-Content -LiteralPath $LogFile -Value $line
    } catch {
        # logging must never stop the watchdog
    }
}

function Get-AppPath {
    foreach ($p in $AppPaths) {
        if (Test-Path -LiteralPath $p) { return $p }
    }
    return $null
}

function Get-UserDataFile {
    param([string]$Name)
    $newest = $null
    foreach ($dir in $UserDataDirs) {
        $candidate = Join-Path $dir $Name
        if (Test-Path -LiteralPath $candidate) {
            $item = Get-Item -LiteralPath $candidate
            if ($null -eq $newest -or $item.LastWriteTimeUtc -gt $newest.LastWriteTimeUtc) { $newest = $item }
        }
    }
    return $newest
}

function Test-UpdateInProgress {
    $lock = Get-UserDataFile -Name 'update.lock'
    if ($null -eq $lock) { return $false }
    $ageMinutes = ((Get-Date).ToUniversalTime() - $lock.LastWriteTimeUtc).TotalMinutes
    if ($ageMinutes -gt $UpdateLockMaxMinutes) {
        Write-Log "update.lock is $([int]$ageMinutes) min old (stale) - ignoring it."
        return $false
    }
    return $true
}

function Test-HealthStale {
    $health = Get-UserDataFile -Name 'health.json'
    if ($null -eq $health) { return $false }   # old client without health file: process check only
    $ageSeconds = ((Get-Date).ToUniversalTime() - $health.LastWriteTimeUtc).TotalSeconds
    if ($ageSeconds -gt $HealthStaleSeconds) { return $true }
    # The file is fresh, but main writes it from the renderer's liveness reports: a frozen
    # renderer shows up as rendererStale = true (and main already tried one reload).
    try {
        $json = Get-Content -LiteralPath $health.FullName -Raw | ConvertFrom-Json
        if ($null -ne $json -and $json.PSObject.Properties['rendererStale'] -and $json.rendererStale -eq $true) {
            $script:LastStaleReason = 'renderer frozen (rendererStale=true in health.json)'
            return $true
        }
    } catch {
        # unreadable JSON while being rewritten: treat as healthy this round
    }
    return $false
}

function Restart-Player {
    param([string]$Reason)
    $sinceLast = ((Get-Date) - $script:LastRestart).TotalSeconds
    if ($sinceLast -lt $MinRestartIntervalSeconds) {
        Write-Log "Restart wanted ($Reason) but last restart was $([int]$sinceLast)s ago - waiting."
        return
    }
    $appPath = Get-AppPath
    if ($null -eq $appPath) {
        Write-Log "Restart wanted ($Reason) but no player executable found at: $($AppPaths -join ' | ')"
        return
    }
    Write-Log "Restarting player ($Reason)..."
    try {
        Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | ForEach-Object {
            try { $_.Kill() } catch { }
        }
        Start-Sleep -Seconds 3
        Start-Process -FilePath $appPath
        $script:LastRestart = Get-Date
        Write-Log "Player started: $appPath"
    } catch {
        Write-Log "Restart FAILED: $($_.Exception.Message)"
    }
}

Write-Log "Watchdog started for '$ProcessName' (poll ${PollSeconds}s, health stale ${HealthStaleSeconds}s)."

while ($true) {
    try {
        if (Test-UpdateInProgress) {
            Write-Log "Client update in progress (update.lock present) - not touching the player."
        } else {
            $process = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue
            if (-not $process) {
                Restart-Player -Reason 'process not running'
            } elseif (Test-HealthStale) {
                $reason = if ($script:LastStaleReason) { $script:LastStaleReason } else { "health.json not updated for more than ${HealthStaleSeconds}s (frozen)" }
                $script:LastStaleReason = $null
                Restart-Player -Reason $reason
            }
        }
    } catch {
        Write-Log "Watchdog loop error: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds $PollSeconds
}
