# Signage Unicorn Watchdog Script
# ตรวจสอบสถานะการทำงานของโปรแกรมเล่นป้ายโฆษณา ทุกๆ 30 วินาที หากโปรแกรมปิดตัวลง จะทำการเปิดใหม่โดยอัตโนมัติ

$ProcessName = "Signage Unicorn"
$AppPath = "$env:LOCALAPPDATA\Programs\Signage Unicorn\Signage Unicorn.exe"

Write-Output "$(Get-Date): เริ่มการทำงานของ Watchdog สำหรับ $ProcessName..."

while ($true) {
    $process = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue
    if (-not $process) {
        Write-Output "$(Get-Date): ตรวจพบว่า $ProcessName ไม่ได้ทำงานอยู่ กำลังทำการเปิดโปรแกรมใหม่..."
        if (Test-Path $AppPath) {
        Start-Process -FilePath $AppPath
        Write-Output "$(Get-Date): เปิดโปรแกรมสำเร็จ: $AppPath"
    } else {
            Write-Output "$(Get-Date): ไม่พบไฟล์รันที่ตำแหน่งมาตรฐาน: $AppPath"
        }
    }
    Start-Sleep -Seconds 30
}
