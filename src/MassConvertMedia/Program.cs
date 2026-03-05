using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Xabe.FFmpeg;

namespace MassConvertMedia
{
    class Program
    {
        static async Task Main(string[] args)
        {
            try
            {
                string mediaPath = @"c:\git\Signage-Unicorn\src\SignageUnicorn.Api\wwwroot\media";
                string ffmpegPath = @"c:\git\Signage-Unicorn\src\SignageUnicorn.Api\ffmpeg";
                
                FFmpeg.SetExecutablesPath(ffmpegPath);
                
                var files = Directory.GetFiles(mediaPath, "*.mp4")
                            .Concat(Directory.GetFiles(mediaPath, "*.mov"))
                            .Concat(Directory.GetFiles(mediaPath, "*.webm"))
                            .ToList();

                Console.WriteLine($"Found {files.Count} files to check in: {mediaPath}");

                foreach (var file in files)
                {
                    try
                    {
                        string fileName = Path.GetFileName(file);
                        if (fileName.Contains(".fixed.mp4")) continue;

                        Console.WriteLine($"\n[ {DateTime.Now.ToLongTimeString()} ] Processing: {fileName}");
                        var mediaInfo = await FFmpeg.GetMediaInfo(file);
                        var videoStream = mediaInfo.VideoStreams.FirstOrDefault();

                        if (videoStream == null) {
                            Console.WriteLine("  Skipping: No video stream found.");
                            continue;
                        }

                        string outputPath = file + ".fixed.mp4";
                        if (File.Exists(outputPath)) File.Delete(outputPath);

                        Console.WriteLine($"  Converting to Baseline H.264...");
                        
                        var conversion = FFmpeg.Conversions.New()
                            .AddStream(videoStream.SetCodec(VideoCodec.h264))
                            .AddParameter("-profile:v baseline -level 3.0 -pix_fmt yuv420p -movflags +faststart");

                        var audioStream = mediaInfo.AudioStreams.FirstOrDefault();
                        if (audioStream != null)
                        {
                            conversion.AddStream(audioStream.SetCodec(AudioCodec.aac).SetBitrate(128000));
                        }

                        conversion.SetOutput(outputPath);
                        await conversion.Start();

                        // Swap
                        File.Delete(file);
                        File.Move(outputPath, file);
                        
                        Console.WriteLine($"  SUCCESS: {fileName} is now baseline compatible.");
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"  ERROR processing {file}: {ex.Message}");
                    }
                }
                
                Console.WriteLine("\nMass Refresh Completed!");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Fatal Error: {ex}");
            }
        }
    }
}
