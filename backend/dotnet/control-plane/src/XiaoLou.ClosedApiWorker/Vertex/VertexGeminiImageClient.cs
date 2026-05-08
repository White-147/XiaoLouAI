using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging;

namespace XiaoLou.ClosedApiWorker.Vertex;

internal sealed record VertexGeneratedImage(byte[] Bytes, string MimeType, string? TextSummary);

internal sealed class VertexGeminiImageClient(
    VertexOptions options,
    VertexAccessTokenProvider tokenProvider,
    ILogger<VertexGeminiImageClient> logger)
{
    private static readonly HttpClient HttpClient = new();

    public async Task<VertexGeneratedImage> GenerateImageAsync(
        ClosedApiImageJobRequest request,
        CancellationToken cancellationToken)
    {
        var rawModel = VertexModelRouting.StripVertexPrefix(request.Model);
        var endpoint = options.BuildGenerateContentEndpoint(rawModel);
        var body = await BuildGenerateContentRequestAsync(request, cancellationToken);
        using var httpRequest = new HttpRequestMessage(HttpMethod.Post, endpoint)
        {
            Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json"),
        };
        httpRequest.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        await tokenProvider.ApplyAuthAsync(httpRequest, cancellationToken);

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(options.RequestTimeoutSeconds));
        using var response = await HttpClient.SendAsync(httpRequest, timeout.Token);
        var responseText = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new VertexProviderException(
                $"Vertex image generation failed: {(int)response.StatusCode} {Trim(responseText)}",
                retry: ShouldRetry(response.StatusCode));
        }

        var generated = ParseGenerateContentResponse(responseText);
        logger.LogInformation(
            "Vertex image generation succeeded with mime type {MimeType} and {ByteCount} bytes.",
            generated.MimeType,
            generated.Bytes.Length);
        return generated;
    }

    private async Task<JsonObject> BuildGenerateContentRequestAsync(
        ClosedApiImageJobRequest request,
        CancellationToken cancellationToken)
    {
        var prompt = request.Prompt.Trim();
        if (!string.IsNullOrWhiteSpace(request.NegativePrompt))
        {
            prompt = $"{prompt}\n\nAvoid: {request.NegativePrompt.Trim()}";
        }

        var parts = new JsonArray
        {
            new JsonObject { ["text"] = prompt },
        };
        foreach (var reference in request.ReferenceImageUrls.Take(Math.Max(0, options.ReferenceImageLimit)))
        {
            var image = await LoadReferenceImageAsync(reference, cancellationToken);
            parts.Add(new JsonObject
            {
                ["inlineData"] = new JsonObject
                {
                    ["mimeType"] = image.MimeType,
                    ["data"] = Convert.ToBase64String(image.Bytes),
                },
            });
        }

        var generationConfig = new JsonObject
        {
            ["responseModalities"] = new JsonArray("TEXT", "IMAGE"),
            ["candidateCount"] = 1,
        };
        var aspectRatio = NormalizeAspectRatio(request.AspectRatio);
        if (!string.IsNullOrWhiteSpace(aspectRatio))
        {
            generationConfig["imageConfig"] = new JsonObject
            {
                ["aspectRatio"] = aspectRatio,
            };
        }

        return new JsonObject
        {
            ["contents"] = new JsonArray
            {
                new JsonObject
                {
                    ["role"] = "USER",
                    ["parts"] = parts,
                },
            },
            ["generationConfig"] = generationConfig,
        };
    }

    private static VertexGeneratedImage ParseGenerateContentResponse(string responseText)
    {
        using var document = JsonDocument.Parse(responseText);
        if (!document.RootElement.TryGetProperty("candidates", out var candidates)
            || candidates.ValueKind != JsonValueKind.Array)
        {
            throw new VertexProviderException("Vertex response did not include candidates.", retry: false);
        }

        var textSummary = new List<string>();
        foreach (var candidate in candidates.EnumerateArray())
        {
            if (!candidate.TryGetProperty("content", out var content)
                || !content.TryGetProperty("parts", out var parts)
                || parts.ValueKind != JsonValueKind.Array)
            {
                continue;
            }

            foreach (var part in parts.EnumerateArray())
            {
                if (part.TryGetProperty("text", out var textElement)
                    && textElement.ValueKind == JsonValueKind.String)
                {
                    var text = textElement.GetString();
                    if (!string.IsNullOrWhiteSpace(text))
                    {
                        textSummary.Add(text.Trim());
                    }
                }

                if (TryReadInlineData(part, out var bytes, out var mimeType))
                {
                    return new VertexGeneratedImage(bytes, mimeType, textSummary.Count == 0 ? null : string.Join("\n", textSummary));
                }
            }
        }

        throw new VertexProviderException("Vertex response did not include image inlineData.", retry: false);
    }

    private static bool TryReadInlineData(JsonElement part, out byte[] bytes, out string mimeType)
    {
        bytes = Array.Empty<byte>();
        mimeType = "image/png";
        if (!part.TryGetProperty("inlineData", out var inlineData)
            && !part.TryGetProperty("inline_data", out inlineData))
        {
            return false;
        }

        var data = inlineData.TryGetProperty("data", out var dataElement)
            && dataElement.ValueKind == JsonValueKind.String
            ? dataElement.GetString()
            : null;
        if (string.IsNullOrWhiteSpace(data))
        {
            return false;
        }

        if (inlineData.TryGetProperty("mimeType", out var mimeElement)
            && mimeElement.ValueKind == JsonValueKind.String)
        {
            mimeType = mimeElement.GetString() ?? mimeType;
        }
        else if (inlineData.TryGetProperty("mime_type", out var snakeMimeElement)
            && snakeMimeElement.ValueKind == JsonValueKind.String)
        {
            mimeType = snakeMimeElement.GetString() ?? mimeType;
        }

        bytes = Convert.FromBase64String(data);
        return bytes.Length > 0;
    }

    private static async Task<ReferenceImage> LoadReferenceImageAsync(
        string source,
        CancellationToken cancellationToken)
    {
        if (source.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
        {
            return ParseDataUrl(source);
        }

        if (!Uri.TryCreate(source, UriKind.Absolute, out var uri)
            || uri.Scheme is not ("http" or "https"))
        {
            throw new VertexProviderException($"Unsupported reference image URL for Vertex generation: {source}", retry: false);
        }

        using var response = await HttpClient.GetAsync(uri, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new VertexProviderException(
                $"Failed to fetch Vertex reference image: {(int)response.StatusCode} {uri}",
                retry: ShouldRetry(response.StatusCode));
        }

        var bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken);
        if (bytes.Length == 0)
        {
            throw new VertexProviderException($"Reference image was empty: {uri}", retry: false);
        }

        var mimeType = response.Content.Headers.ContentType?.MediaType;
        return new ReferenceImage(bytes, NormalizeImageMimeType(mimeType, uri.AbsolutePath));
    }

    private static ReferenceImage ParseDataUrl(string source)
    {
        var comma = source.IndexOf(',', StringComparison.Ordinal);
        if (comma <= 0)
        {
            throw new VertexProviderException("Invalid data URL reference image.", retry: false);
        }

        var metadata = source[5..comma];
        var data = source[(comma + 1)..];
        var isBase64 = metadata.Contains(";base64", StringComparison.OrdinalIgnoreCase);
        var mimeType = metadata.Split(';', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "image/png";
        var bytes = isBase64
            ? Convert.FromBase64String(data)
            : Encoding.UTF8.GetBytes(Uri.UnescapeDataString(data));
        return new ReferenceImage(bytes, NormalizeImageMimeType(mimeType, ""));
    }

    private static string NormalizeImageMimeType(string? mimeType, string path)
    {
        var normalized = mimeType?.Trim().ToLowerInvariant();
        if (normalized is "image/jpeg" or "image/png" or "image/webp")
        {
            return normalized;
        }

        return Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".jpg" or ".jpeg" => "image/jpeg",
            ".webp" => "image/webp",
            _ => "image/png",
        };
    }

    private static string? NormalizeAspectRatio(string? aspectRatio)
    {
        var value = aspectRatio?.Trim();
        return value is "1:1" or "3:4" or "4:3" or "9:16" or "16:9"
            ? value
            : null;
    }

    private static bool ShouldRetry(HttpStatusCode statusCode)
    {
        return statusCode == HttpStatusCode.TooManyRequests || (int)statusCode >= 500;
    }

    private static string Trim(string body)
    {
        return body.Length <= 800 ? body : body[..800];
    }

    private sealed record ReferenceImage(byte[] Bytes, string MimeType);
}
