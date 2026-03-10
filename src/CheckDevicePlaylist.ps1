$connStr = "Server=SIGNAGE\SQLEXPRESS;Database=SignageUnicornDB;Trusted_Connection=True;MultipleActiveResultSets=true;TrustServerCertificate=True"
$conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
$conn.Open()
$sql = "SELECT d.device_id, d.device_name, d.current_playlist_id, m.blob_url FROM sn_devices d JOIN sn_playlist_items pi ON d.current_playlist_id = pi.playlist_id JOIN sn_media_files m ON pi.media_id = m.media_id WHERE d.device_id = 22 OR d.device_name LIKE '%Rattanathibet%'"
$cmd = New-Object System.Data.SqlClient.SqlCommand($sql, $conn)
$adapter = New-Object System.Data.SqlClient.SqlDataAdapter($cmd)
$ds = New-Object System.Data.DataSet
$adapter.Fill($ds) | Out-Null
$conn.Close()
$ds.Tables[0] | Select-Object -First 3 blob_url | Format-List
