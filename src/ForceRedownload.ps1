$connStr = "Server=SIGNAGE\SQLEXPRESS;Database=SignageUnicornDB;Trusted_Connection=True;MultipleActiveResultSets=true;TrustServerCertificate=True"
$mediaDir = "c:\git\Signage-Unicorn\src\SignageUnicorn.Api\wwwroot\media"
$baseUrl = "https://signage.aith123.com"

# SQL Function
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

function Invoke-SqlExec($query) {
    $conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
    $cmd = New-Object System.Data.SqlClient.SqlCommand($query, $conn)
    $conn.Open()
    $cmd.ExecuteNonQuery() | Out-Null
    $conn.Close()
}

$filesInDb = Invoke-SqlQuery "SELECT media_uuid, file_name, blob_url FROM sn_media_files WHERE is_deleted = 0"

Write-Host "Found $($filesInDb.Rows.Count) files in DB to process."

foreach ($row in $filesInDb) {
    $uuid = $row.media_uuid
    $oldName = $row.file_name
    
    # Process only video/mov/webm
    if ($oldName -match "\.(mp4|mov|webm)$") {
        if ($oldName -match "_f\.mp4$") {
            Write-Host "Skipping $oldName (Already forced)" -ForegroundColor Gray
            continue
        }

        $oldPath = Join-Path $mediaDir $oldName
        if (Test-Path $oldPath) {
            $base = [System.IO.Path]::GetFileNameWithoutExtension($oldName)
            $ext = [System.IO.Path]::GetExtension($oldName)
            $newName = "$base`_f$ext"
            $newPath = Join-Path $mediaDir $newName
            $newUrl = "$baseUrl/media/$newName"

            Write-Host "Renaming $oldName -> $newName"
            
            try {
                Rename-Item -Path $oldPath -NewName $newName -ErrorAction Stop
                
                $sql = "UPDATE sn_media_files SET file_name = '$newName', blob_url = '$newUrl', updated_at = GETUTCDATE() WHERE media_uuid = '$uuid'"
                Invoke-SqlExec $sql
                Write-Host "  OK: Updated DB for $uuid" -ForegroundColor Green
            } catch {
                Write-Host "  FAILED: $($_.Exception.Message)" -ForegroundColor Red
            }
        } else {
            Write-Host "  SKIPPED: Physical file not found for $oldName" -ForegroundColor Yellow
        }
    }
}

Write-Host "FORCE RE-DOWNLOAD TRIGGER COMPLETE!" -ForegroundColor Cyan
