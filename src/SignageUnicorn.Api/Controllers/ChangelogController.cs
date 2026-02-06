using Microsoft.AspNetCore.Mvc;
using SignageUnicorn.Api.Models.Responses;
using System.IO;
using System.Threading.Tasks;

namespace SignageUnicorn.Api.Controllers
{
    [ApiController]
    [Route("api/v1/changelog")]
    public class ChangelogController : ControllerBase
    {
        private readonly IWebHostEnvironment _env;

        public ChangelogController(IWebHostEnvironment env)
        {
            _env = env;
        }

        [HttpGet]
        public async Task<IActionResult> Get()
        {
            // Path to CHANGELOG.md in the root directory relative to the API
            // docs/CHANGELOG.md
            var rootPath = Path.Combine(_env.ContentRootPath, "..", "..", "docs", "CHANGELOG.md");
            
            if (System.IO.File.Exists(rootPath))
            {
                var content = await System.IO.File.ReadAllTextAsync(rootPath);
                return Ok(ApiResponse<string>.SuccessResponse(content));
            }

            return NotFound(ApiResponse<string>.ErrorResponse(404, "Changelog not found on server"));
        }
    }
}
