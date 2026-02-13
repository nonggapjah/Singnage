using Dapper;
using Microsoft.Data.SqlClient;
using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Repositories.Interfaces;
using System.Data;

namespace SignageUnicorn.Api.Repositories.Implementations
{
    public class SpMediaRepository : IMediaRepository
    {
        private readonly string _connectionString;

        public SpMediaRepository(IConfiguration configuration)
        {
            _connectionString = configuration.GetConnectionString("DefaultConnection") ?? throw new InvalidOperationException("Connection string 'DefaultConnection' not found.");
            // Ensure Dapper maps snake_case (db) to PascalCase (model)
            Dapper.DefaultTypeMap.MatchNamesWithUnderscores = true;
        }

        private IDbConnection CreateConnection() => new SqlConnection(_connectionString);

        private class SpStdResult
        {
            public int err_code { get; set; }
            public bool err_flag { get; set; }
            public string msg { get; set; }
        }

        public async Task<IEnumerable<MediaFile>> GetAllAsync(string? searchTerm = null, string? supplierCode = null, string? remark1 = null, string? remark2 = null, string? status = null, string? mediaType = null)
        {
            using var db = CreateConnection();
            var p = new DynamicParameters();
            p.Add("@p_action", "GET_ALL");
            p.Add("@p_search_term", searchTerm);
            p.Add("@p_supplier_code", supplierCode);
            p.Add("@p_remark1", remark1);
            p.Add("@p_remark2", remark2);
            p.Add("@p_filter_status", status);
            p.Add("@p_media_type", mediaType);

            using var multi = await db.QueryMultipleAsync("sp_media_std", p, commandType: CommandType.StoredProcedure);
            var resultStatus = await multi.ReadFirstOrDefaultAsync<SpStdResult>();
            
            if (resultStatus != null && resultStatus.err_flag)
            {
                return Enumerable.Empty<MediaFile>();
            }

            return await multi.ReadAsync<MediaFile>();
        }

        public async Task<MediaFile?> GetByIdAsync(string id)
        {
            using var db = CreateConnection();
            var p = new DynamicParameters();
            p.Add("@p_action", "GET_BY_ID");
            
            if (long.TryParse(id, out var idLong))
                p.Add("@p_media_id", idLong);
            else
                p.Add("@p_media_uuid", id);

            using var multi = await db.QueryMultipleAsync("sp_media_std", p, commandType: CommandType.StoredProcedure);
            var status = await multi.ReadFirstOrDefaultAsync<SpStdResult>();
            
            if (status != null && status.err_flag) return null;

            return await multi.ReadFirstOrDefaultAsync<MediaFile>();
        }

        public async Task<RepositoryResult<MediaFile>> CreateAsync(MediaFile media, long? userId = null)
        {
            using var db = CreateConnection();
            var p = new DynamicParameters();
            p.Add("@p_action", "CREATE");
            p.Add("@p_userid", userId);
            p.Add("@p_media_uuid", media.MediaId);
            p.Add("@p_file_name", media.FileName);
            p.Add("@p_display_name", media.DisplayName);
            p.Add("@p_blob_url", media.BlobUrl);
            p.Add("@p_duration_sec", media.DurationSec);
            p.Add("@p_ratio", media.Ratio);
            p.Add("@p_file_size_kb", media.FileSizeKb);
            p.Add("@p_supplier_code", media.Supplier_Code);
            p.Add("@p_remark1", media.Remark1);
            p.Add("@p_remark2", media.Remark2);
            p.Add("@p_file_hash", media.FileHash);
            p.Add("@p_end_date", media.EndDate);

            using var multi = await db.QueryMultipleAsync("sp_media_std", p, commandType: CommandType.StoredProcedure);
            var status = await multi.ReadFirstOrDefaultAsync<SpStdResult>();
            
            if (status != null && !status.err_flag)
            {
                var data = await multi.ReadFirstOrDefaultAsync<MediaFile>();
                return RepositoryResult<MediaFile>.Ok(data, status.msg);
            }
            return RepositoryResult<MediaFile>.Fail(status?.err_code ?? -1, status?.msg ?? "Database Error");
        }

        public async Task<RepositoryResult<MediaFile>> UpdateAsync(MediaFile media, long? userId = null)
        {
            using var db = CreateConnection();
            var p = new DynamicParameters();
            p.Add("@p_action", "UPDATE");
            p.Add("@p_userid", userId);
            
            if (long.TryParse(media.MediaId, out var idLong))
                p.Add("@p_media_id", idLong);
            else
                p.Add("@p_media_uuid", media.MediaId);

            p.Add("@p_display_name", media.DisplayName);
            p.Add("@p_supplier_code", media.Supplier_Code);
            p.Add("@p_remark1", media.Remark1);
            p.Add("@p_remark2", media.Remark2);
            p.Add("@p_end_date", media.EndDate);

            using var multi = await db.QueryMultipleAsync("sp_media_std", p, commandType: CommandType.StoredProcedure);
            var status = await multi.ReadFirstOrDefaultAsync<SpStdResult>();
            
            if (status != null && !status.err_flag)
            {
                var data = await multi.ReadFirstOrDefaultAsync<MediaFile>();
                return RepositoryResult<MediaFile>.Ok(data, status.msg);
            }
            return RepositoryResult<MediaFile>.Fail(status?.err_code ?? -1, status?.msg ?? "Database Error");
        }

        public async Task<RepositoryResult> DeleteAsync(string id, long? userId = null, bool force = false)
        {
            using var db = CreateConnection();
            var p = new DynamicParameters();
            p.Add("@p_action", "DELETE");
            p.Add("@p_userid", userId);
            p.Add("@p_force_delete", force ? 1 : 0);
            
            if (long.TryParse(id, out var idLong))
                p.Add("@p_media_id", idLong);
            else
                p.Add("@p_media_uuid", id);

            using var multi = await db.QueryMultipleAsync("sp_media_std", p, commandType: CommandType.StoredProcedure);
            var result = await multi.ReadFirstOrDefaultAsync<SpStdResult>();
            
            return result != null && !result.err_flag 
                 ? RepositoryResult.Ok(result.msg) 
                 : RepositoryResult.Fail(result?.err_code ?? -1, result?.msg ?? "Database Error");
        }

        public async Task<RepositoryResult> RestoreAsync(string id, long? userId = null)
        {
            using var db = CreateConnection();
            var p = new DynamicParameters();
            p.Add("@p_action", "RESTORE");
            p.Add("@p_userid", userId);

            if (long.TryParse(id, out var idLong))
                p.Add("@p_media_id", idLong);
            else
                p.Add("@p_media_uuid", id);

            using var multi = await db.QueryMultipleAsync("sp_media_std", p, commandType: CommandType.StoredProcedure);
            var result = await multi.ReadFirstOrDefaultAsync<SpStdResult>();

            return result != null && !result.err_flag
                 ? RepositoryResult.Ok(result.msg)
                 : RepositoryResult.Fail(result?.err_code ?? -1, result?.msg ?? "Database Error");
        }

        public async Task<IEnumerable<MediaUsageDto>> GetMediaUsageAsync(string mediaId)
        {
            using var db = CreateConnection();
            var p = new DynamicParameters();
            p.Add("@p_action", "GET_USAGE");
            
            if (long.TryParse(mediaId, out var idLong))
                p.Add("@p_media_id", idLong);
            else
                p.Add("@p_media_uuid", mediaId);
            
            using var multi = await db.QueryMultipleAsync("sp_media_std", p, commandType: CommandType.StoredProcedure);
            var status = await multi.ReadFirstOrDefaultAsync<SpStdResult>();
            
            if (status != null && status.err_flag) return Enumerable.Empty<MediaUsageDto>();

            return await multi.ReadAsync<MediaUsageDto>();
        }

        public async Task<RepositoryResult<MediaFile>> SwapMediaAsync(string oldId, string newId, long? userId = null)
        {
            using var db = CreateConnection();
            var p = new DynamicParameters();
            p.Add("@p_action", "REPLACE_USAGE");
            p.Add("@p_userid", userId);

            if (long.TryParse(oldId, out var oldIdLong))
                p.Add("@p_media_id", oldIdLong);
            else
                p.Add("@p_media_uuid", oldId);

            if (long.TryParse(newId, out var newIdLong))
                p.Add("@p_ref_media_id", newIdLong);
            else {
                 var refMedia = await GetByIdAsync(newId);
                 if (refMedia == null) return RepositoryResult<MediaFile>.Fail(-1, "New Media Not Found");
                 p.Add("@p_ref_media_id", long.Parse(refMedia.MediaId)); 
            }

            using var multi = await db.QueryMultipleAsync("sp_media_std", p, commandType: CommandType.StoredProcedure);
            var status = await multi.ReadFirstOrDefaultAsync<SpStdResult>();
            
            if (status != null && !status.err_flag)
            {
                var data = await multi.ReadFirstOrDefaultAsync<MediaFile>();
                return RepositoryResult<MediaFile>.Ok(data, status.msg);
            }
            return RepositoryResult<MediaFile>.Fail(status?.err_code ?? -1, status?.msg ?? "Database Error");
        }

        public async Task<RepositoryResult<MediaFile>> ReplaceAsync(MediaFile media, long? userId = null)
        {
            using var db = CreateConnection();
            var p = new DynamicParameters();
            p.Add("@p_action", "REPLACE_FILE");
            p.Add("@p_userid", userId);
            
            if (long.TryParse(media.MediaId, out var idLong))
                p.Add("@p_media_id", idLong);
            else
                p.Add("@p_media_uuid", media.MediaId);

            p.Add("@p_file_name", media.FileName);
            p.Add("@p_blob_url", media.BlobUrl);
            p.Add("@p_duration_sec", media.DurationSec);
            p.Add("@p_ratio", media.Ratio);
            p.Add("@p_file_size_kb", media.FileSizeKb);
            p.Add("@p_file_hash", media.FileHash);
            p.Add("@p_end_date", media.EndDate);

            using var multi = await db.QueryMultipleAsync("sp_media_std", p, commandType: CommandType.StoredProcedure);
            var status = await multi.ReadFirstOrDefaultAsync<SpStdResult>();
            
            if (status != null && !status.err_flag)
            {
                var data = await multi.ReadFirstOrDefaultAsync<MediaFile>();
                return RepositoryResult<MediaFile>.Ok(data, status.msg);
            }
            return RepositoryResult<MediaFile>.Fail(status?.err_code ?? -1, status?.msg ?? "Database Error");
        }

        public async Task<bool> SyncMediaUrls(string targetUrl, string newUrl)
        {
            using var db = CreateConnection();
            var p = new DynamicParameters();
            p.Add("@p_action", "SYNC_BLOB_URL");
            p.Add("@p_remark1", targetUrl); 
            p.Add("@p_blob_url", newUrl);   

            using var multi = await db.QueryMultipleAsync("sp_media_std", p, commandType: CommandType.StoredProcedure);
            var result = await multi.ReadFirstOrDefaultAsync<SpStdResult>();
            return result != null && !result.err_flag;
        }
    }
}
