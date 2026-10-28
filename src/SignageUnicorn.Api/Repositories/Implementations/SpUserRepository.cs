using Dapper;
using Microsoft.Data.SqlClient;
using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Repositories.Interfaces;
using System.Data;

namespace SignageUnicorn.Api.Repositories.Implementations
{
    public class SpUserRepository : IUserRepository
    {
        private readonly string _connectionString;

        public SpUserRepository(IConfiguration configuration)
        {
            _connectionString = configuration.GetConnectionString("DefaultConnection") 
                ?? throw new InvalidOperationException("Connection string 'DefaultConnection' not found.");
            
            // Ensure consistency (although we use dynamic results mostly)
            Dapper.DefaultTypeMap.MatchNamesWithUnderscores = true;
        }

        private IDbConnection CreateConnection() => new SqlConnection(_connectionString);

        private class SpStdContract
        {
            public int err_code { get; set; }
            public bool err_flag { get; set; }
            public string msg { get; set; }
        }

        public async Task<User?> GetByUsernameAsync(string username)
        {
            using var db = CreateConnection();
            var parameters = new
            {
                p_action = "LOGIN_GET_CREDENTIAL",
                p_login_id = username
            };
            
            using var multi = await db.QueryMultipleAsync("sp_auth_user_std", parameters, commandType: CommandType.StoredProcedure);
            
            var contract = await multi.ReadFirstOrDefaultAsync<SpStdContract>();
            if (contract == null || contract.err_flag) return null;

            var result = await multi.ReadFirstOrDefaultAsync<dynamic>();
            if (result == null) return null;

            string userIdStr = ((object)result.user_id)?.ToString();
            if (string.IsNullOrEmpty(userIdStr)) return null;

            return new User
            {
                UserId = userIdStr,
                Username = username,
                FullName = result.display_name?.ToString() ?? "Unknown User", 
                Role = result.role?.ToString() ?? "viewer",
                Active = (result.status?.ToString() == "active") ? "Y" : "N",
                AvatarUrl = result.avatar_url?.ToString(),
                PasswordHash = result.password_hash != null ? System.Text.Encoding.UTF8.GetString((byte[])result.password_hash) : null,
                // F12: lockout + revocation state. token_version is absent until migration 006 ran;
                // treat a missing column as version 1 rather than failing every login.
                TokenVersion = TryInt(result, "token_version") ?? 1,
                FailedLoginCount = TryInt(result, "failed_login_count") ?? 0,
                LockedUntil = TryDate(result, "locked_until")
            };
        }

        public async Task<User?> GetByIdAsync(string userId)
        {
            using var db = CreateConnection();
            var parameters = new 
            {
                p_action = "GET_PROFILE",
                p_userid = userId
            };
            
            using var multi = await db.QueryMultipleAsync("sp_auth_user_std", parameters, commandType: CommandType.StoredProcedure);
            
            var contract = await multi.ReadFirstOrDefaultAsync<SpStdContract>();
            if (contract == null || contract.err_flag) return null;

            var result = await multi.ReadFirstOrDefaultAsync<dynamic>();
            if (result == null) return null;

            return new User
            {
                UserId = ((object)result.user_id).ToString(),
                Username = result.username?.ToString() ?? "Unknown",
                FullName = result.display_name?.ToString() ?? "",
                Role = result.role?.ToString() ?? "viewer",
                Active = (result.status?.ToString() == "active") ? "Y" : "N",
                AvatarUrl = result.avatar_url?.ToString(),
                CreatedAt = (DateTime)result.created_at
            };
        }

        public async Task<RepositoryResult> CreateAsync(User user, string? executorId = null)
        {
            using var db = CreateConnection();
            
            byte[] pwdHash = null;
            byte[] pwdSalt = null;
            string pwdAlgo = null;
            int? pwdIter = null;

            if (user.PasswordHash != null)
            {
                pwdHash = System.Text.Encoding.UTF8.GetBytes(user.PasswordHash);
                pwdSalt = new byte[16]; // Placeholder salt
                pwdAlgo = "bcrypt";
                pwdIter = 10;
            }

            var parameters = new
            {
                p_action = "REGISTER",
                p_identifier_type = user.IdentifierType ?? "username",
                p_identifier_value = user.Username,
                p_display_name = user.FullName,
                p_avatar_url = user.AvatarUrl,
                p_password_hash = pwdHash,
                p_password_salt = pwdSalt,
                p_password_algo = pwdAlgo,
                p_password_iterations = pwdIter,
                p_executor_id = executorId
            };

            var result = await db.QueryFirstOrDefaultAsync<SpStdContract>("sp_auth_user_std", parameters, commandType: CommandType.StoredProcedure);
            
            if (result != null)
            {
                return result.err_flag 
                    ? RepositoryResult.Fail(result.err_code, result.msg ?? "Error") 
                    : RepositoryResult.Ok(result.msg ?? "Success");
            }
              
            return RepositoryResult.Fail(-1, "DB Execution Error");
        }

        public async Task<RepositoryResult> UpdateAsync(User user, string? executorId = null)
        {
            using var db = CreateConnection();
            
            var parameters = new
            {
                p_action = "UPDATE_PROFILE",
                p_userid = user.UserId,
                p_display_name = user.FullName,
                p_avatar_url = user.AvatarUrl,
                p_executor_id = executorId
            };
            
            var result = await db.QueryFirstOrDefaultAsync<SpStdContract>("sp_auth_user_std", parameters, commandType: CommandType.StoredProcedure);
            
            if (result != null && result.err_flag)
            {
                 return RepositoryResult.Fail(result.err_code, result.msg ?? "Error");
            }

            // Update Role if provided
            if (!string.IsNullOrEmpty(user.Role))
            {
                var roleParams = new
                {
                    p_action = "UPDATE_ROLE",
                    p_userid = user.UserId,
                    p_identifier_value = user.Role.ToLower(),
                    p_executor_id = executorId
                };
                
                await db.QueryFirstOrDefaultAsync<SpStdContract>("sp_auth_user_std", roleParams, commandType: CommandType.StoredProcedure);
            }

            return RepositoryResult.Ok(result?.msg ?? "Updated");
        }

        public async Task<RepositoryResult> UpdatePasswordAsync(string userId, string passwordHash, string? executorId = null)
        {
            using var db = CreateConnection();
            var parameters = new
            {
                p_action = "CHANGE_PASSWORD",
                p_userid = userId,
                p_password_hash = System.Text.Encoding.UTF8.GetBytes(passwordHash),
                p_executor_id = executorId
            };
            
            var result = await db.QueryFirstOrDefaultAsync<SpStdContract>("sp_auth_user_std", parameters, commandType: CommandType.StoredProcedure);
            
            return result != null && !result.err_flag 
                ? RepositoryResult.Ok(result.msg) 
                : RepositoryResult.Fail(result?.err_code ?? -1, result?.msg ?? "DB Error");
        }

        private static int? TryInt(dynamic row, string column)
        {
            try
            {
                var dict = (IDictionary<string, object>)row;
                if (!dict.TryGetValue(column, out var v) || v == null) return null;
                return Convert.ToInt32(v);
            }
            catch { return null; }
        }

        private static DateTime? TryDate(dynamic row, string column)
        {
            try
            {
                var dict = (IDictionary<string, object>)row;
                if (!dict.TryGetValue(column, out var v) || v == null) return null;
                var dt = Convert.ToDateTime(v);
                return DateTime.SpecifyKind(dt, DateTimeKind.Utc);
            }
            catch { return null; }
        }

        // F12: "delete" is a deactivation -- status = inactive and token_version bumped so every
        // token the account still holds is refused within the revocation cache window.
        public async Task<RepositoryResult> DeleteAsync(string userId, string? executorId = null)
        {
            using var db = CreateConnection();
            var parameters = new
            {
                p_action = "DEACTIVATE",
                p_userid = userId,
                p_executor_id = executorId
            };
            var result = await db.QueryFirstOrDefaultAsync<SpStdContract>("sp_auth_user_std", parameters, commandType: CommandType.StoredProcedure);
            return result != null && !result.err_flag
                ? RepositoryResult.Ok(result.msg ?? "Deactivated")
                : RepositoryResult.Fail(result?.err_code ?? -1, result?.msg ?? "DB Error");
        }

        public async Task<int?> GetTokenVersionAsync(string userId)
        {
            if (!long.TryParse(userId, out var id)) return null;
            using var db = CreateConnection();
            // Column may not exist until migration 006 ran; a null here is treated by the caller as
            // "cannot verify", which fails open to version 1 (the value every legacy token carries).
            try
            {
                return await db.ExecuteScalarAsync<int?>(
                    "SELECT token_version FROM sn_auth_user WHERE user_id = @id AND is_deleted = 0", new { id });
            }
            catch (SqlException)
            {
                return null;
            }
        }

        // F12: wires the lockout counters that sp_auth_user_std already implemented (LOGIN_SUCCESS /
        // LOGIN_FAIL take only @p_userid). Failures here are logged and swallowed by the caller: a
        // bookkeeping problem must never block a correct login or mask a wrong password.
        public async Task RecordLoginOutcomeAsync(string userId, bool success)
        {
            using var db = CreateConnection();
            var parameters = new
            {
                p_action = success ? "LOGIN_SUCCESS" : "LOGIN_FAIL",
                p_userid = userId
            };
            await db.QueryFirstOrDefaultAsync<SpStdContract>("sp_auth_user_std", parameters, commandType: CommandType.StoredProcedure);
        }

        public async Task<IEnumerable<User>> GetAllAsync()
        {
            using var db = CreateConnection();
            var parameters = new { p_action = "GET_ALL" };
            
            using var multi = await db.QueryMultipleAsync("sp_auth_user_std", parameters, commandType: CommandType.StoredProcedure);
            
            var contract = await multi.ReadFirstOrDefaultAsync<SpStdContract>();
            if (contract == null || contract.err_flag) return new List<User>();

            var result = await multi.ReadAsync<dynamic>();
            
            return result.Select(r => new User {
                UserId = ((object)r.user_id).ToString(),
                Username = r.username as string ?? r.email as string ?? r.phone as string ?? "Unknown",
                FullName = (string)r.display_name,
                Role = (string)r.role,
                Active = ((string)r.status == "active") ? "Y" : "N",
                AvatarUrl = (string)r.avatar_url
            }).ToList();
        }
    }
}
