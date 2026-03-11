param(
    [string]$InstallerPath = "C:\git\Signage-Unicorn\src\signage-unicorn-client\dist\Signage Unicorn Setup 2.3.1.exe",
    [string[]]$ComputerList = @("161.82.188.74") # ใส่รายชื่อ IP หรือชื่อเครื่องตรงนี้
)

Write-Host "=========================================="
Write-Host "   Signage Unicorn - Mass Client Update   "
Write-Host "=========================================="

if (!(Test-Path $InstallerPath)) {
    Write-Host "ERROR: Installer not found at $InstallerPath" -ForegroundColor Red
    exit
}

foreach ($Target in $ComputerList) {
    Write-Host "`nDeploying to $Target ..."
    try {
        $RemotePath = "\\$Target\c$\temp\SignageUnicornUpdate.exe"
        
        # 1. Ensure remote temp directory
        Write-Host "  -> Preparing remote machine directory..."
        Invoke-Command -ComputerName $Target -ScriptBlock {
            if (!(Test-Path -Path C:\temp)) {
                New-Item -ItemType Directory -Path C:\temp | Out-Null
            }
        } -ErrorAction Stop
        
        # 2. Copy the installer over SMB
        Write-Host "  -> Copying installer to $Target (this may take a minute)..."
        Copy-Item -Path $InstallerPath -Destination $RemotePath -Force -ErrorAction Stop
        
        # 3. Execute silently via WinRM (/S is the silent arg for NSIS)
        Write-Host "  -> Running installer silently on $Target ..."
        Invoke-Command -ComputerName $Target -ScriptBlock {
            $process = Start-Process -FilePath "C:\temp\SignageUnicornUpdate.exe" -ArgumentList "/S" -Wait -PassThru
            if ($process.ExitCode -eq 0) {
                Write-Host "    [OK] Installer completed."
            } else {
                Write-Host "    [WARN] Installer exited with code $($process.ExitCode)."
            }
        } -ErrorAction Stop
        
        Write-Host "  -> SUCCESS! $Target is updated." -ForegroundColor Green
    } catch {
        Write-Host "  -> FAILED to deploy to $Target`: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "     (Check if WinRM is enabled on the target machine)" -ForegroundColor Yellow
    }
}
Write-Host "`nDeployment process finished." -ForegroundColor Cyan
