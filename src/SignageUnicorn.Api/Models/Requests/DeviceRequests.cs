using System.ComponentModel.DataAnnotations;

namespace SignageUnicorn.Api.Models.Requests
{
    public class CreateDeviceRequest
    {
        [Required]
        [StringLength(255)]
        public string DeviceName { get; set; } = string.Empty;

        [Required]
        [StringLength(100)]
        public string Username { get; set; } = string.Empty;

        [Required]
        [StringLength(255)]
        public string Password { get; set; } = string.Empty;

        [StringLength(255)]
        public string? Location { get; set; }

        [StringLength(50)]
        public string? Ratio { get; set; }
    }

    public class UpdateDeviceRequest
    {
        [StringLength(255)]
        public string? DeviceName { get; set; }

        [StringLength(255)]
        public string? Location { get; set; }

        [StringLength(50)]
        public string? Ratio { get; set; }

        [StringLength(1)]
        public string? Status { get; set; }
    }
}
