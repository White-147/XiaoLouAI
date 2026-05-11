using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging;

namespace XiaoLou.ClosedApiWorker.Vertex;

internal sealed record VertexGeneratedVideo(
    byte[] Bytes,
    string MimeType,
    string OperationName,
    string? GcsUri,
    int RaiMediaFilteredCount,
    IReadOnlyList<string> RaiMediaFilteredReasons);

internal sealed class VertexVeoVideoClient(
    VertexOptions options,
    VertexAccessTokenProvider tokenProvider,
    ILogger<VertexVeoVideoClient> logger)
{
    private static readonly HttpClient HttpClient = new();

    public async Task<VertexGeneratedVideo> GenerateVideoAsync(
        ClosedApiVideoJobRequest request,
        Func<CancellationToken, Task>? heartbeatAsync,
        CancellationToken cancellationToken)
    {
        var rawModel = VertexModelRouting.StripVertexPrefix(request.Model);
        var endpoint = options.BuildPredictLongRunningEndpoint(rawModel);
        var body = await BuildPredictLongRunningRequestAsync(request, cancellationToken);
        var operationName = await StartOperationAsync(endpoint, body, cancellationToken);

        logger.LogInformation(
            "Started Vertex Veo operation {OperationName} for model {Model}.",
            operationName,
            request.Model);

        var deadline = DateTimeOffset.UtcNow.AddSeconds(options.VideoOperationTimeoutSeconds);
        var pollDelay = TimeSpan.FromSeconds(Math.Clamp(options.VideoPollSeconds, 2, 60));
        var fetchEndpoint = options.BuildFetchPredictOperationEndpoint(rawModel);

        while (DateTimeOffset.UtcNow < deadline)
        {
            await Task.Delay(pollDelay, cancellationToken);
            if (heartbeatAsync is not null)
            {
                await heartbeatAsync(cancellationToken);
            }

            var operationJson = await FetchOperationAsync(fetchEndpoint, operationName, cancellationToken);
            using var document = JsonDocument.Parse(operationJson);
            var root = document.RootElement;
            ThrowIfOperationErrored(root);

            var done = root.TryGetProperty("done", out var doneElement)
                && doneElement.ValueKind == JsonValueKind.True;
            if (!done)
            {
                continue;
            }

            return await ReadGeneratedVideoAsync(root, operationName, cancellationToken);
        }

        throw new VertexProviderException(
            $"Vertex Veo operation did not complete within {options.VideoOperationTimeoutSeconds} seconds: {operationName}",
            retry: true);
    }

    private async Task<JsonObject> BuildPredictLongRunningRequestAsync(
        ClosedApiVideoJobRequest request,
        CancellationToken cancellationToken)
    {
        var instance = new JsonObject
        {
            ["prompt"] = request.Prompt.Trim(),
        };

        var firstImageSource = !string.IsNullOrWhiteSpace(request.FirstFrameUrl)
            ? request.FirstFrameUrl
            : request.ReferenceImageUrls.FirstOrDefault();
        if (!string.IsNullOrWhiteSpace(firstImageSource))
        {
            var firstImage = await LoadMediaAsync(firstImageSource, imageOnly: true, cancellationToken);
            instance["image"] = BuildMediaObject(firstImage);
        }

        if (!string.IsNullOrWhiteSpace(request.LastFrameUrl))
        {
            var lastFrame = await LoadMediaAsync(request.LastFrameUrl, imageOnly: true, cancellationToken);
            instance["lastFrame"] = BuildMediaObject(lastFrame);
        }

        if (request.ReferenceImages.Count > 0)
        {
            if (request.Model.Contains("lite", StringComparison.OrdinalIgnoreCase))
            {
                throw new VertexProviderException(
                    "Vertex Veo Lite does not support reference asset images.",
                    retry: false);
            }

            if (!instance.ContainsKey("image") && !instance.ContainsKey("lastFrame"))
            {
                var referenceImages = await BuildReferenceImagesAsync(request.ReferenceImages, cancellationToken);
                if (referenceImages.Count > 0)
                {
                    instance["referenceImages"] = referenceImages;
                }
            }
        }

        var parameters = new JsonObject
        {
            ["durationSeconds"] = NormalizeDurationSeconds(request.Duration),
            ["sampleCount"] = 1,
            ["generateAudio"] = request.GenerateAudio,
        };

        var aspectRatio = NormalizeAspectRatio(request.AspectRatio);
        if (!string.IsNullOrWhiteSpace(aspectRatio))
        {
            parameters["aspectRatio"] = aspectRatio;
        }

        var resolution = NormalizeResolution(request.Resolution, request.Model);
        if (!string.IsNullOrWhiteSpace(resolution))
        {
            parameters["resolution"] = resolution;
        }

        if (instance.ContainsKey("image"))
        {
            parameters["resizeMode"] = "pad";
        }

        if (!string.IsNullOrWhiteSpace(options.VideoOutputStorageUri))
        {
            parameters["storageUri"] = options.VideoOutputStorageUri;
        }

        return new JsonObject
        {
            ["instances"] = new JsonArray(instance),
            ["parameters"] = parameters,
        };
    }

    private static async Task<JsonArray> BuildReferenceImagesAsync(
        IReadOnlyList<ClosedApiReferenceImage> references,
        CancellationToken cancellationToken)
    {
        var referenceImages = new JsonArray();
        foreach (var reference in references.Take(3))
        {
            var media = await LoadMediaAsync(reference.Source, imageOnly: true, cancellationToken);
            referenceImages.Add(new JsonObject
            {
                ["image"] = BuildMediaObject(media),
                ["referenceType"] = NormalizeReferenceType(reference.ReferenceType),
            });
        }

        return referenceImages;
    }

    private async Task<string> StartOperationAsync(
        string endpoint,
        JsonObject body,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint)
        {
            Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json"),
        };
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        await tokenProvider.ApplyAuthAsync(request, cancellationToken);

        var responseText = await SendAsync(request, cancellationToken);
        using var document = JsonDocument.Parse(responseText);
        var name = FirstString(document.RootElement, "name");
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new VertexProviderException("Vertex Veo start response did not include an operation name.", retry: false);
        }

        return name;
    }

    private async Task<string> FetchOperationAsync(
        string endpoint,
        string operationName,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint)
        {
            Content = new StringContent(
                new JsonObject { ["operationName"] = operationName }.ToJsonString(),
                Encoding.UTF8,
                "application/json"),
        };
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        await tokenProvider.ApplyAuthAsync(request, cancellationToken);
        return await SendAsync(request, cancellationToken);
    }

    private async Task<string> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(options.RequestTimeoutSeconds));
        using var response = await HttpClient.SendAsync(request, timeout.Token);
        var responseText = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new VertexProviderException(
                $"Vertex Veo request failed: {(int)response.StatusCode} {Trim(responseText)}",
                retry: ShouldRetry(response.StatusCode));
        }

        return responseText;
    }

    private async Task<VertexGeneratedVideo> ReadGeneratedVideoAsync(
        JsonElement operationRoot,
        string operationName,
        CancellationToken cancellationToken)
    {
        if (!operationRoot.TryGetProperty("response", out var response)
            || response.ValueKind != JsonValueKind.Object)
        {
            throw new VertexProviderException("Vertex Veo operation completed without a response object.", retry: false);
        }

        var filteredCount = response.TryGetProperty("raiMediaFilteredCount", out var filteredElement)
            && filteredElement.TryGetInt32(out var parsedFiltered)
            ? parsedFiltered
            : 0;
        var filteredReasons = ReadStringArray(response, "raiMediaFilteredReasons");

        if (!response.TryGetProperty("videos", out var videos)
            || videos.ValueKind != JsonValueKind.Array
            || videos.GetArrayLength() == 0)
        {
            var reasonText = filteredReasons.Count > 0 ? string.Join("; ", filteredReasons) : "";
            if (filteredCount > 0 || filteredReasons.Count > 0)
            {
                var details = string.IsNullOrWhiteSpace(reasonText)
                    ? ""
                    : $" Provider details: {reasonText}";
                throw new VertexProviderException(
                    "Vertex Veo content filter blocked this request. The prompt or reference image likely contains restricted visual content such as blood, injury, graphic violence, or unsafe action. Try removing blood/gore/injury wording and use non-graphic motion descriptions, for example a character draws a blade and shakes off red lighting or rain instead."
                    + details,
                    retry: false);
            }

            throw new VertexProviderException(
                $"Vertex Veo operation completed without videos. Filtered count: {filteredCount}.",
                retry: false);
        }

        foreach (var video in videos.EnumerateArray())
        {
            var mimeType = NormalizeVideoMimeType(FirstString(video, "mimeType", "mime_type"));
            var bytesBase64 = FirstString(video, "bytesBase64Encoded", "bytes_base64_encoded");
            if (!string.IsNullOrWhiteSpace(bytesBase64))
            {
                return new VertexGeneratedVideo(
                    Convert.FromBase64String(bytesBase64),
                    mimeType,
                    operationName,
                    null,
                    filteredCount,
                    filteredReasons);
            }

            var gcsUri = FirstString(video, "gcsUri", "gcs_uri");
            if (!string.IsNullOrWhiteSpace(gcsUri))
            {
                var bytes = await DownloadGcsObjectAsync(gcsUri, cancellationToken);
                return new VertexGeneratedVideo(
                    bytes,
                    mimeType,
                    operationName,
                    gcsUri,
                    filteredCount,
                    filteredReasons);
            }
        }

        throw new VertexProviderException("Vertex Veo videos did not include bytesBase64Encoded or gcsUri.", retry: false);
    }

    private async Task<byte[]> DownloadGcsObjectAsync(string gcsUri, CancellationToken cancellationToken)
    {
        if (!TryParseGcsUri(gcsUri, out var bucket, out var objectName))
        {
            throw new VertexProviderException($"Vertex Veo returned an invalid GCS URI: {gcsUri}", retry: false);
        }

        var url =
            $"https://storage.googleapis.com/storage/v1/b/{Uri.EscapeDataString(bucket)}/o/{Uri.EscapeDataString(objectName)}?alt=media";
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        await tokenProvider.ApplyAuthAsync(request, cancellationToken);

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(options.RequestTimeoutSeconds));
        using var response = await HttpClient.SendAsync(request, timeout.Token);
        if (!response.IsSuccessStatusCode)
        {
            var responseText = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new VertexProviderException(
                $"Failed to download Vertex Veo output from GCS: {(int)response.StatusCode} {Trim(responseText)}",
                retry: ShouldRetry(response.StatusCode));
        }

        return await response.Content.ReadAsByteArrayAsync(cancellationToken);
    }

    private static async Task<ReferenceMedia> LoadMediaAsync(
        string source,
        bool imageOnly,
        CancellationToken cancellationToken)
    {
        if (source.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
        {
            return ParseDataUrl(source, imageOnly);
        }

        if (!Uri.TryCreate(source, UriKind.Absolute, out var uri)
            || uri.Scheme is not ("http" or "https"))
        {
            throw new VertexProviderException($"Unsupported Vertex media URL: {source}", retry: false);
        }

        using var response = await HttpClient.GetAsync(uri, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new VertexProviderException(
                $"Failed to fetch Vertex media input: {(int)response.StatusCode} {uri}",
                retry: ShouldRetry(response.StatusCode));
        }

        var bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken);
        if (bytes.Length == 0)
        {
            throw new VertexProviderException($"Vertex media input was empty: {uri}", retry: false);
        }

        var mimeType = response.Content.Headers.ContentType?.MediaType;
        return new ReferenceMedia(bytes, NormalizeMimeType(mimeType, uri.AbsolutePath, imageOnly));
    }

    private static ReferenceMedia ParseDataUrl(string source, bool imageOnly)
    {
        var comma = source.IndexOf(',', StringComparison.Ordinal);
        if (comma <= 0)
        {
            throw new VertexProviderException("Invalid data URL media input.", retry: false);
        }

        var metadata = source[5..comma];
        var data = source[(comma + 1)..];
        var isBase64 = metadata.Contains(";base64", StringComparison.OrdinalIgnoreCase);
        var mimeType = metadata.Split(';', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "image/png";
        var bytes = isBase64
            ? Convert.FromBase64String(data)
            : Encoding.UTF8.GetBytes(Uri.UnescapeDataString(data));
        if (bytes.Length == 0)
        {
            throw new VertexProviderException("Vertex data URL media input was empty.", retry: false);
        }

        return new ReferenceMedia(bytes, NormalizeMimeType(mimeType, "", imageOnly));
    }

    private static JsonObject BuildMediaObject(ReferenceMedia media)
    {
        return new JsonObject
        {
            ["bytesBase64Encoded"] = Convert.ToBase64String(media.Bytes),
            ["mimeType"] = media.MimeType,
        };
    }

    private static void ThrowIfOperationErrored(JsonElement root)
    {
        if (!root.TryGetProperty("error", out var error)
            || error.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        var code = error.TryGetProperty("code", out var codeElement)
            && codeElement.TryGetInt32(out var parsedCode)
            ? parsedCode
            : 0;
        var message = FirstString(error, "message") ?? "Vertex Veo operation failed.";
        throw new VertexProviderException(
            $"Vertex Veo operation failed: {code} {message}",
            retry: code is 4 or 8 or 10 or 13 or 14);
    }

    private static int NormalizeDurationSeconds(string? duration)
    {
        var value = duration?.Trim().ToLowerInvariant() ?? "";
        if (value.EndsWith('s'))
        {
            value = value[..^1];
        }

        if (!int.TryParse(value, out var seconds))
        {
            seconds = 8;
        }

        if (seconds is 4 or 6 or 8)
        {
            return seconds;
        }

        throw new VertexProviderException(
            $"Vertex Veo duration {duration} is not supported. Use 4s, 6s, or 8s.",
            retry: false);
    }

    private static string NormalizeAspectRatio(string? aspectRatio)
    {
        var value = aspectRatio?.Trim();
        if (string.IsNullOrWhiteSpace(value))
        {
            return "16:9";
        }

        if (value is "16:9" or "9:16")
        {
            return value;
        }

        throw new VertexProviderException(
            $"Vertex Veo aspect ratio {aspectRatio} is not supported. Use 16:9 or 9:16.",
            retry: false);
    }

    private static string NormalizeResolution(string? resolution, string model)
    {
        var value = resolution?.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(value))
        {
            return "720p";
        }

        if (value is "720p" or "1080p")
        {
            return value;
        }

        if (value == "4k" && !model.Contains("lite", StringComparison.OrdinalIgnoreCase))
        {
            return value;
        }

        throw new VertexProviderException(
            model.Contains("lite", StringComparison.OrdinalIgnoreCase)
                ? $"Vertex Veo Lite resolution {resolution} is not supported. Use 720p or 1080p."
                : $"Vertex Veo resolution {resolution} is not supported. Use 720p, 1080p, or 4k.",
            retry: false);
    }

    private static string NormalizeReferenceType(string? referenceType)
    {
        var value = referenceType?.Trim().ToLowerInvariant();
        return value == "style" ? "style" : "asset";
    }

    private static string NormalizeMimeType(string? mimeType, string path, bool imageOnly)
    {
        var normalized = mimeType?.Trim().ToLowerInvariant();
        if (imageOnly)
        {
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

        return NormalizeVideoMimeType(normalized);
    }

    private static string NormalizeVideoMimeType(string? mimeType)
    {
        var normalized = mimeType?.Trim().ToLowerInvariant();
        return normalized is "video/mp4" or "video/webm" or "video/mov" or "video/mpeg" or "video/mpg"
            ? normalized
            : "video/mp4";
    }

    private static bool TryParseGcsUri(string gcsUri, out string bucket, out string objectName)
    {
        bucket = "";
        objectName = "";
        if (!gcsUri.StartsWith("gs://", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var withoutScheme = gcsUri["gs://".Length..];
        var slash = withoutScheme.IndexOf('/', StringComparison.Ordinal);
        if (slash <= 0 || slash >= withoutScheme.Length - 1)
        {
            return false;
        }

        bucket = withoutScheme[..slash];
        objectName = withoutScheme[(slash + 1)..];
        return !string.IsNullOrWhiteSpace(bucket) && !string.IsNullOrWhiteSpace(objectName);
    }

    private static string? FirstString(JsonElement element, params string[] names)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        foreach (var name in names)
        {
            if (element.TryGetProperty(name, out var value)
                && value.ValueKind == JsonValueKind.String)
            {
                return value.GetString();
            }
        }

        return null;
    }

    private static IReadOnlyList<string> ReadStringArray(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var value)
            || value.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<string>();
        }

        return value.EnumerateArray()
            .Where(item => item.ValueKind == JsonValueKind.String)
            .Select(item => item.GetString())
            .Where(item => !string.IsNullOrWhiteSpace(item))
            .Select(item => item!)
            .ToArray();
    }

    private static bool ShouldRetry(HttpStatusCode statusCode)
    {
        return statusCode == HttpStatusCode.TooManyRequests || (int)statusCode >= 500;
    }

    private static string Trim(string body)
    {
        return body.Length <= 800 ? body : body[..800];
    }

    private sealed record ReferenceMedia(byte[] Bytes, string MimeType);
}
