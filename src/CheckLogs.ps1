$connStr = "Server=SIGNAGE\SQLEXPRESS;Database=SignageUnicornDB;Trusted_Connection=True;MultipleActiveResultSets=true;TrustServerCertificate=True"
$conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
$conn.Open()
$sql = "SELECT TOP 30 log_level, message, created_at FROM sn_system_logs ORDER BY created_at DESC"
$cmd = New-Object System.Data.SqlClient.SqlCommand($sql, $conn)
$adapter = New-Object System.Data.SqlClient.SqlDataAdapter($cmd)
$ds = New-Object System.Data.DataSet
$adapter.Fill($ds) | Out-Null
$conn.Close()
$ds.Tables[0] | Format-List
