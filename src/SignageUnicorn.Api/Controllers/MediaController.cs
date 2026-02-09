using Microsoft.AspNetCore.Mvc;
using SignageUnicorn.Api.Models;
using SignageUnicorn.Api.Services;
using SignageUnicorn.Api.Models.Responses; // Use existing ApiResponse
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using SignageUnicorn.Api.Constants;

namespace SignageUnicorn.Api.Controllers
{
    [ApiController]
    [Route("api/v1/media")] // Fixed route to match RESTful standard
    [Authorize]
    public class MediaController : ControllerBase
    {
        private readonly MediaService _service;

        public MediaController(MediaService service)
        {
            _service = service;
        }

        [HttpGet]
        public async Task<IActionResult> GetAll(
            [FromQuery] string? searchTerm = null, 
            [FromQuery] string? supplierCode = null, 
            [FromQuery] string? remark1 = null, 
            [FromQuery] string? remark2 = null,
            [FromQuery] string? status = null,
            [FromQuery] string? mediaType = null)
        {
            var data = await _service.GetAllMediaAsync(searchTerm, supplierCode, remark1, remark2, status, mediaType);
            return Ok(ApiResponse<IEnumerable<MediaFile>>.SuccessResponse(data));
        }

        [HttpGet("{id}")]
        [AllowAnonymous]
        public async Task<IActionResult> GetById(string id)
        {
            // Since we don't have a direct GetById in the service efficiently yet, we can filter GetAll or add it.
            // For speed, let's add it to Service properly, but filtering GetAll is a quick temporary fallback if needed.
            // But we should do it right.
            var media = await _service.GetMediaByIdAsync(id);
            if (media == null) return NotFound(ApiResponse<MediaFile>.ErrorResponse(404, "Media not found"));
            return Ok(ApiResponse<MediaFile>.SuccessResponse(media));
        }



        private long? GetUserId()
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (long.TryParse(userIdClaim, out var userId))
            {
                return userId;
            }
            return null;
        }

        [HttpPost]
        [Authorize(Roles = UserRoles.Admin + "," + UserRoles.Editor)]
        [Consumes("multipart/form-data")]
        [RequestFormLimits(MultipartBodyLengthLimit = 2147483648)] // 2 GB
        [DisableRequestSizeLimit]
        public async Task<IActionResult> Create([FromForm] MediaUploadRequest request)
        {
            try 
            {
                var userId = GetUserId();
                var result = await _service.CreateMediaAsync(request, userId);
                if (result != null)
                {
                    return Ok(ApiResponse<MediaFile>.SuccessResponse(result, "Media uploaded successfully"));
                }
                return BadRequest(ApiResponse<MediaFile>.ErrorResponse(400, "Failed to upload media"));
            }
            catch (Exception ex)
            {
                // In a real production app, we would use an ILogger or ISystemLogRepository here
                // For now, let's just return a clean error message
                return StatusCode(500, ApiResponse<string>.ErrorResponse(500, "An internal server error occurred while uploading."));
            }
        }

        [HttpPut("{id}")]
        [Authorize(Roles = UserRoles.Admin + "," + UserRoles.Editor)]
        public async Task<IActionResult> Update(string id, [FromBody] MediaFile request)
        {
            var userId = GetUserId();
            var success = await _service.UpdateMediaAsync(id, request, userId);
            if (success)
            {
                return Ok(ApiResponse<bool>.SuccessResponse(true, "Media updated successfully"));
            }
            return NotFound(ApiResponse<bool>.ErrorResponse(404, "Media not found or update failed"));
        }

        [HttpDelete("{id}")]
        [Authorize(Roles = UserRoles.Admin + "," + UserRoles.Editor)]
        public async Task<IActionResult> Delete(string id, [FromQuery] bool force = false)
        {
            var userId = GetUserId();
            var result = await _service.DeleteMediaAsync(id, force, userId);
            
            if (result == "SUCCESS")
            {
                return Ok(ApiResponse<bool>.SuccessResponse(true, "Media deleted successfully"));
            }
            else if (result.StartsWith("CANNOT_DELETE_USED"))
            {
                var msg = result.Replace("CANNOT_DELETE_USED: ", "");
                return Conflict(ApiResponse<bool>.ErrorResponse(409, $"Cannot delete active media. Used in: {msg}"));
            }
            
            return NotFound(ApiResponse<bool>.ErrorResponse(404, "Media not found"));
        }

        [HttpGet("{id}/usage")]
        public async Task<IActionResult> GetUsage(string id)
        {
            var data = await _service.GetMediaUsageAsync(id);
            return Ok(ApiResponse<IEnumerable<MediaUsageDto>>.SuccessResponse(data));
        }
        [HttpPost("replace")]
        [Authorize(Roles = UserRoles.Admin + "," + UserRoles.Editor)]
        public async Task<IActionResult> Replace([FromBody] SignageUnicorn.Api.Models.Requests.MediaReplaceRequest request)
        {
            var userId = GetUserId();
            var result = await _service.ReplaceMediaAsync(request.OldMediaId, request.NewMediaId, request.ArchiveOld, userId);
            
            if (result)
            {
                return Ok(ApiResponse<bool>.SuccessResponse(true, "Media replaced successfully"));
            }
            // Check why failed? For now generics error.
            return BadRequest(ApiResponse<bool>.ErrorResponse(400, "Failed to replace media. Verify IDs exist."));
        }
    }
}
