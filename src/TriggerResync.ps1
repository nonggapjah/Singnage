$connStr = "Server=SIGNAGE\SQLEXPRESS;Database=SignageUnicornDB;Trusted_Connection=True;MultipleActiveResultSets=true;TrustServerCertificate=True"
try {
    $conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
    $conn.Open()
    $sql = "UPDATE sn_playlist_items SET duration_override = ISNULL(duration_override, 15) + 1 WHERE playlist_id IN (SELECT playlist_id FROM sn_playlists WHERE status = 'active') AND position_order = 1"
    $cmd = New-Object System.Data.SqlClient.SqlCommand($sql, $conn)
    $count = $cmd.ExecuteNonQuery()
    $conn.Close()
    Write-Host "SUCCESS: Forced re-sync by bumping duration on $count playlist items."
}
catch {
    Write-Host "ERROR: $($_.Exception.Message)"
}
