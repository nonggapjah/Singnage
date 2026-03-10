$connStr = "Server=SIGNAGE\SQLEXPRESS;Database=SignageUnicornDB;Trusted_Connection=True;MultipleActiveResultSets=true;TrustServerCertificate=True"
$mediaDir = "c:\git\Signage-Unicorn\src\SignageUnicorn.Api\wwwroot\media"
$baseUrl = "https://signage.aith123.com"

# SQL Functions
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

Write-Host "Found $($filesInDb.Rows.Count) files in DB."

foreach ($row in $filesInDb) {
    $uuid = $row.media_uuid
    $blobUrl = $row.blob_url
    
    # Extract filename from URL (handles both /media/GUID.mp4 and http://.../media/GUID.mp4)
    if ($blobUrl -match "/media/([^/?#]+)") {
        $diskFileName = $matches[1]
        
        if ($diskFileName -match "_v2") {
            Write-Host "Skipping $diskFileName (Already versioned)" -ForegroundColor Gray
            continue
        }

        # Process only video
        if ($diskFileName -match "\.(mp4|mov|webm)$") {
            $oldPath = Join-Path $mediaDir $diskFileName
            
            if (Test-Path $oldPath) {
                $base = [System.IO.Path]::GetFileNameWithoutExtension($diskFileName)
                $ext = [System.IO.Path]::GetExtension($diskFileName)
                $newName = "$base`_v2$ext"
                $newPath = Join-Path $mediaDir $newName
                
                # Update URL - preserve absolute vs relative
                if ($blobUrl -match "^http") {
                    $newUrl = $blobUrl -replace [Regex]::Escape($diskFileName), $newName
                } else {
                    $newUrl = "/media/$newName"
                }

                Write-Host "Renaming $diskFileName -> $newName"
                
                try {
                    Rename-Item -Path $oldPath -NewName $newName -ErrorAction Stop
                    
                    $sql = "UPDATE sn_media_files SET blob_url = '$newUrl', updated_at = GETUTCDATE() WHERE media_uuid = '$uuid'"
                    Invoke-SqlExec $sql
                    Write-Host "  OK: Updated DB for $uuid" -ForegroundColor Green
                } catch {
                    Write-Host "  FAILED: $($_.Exception.Message)" -ForegroundColor Red
                }
            } else {
                Write-Host "  SKIPPED: Physical file not found at $oldPath" -ForegroundColor Yellow
            }
        }
    }
}

Write-Host "FORCE RE-DOWNLOAD TRIGGER COMPLETE! (v2 Applied)" -ForegroundColor Cyan
