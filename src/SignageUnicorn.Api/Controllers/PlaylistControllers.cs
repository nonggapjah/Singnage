using Microsoft.AspNetCore.Mvc;
using SignageUnicorn.Api.Models.Domain;
using SignageUnicorn.Api.Models.Responses;
using SignageUnicorn.Api.Services.Application;

namespace SignageUnicorn.Api.Controllers
{
    using Microsoft.AspNetCore.Authorization;
    using SignageUnicorn.Api.Constants;
    [ApiController]
    [Route("api/v1/playlists")]
    [Authorize]
    public class PlaylistController : ControllerBase
    {
        private readonly PlaylistService _playlistService;
        public PlaylistController(PlaylistService playlistService) => _playlistService = playlistService;

        private long? GetUserId()
        {
            var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
            if (long.TryParse(userIdClaim, out var userId)) return userId;
            return null;
        }

        [HttpGet]
        public async Task<ActionResult<ApiResponse<List<PlaylistDto>>>> GetAll([FromQuery] bool onlyActive = false, [FromQuery] string? searchTerm = null)
        {
            var playlists = await _playlistService.GetAllPlaylistsAsync(onlyActive, searchTerm);
            return Ok(ApiResponse<List<PlaylistDto>>.SuccessResponse(playlists));
        }

        [HttpGet("active")]
        [AllowAnonymous]
        public async Task<ActionResult<ApiResponse<List<PlaylistDto>>>> GetActive()
        {
            var playlists = await _playlistService.GetAllPlaylistsAsync(true);
            return Ok(ApiResponse<List<PlaylistDto>>.SuccessResponse(playlists));
        }

        [HttpGet("{id}")]
        [AllowAnonymous]
        public async Task<ActionResult<ApiResponse<PlaylistDto>>> GetById(string id)
        {
            var playlist = await _playlistService.GetPlaylistByIdAsync(id);
            if (playlist == null) return NotFound(ApiResponse<PlaylistDto>.ErrorResponse(404, "Playlist not found"));
            return Ok(ApiResponse<PlaylistDto>.SuccessResponse(playlist));
        }

        [HttpPost]
        [Authorize(Roles = UserRoles.Admin + "," + UserRoles.Editor)]
        public async Task<ActionResult<ApiResponse<PlaylistDto>>> Create([FromBody] PlaylistDto playlist)
        {
            var userId = GetUserId();
            var success = await _playlistService.CreatePlaylistAsync(playlist, userId);
            if (!success) return BadRequest(ApiResponse<PlaylistDto>.ErrorResponse(400, "Could not create playlist"));
            return CreatedAtAction(nameof(GetById), new { id = playlist.PlaylistId }, ApiResponse<PlaylistDto>.SuccessResponse(playlist));
        }

        [HttpPut("{id}")]
        [Authorize(Roles = UserRoles.Admin + "," + UserRoles.Editor)]
        public async Task<ActionResult<ApiResponse<bool>>> Update(string id, [FromBody] PlaylistDto playlist)
        {
            try
            {
                var userId = GetUserId();
                var success = await _playlistService.UpdatePlaylistAsync(id, playlist, userId);
                if (!success) return BadRequest(ApiResponse<bool>.ErrorResponse(400, "Could not update playlist"));
                return Ok(ApiResponse<bool>.SuccessResponse(true));
            }
            catch (Exception ex)
            {
                return StatusCode(500, ApiResponse<string>.ErrorResponse(500, $"Update Error: {ex.Message}"));
            }
        }

        [HttpPost("{id}/items")]
        [Authorize(Roles = UserRoles.Admin + "," + UserRoles.Editor)]
        public async Task<ActionResult<ApiResponse<bool>>> AddItem(string id, [FromBody] PlaylistItemDto item)
        {
            var userId = GetUserId();
            var success = await _playlistService.AddPlaylistItemAsync(id, item.MediaId, item.PositionOrder, item.DurationOverride, userId);
            if (!success) return BadRequest(ApiResponse<bool>.ErrorResponse(400, "Could not add item to playlist"));
            return Ok(ApiResponse<bool>.SuccessResponse(true));
        }

        [HttpDelete("items/{itemId}")]
        [Authorize(Roles = UserRoles.Admin + "," + UserRoles.Editor)]
        public async Task<ActionResult<ApiResponse<bool>>> RemoveItem(string itemId)
        {
            var userId = GetUserId();
            var success = await _playlistService.RemovePlaylistItemAsync(itemId, userId);
            if (!success) return BadRequest(ApiResponse<bool>.ErrorResponse(400, "Could not remove item from playlist"));
            return Ok(ApiResponse<bool>.SuccessResponse(true));
        }

        [HttpPatch("items/{itemId}/reorder")]
        [Authorize(Roles = UserRoles.Admin + "," + UserRoles.Editor)]
        public async Task<ActionResult<ApiResponse<bool>>> ReorderItem(string itemId, [FromBody] int newPosition)
        {
            var userId = GetUserId();
            var success = await _playlistService.ReorderPlaylistItemAsync(itemId, newPosition, userId);
            if (!success) return BadRequest(ApiResponse<bool>.ErrorResponse(400, "Could not reorder item"));
            return Ok(ApiResponse<bool>.SuccessResponse(true));
        }
        [HttpDelete("{id}")]
        [Authorize(Roles = UserRoles.Admin + "," + UserRoles.Editor)]
        public async Task<ActionResult<ApiResponse<bool>>> Delete(string id)
        {
            var userId = GetUserId();
            var success = await _playlistService.DeletePlaylistAsync(id, userId);
            if (!success) return BadRequest(ApiResponse<bool>.ErrorResponse(400, "Could not delete playlist"));
            return Ok(ApiResponse<bool>.SuccessResponse(true));
        }





    }
}
