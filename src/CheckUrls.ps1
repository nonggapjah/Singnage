$connStr = "Server=SIGNAGE\SQLEXPRESS;Database=SignageUnicornDB;Trusted_Connection=True;MultipleActiveResultSets=true;TrustServerCertificate=True"
$conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
$conn.Open()
$sql = "SELECT TOP 10 media_uuid, file_name, blob_url FROM sn_media_files WHERE is_deleted = 0 AND blob_url LIKE '%_v2%'"
$cmd = New-Object System.Data.SqlClient.SqlCommand($sql, $conn)
$adapter = New-Object System.Data.SqlClient.SqlDataAdapter($cmd)
$ds = New-Object System.Data.DataSet
$adapter.Fill($ds) | Out-Null
$conn.Close()
$ds.Tables[0] | Format-Table -AutoSize
