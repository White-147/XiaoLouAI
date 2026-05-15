using System.Text.Json;

namespace XiaoLou.ClosedApiWorker;

internal sealed record ClosedApiImageJobRequest(
    string JobType,
    string Prompt,
    string Model,
    string? NegativePrompt,
    string AspectRatio,
    string Resolution,
    IReadOnlyList<string> ReferenceImageUrls);

internal sealed record ClosedApiReferenceImage(
    string Source,
    string ReferenceType);

internal sealed record ClosedApiVideoJobRequest(
    string JobType,
    string Prompt,
    string Model,
    string Duration,
    string AspectRatio,
    string Resolution,
    bool GenerateAudio,
    string? VideoMode,
    string? FirstFrameUrl,
    string? LastFrameUrl,
    string? MotionReferenceVideoUrl,
    IReadOnlyList<string> ReferenceImageUrls,
    IReadOnlyList<ClosedApiReferenceImage> ReferenceImages,
    IReadOnlyDictionary<string, IReadOnlyList<string>> MultiReferenceImages,
    IReadOnlyList<string> ReferenceVideoUrls,
    IReadOnlyList<string> ReferenceAudioUrls);

internal sealed record ClosedApiPlaygroundAttachment(
    string Name,
    string? Type,
    long? Size,
    bool ContentTruncated);

internal sealed record ClosedApiPlaygroundChatJobRequest(
    string Message,
    string Model,
    bool ThinkingMode,
    bool WebSearch,
    string? Context,
    string? Mode,
    string? PreferredImageToolId,
    IReadOnlyList<string> AllowedImageToolIds,
    string? PreferredImageAspectRatio,
    IReadOnlyList<ClosedApiPlaygroundAttachment> Attachments);

internal static class ClosedApiJobPayload
{
    private static readonly HashSet<string> ImageJobTypes = new(StringComparer.Ordinal)
    {
        "create_image_generate",
        "storyboard_image_generate",
        "asset_image_generate",
    };

    private static readonly HashSet<string> VideoJobTypes = new(StringComparer.Ordinal)
    {
        "create_video_generate",
    };

    public static bool TryReadImageJob(Dictionary<string, object?> job, out ClosedApiImageJobRequest request)
    {
        request = new ClosedApiImageJobRequest("", "", "", null, "1:1", "", Array.Empty<string>());
        var jobType = job.TryGetValue("job_type", out var jobTypeValue)
            ? jobTypeValue?.ToString()?.Trim() ?? ""
            : "";
        if (!ImageJobTypes.Contains(jobType))
        {
            return false;
        }

        ClosedApiImageJobRequest? parsedRequest = null;
        var parsed = WithPayload(job, element =>
        {
            var prompt = FirstText(element, "prompt", "generationPrompt", "inputSummary", "text");
            var model = FirstText(element, "model", "imageModel", "image_model") ?? "";
            if (string.IsNullOrWhiteSpace(prompt) || string.IsNullOrWhiteSpace(model))
            {
                return false;
            }

            var references = ReadStringArray(element, "referenceImageUrls", "reference_image_urls");
            var singleReference = FirstText(element, "referenceImageUrl", "reference_image_url");
            if (!string.IsNullOrWhiteSpace(singleReference) && !references.Contains(singleReference, StringComparer.Ordinal))
            {
                references.Add(singleReference);
            }

            parsedRequest = new ClosedApiImageJobRequest(
                jobType,
                prompt,
                model.Trim(),
                FirstText(element, "negativePrompt", "negative_prompt"),
                FirstText(element, "aspectRatio", "aspect_ratio") ?? "1:1",
                FirstText(element, "resolution") ?? "",
                references);
            return true;
        });
        if (parsed && parsedRequest is not null)
        {
            request = parsedRequest;
            return true;
        }

        return false;
    }

    public static bool TryReadVideoJob(Dictionary<string, object?> job, out ClosedApiVideoJobRequest request)
    {
        request = new ClosedApiVideoJobRequest(
            "",
            "",
            "",
            "",
            "16:9",
            "",
            false,
            null,
            null,
            null,
            null,
            Array.Empty<string>(),
            Array.Empty<ClosedApiReferenceImage>(),
            new Dictionary<string, IReadOnlyList<string>>(),
            Array.Empty<string>(),
            Array.Empty<string>());

        var jobType = job.TryGetValue("job_type", out var jobTypeValue)
            ? jobTypeValue?.ToString()?.Trim() ?? ""
            : "";
        if (!VideoJobTypes.Contains(jobType))
        {
            return false;
        }

        ClosedApiVideoJobRequest? parsedRequest = null;
        var parsed = WithPayload(job, element =>
        {
            var prompt = FirstText(element, "prompt", "generationPrompt", "inputSummary", "text")
                ?? "Video generation";
            var model = FirstText(element, "model", "videoModel", "video_model")
                ?? "closed-api-video-stub";
            var references = ReadStringArray(element, "referenceImageUrls", "reference_image_urls");
            var singleReference = FirstText(element, "referenceImageUrl", "reference_image_url");
            if (!string.IsNullOrWhiteSpace(singleReference) && !references.Contains(singleReference, StringComparer.Ordinal))
            {
                references.Add(singleReference);
            }
            var videoMode = FirstText(element, "videoMode", "video_mode");
            var firstFrameUrl = FirstText(element, "firstFrameUrl", "first_frame_url");
            if (string.IsNullOrWhiteSpace(firstFrameUrl) && IsSingleReferenceVideoMode(videoMode))
            {
                firstFrameUrl = singleReference ?? references.FirstOrDefault();
            }
            var multiReferenceImages = ReadMultiReferenceImageMap(element);
            var referenceImages = FlattenMultiReferenceImages(multiReferenceImages);

            parsedRequest = new ClosedApiVideoJobRequest(
                jobType,
                prompt,
                model.Trim(),
                FirstText(element, "duration") ?? "",
                FirstText(element, "aspectRatio", "aspect_ratio") ?? "16:9",
                FirstText(element, "resolution") ?? "",
                FirstBool(element, "generateAudio", "generate_audio") ?? false,
                videoMode,
                firstFrameUrl,
                FirstText(element, "lastFrameUrl", "last_frame_url"),
                FirstText(element, "motionReferenceVideoUrl", "motion_reference_video_url"),
                references,
                referenceImages,
                multiReferenceImages,
                ReadStringArray(element, "referenceVideoUrls", "reference_video_urls"),
                ReadStringArray(element, "referenceAudioUrls", "reference_audio_urls"));
            return true;
        });
        if (parsed && parsedRequest is not null)
        {
            request = parsedRequest;
            return true;
        }

        return false;
    }

    public static bool TryReadPlaygroundChatJob(
        Dictionary<string, object?> job,
        out ClosedApiPlaygroundChatJobRequest request)
    {
        request = new ClosedApiPlaygroundChatJobRequest(
            "",
            "",
            false,
            false,
            null,
            null,
            null,
            Array.Empty<string>(),
            null,
            Array.Empty<ClosedApiPlaygroundAttachment>());

        var jobType = job.TryGetValue("job_type", out var jobTypeValue)
            ? jobTypeValue?.ToString()?.Trim() ?? ""
            : "";
        if (!string.Equals(jobType, "playground_chat", StringComparison.Ordinal))
        {
            return false;
        }

        ClosedApiPlaygroundChatJobRequest? parsedRequest = null;
        var parsed = WithPayload(job, element =>
        {
            var message = FirstText(element, "message", "inputSummary", "text");
            if (string.IsNullOrWhiteSpace(message))
            {
                return false;
            }

            parsedRequest = new ClosedApiPlaygroundChatJobRequest(
                message,
                FirstText(element, "model") ?? "qwen-plus",
                FirstBool(element, "thinkingMode", "thinking_mode") ?? false,
                FirstBool(element, "webSearch", "web_search") ?? false,
                FirstText(element, "context"),
                FirstText(element, "mode"),
                FirstText(element, "preferredImageToolId", "preferred_image_tool_id"),
                ReadStringArray(element, "allowedImageToolIds", "allowed_image_tool_ids"),
                FirstText(element, "preferredImageAspectRatio", "preferred_image_aspect_ratio"),
                ReadPlaygroundAttachments(element));
            return true;
        });
        if (parsed && parsedRequest is not null)
        {
            request = parsedRequest;
            return true;
        }

        return false;
    }

    private static bool IsSingleReferenceVideoMode(string? videoMode)
    {
        var mode = videoMode?.Trim().Replace("-", "_").ToLowerInvariant();
        return string.IsNullOrWhiteSpace(mode) ||
            mode is "image_to_video" or "single_reference";
    }

    private static Dictionary<string, IReadOnlyList<string>> ReadMultiReferenceImageMap(JsonElement element)
    {
        var references = new Dictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal);
        if (element.ValueKind != JsonValueKind.Object
            || !element.TryGetProperty("multiReferenceImages", out var multiReferenceImages)
            || multiReferenceImages.ValueKind != JsonValueKind.Object)
        {
            return references;
        }

        foreach (var property in multiReferenceImages.EnumerateObject())
        {
            var values = ReadMultiReferenceValue(property.Value);
            if (values.Count > 0)
            {
                references[property.Name] = values;
            }
        }

        return references;
    }

    private static List<string> ReadMultiReferenceValue(JsonElement value)
    {
        var sources = new List<string>();
        if (value.ValueKind == JsonValueKind.String)
        {
            AddMultiReferenceSource(value.GetString(), sources);
            return sources;
        }

        if (value.ValueKind != JsonValueKind.Array)
        {
            return sources;
        }

        foreach (var item in value.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.String)
            {
                AddMultiReferenceSource(item.GetString(), sources);
            }
        }

        return sources;
    }

    private static List<ClosedApiReferenceImage> FlattenMultiReferenceImages(
        IReadOnlyDictionary<string, IReadOnlyList<string>> references)
    {
        var flattened = new List<ClosedApiReferenceImage>();
        foreach (var source in references.Values.SelectMany(value => value))
        {
            if (!flattened.Any(item => string.Equals(item.Source, source, StringComparison.Ordinal)))
            {
                flattened.Add(new ClosedApiReferenceImage(source, "asset"));
            }
        }

        return flattened;
    }

    private static void AddMultiReferenceSource(
        string? source,
        List<string> references)
    {
        var normalized = source?.Trim();
        if (string.IsNullOrWhiteSpace(normalized)
            || references.Contains(normalized, StringComparer.Ordinal))
        {
            return;
        }

        references.Add(normalized);
    }

    private static IReadOnlyList<ClosedApiPlaygroundAttachment> ReadPlaygroundAttachments(JsonElement element)
    {
        var attachments = new List<ClosedApiPlaygroundAttachment>();
        if (element.ValueKind != JsonValueKind.Object
            || !element.TryGetProperty("attachments", out var property)
            || property.ValueKind != JsonValueKind.Array)
        {
            return attachments;
        }

        foreach (var item in property.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var index = attachments.Count + 1;
            attachments.Add(new ClosedApiPlaygroundAttachment(
                FirstText(item, "name") ?? $"attachment-{index}",
                FirstText(item, "type"),
                FirstLong(item, "size"),
                FirstBool(item, "contentTruncated", "content_truncated") ?? false));
        }

        return attachments;
    }

    public static bool PayloadRequestsFailure(Dictionary<string, object?> job)
    {
        return WithPayload(job, element =>
            element.ValueKind == JsonValueKind.Object
            && element.TryGetProperty("forceFail", out var forceFail)
            && forceFail.ValueKind == JsonValueKind.True);
    }

    private static bool WithPayload(Dictionary<string, object?> job, Func<JsonElement, bool> callback)
    {
        if (!job.TryGetValue("payload", out var payload) || payload is null)
        {
            return false;
        }

        if (payload is JsonDocument document)
        {
            return callback(document.RootElement);
        }

        if (payload is JsonElement element)
        {
            return callback(element);
        }

        var text = payload.ToString();
        if (string.IsNullOrWhiteSpace(text))
        {
            return false;
        }

        using var parsed = JsonDocument.Parse(text);
        return callback(parsed.RootElement);
    }

    private static string? FirstText(JsonElement element, params string[] names)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        foreach (var name in names)
        {
            if (element.TryGetProperty(name, out var property)
                && property.ValueKind == JsonValueKind.String)
            {
                var value = property.GetString()?.Trim();
                if (!string.IsNullOrWhiteSpace(value))
                {
                    return value;
                }
            }
        }

        return null;
    }

    private static List<string> ReadStringArray(JsonElement element, params string[] names)
    {
        var values = new List<string>();
        if (element.ValueKind != JsonValueKind.Object)
        {
            return values;
        }

        foreach (var name in names)
        {
            if (!element.TryGetProperty(name, out var property))
            {
                continue;
            }

            if (property.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in property.EnumerateArray())
                {
                    if (item.ValueKind != JsonValueKind.String)
                    {
                        continue;
                    }

                    var value = item.GetString()?.Trim();
                    if (!string.IsNullOrWhiteSpace(value) && !values.Contains(value, StringComparer.Ordinal))
                    {
                        values.Add(value);
                    }
                }
            }
            else if (property.ValueKind == JsonValueKind.String)
            {
                var value = property.GetString()?.Trim();
                if (!string.IsNullOrWhiteSpace(value) && !values.Contains(value, StringComparer.Ordinal))
                {
                    values.Add(value);
                }
            }
        }

        return values;
    }

    private static bool? FirstBool(JsonElement element, params string[] names)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        foreach (var name in names)
        {
            if (!element.TryGetProperty(name, out var value))
            {
                continue;
            }

            if (value.ValueKind is JsonValueKind.True or JsonValueKind.False)
            {
                return value.GetBoolean();
            }

            if (value.ValueKind == JsonValueKind.String
                && bool.TryParse(value.GetString(), out var parsed))
            {
                return parsed;
            }
        }

        return null;
    }

    private static long? FirstLong(JsonElement element, params string[] names)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        foreach (var name in names)
        {
            if (!element.TryGetProperty(name, out var value))
            {
                continue;
            }

            if (value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var number))
            {
                return number;
            }

            if (value.ValueKind == JsonValueKind.String
                && long.TryParse(value.GetString(), out var parsed))
            {
                return parsed;
            }
        }

        return null;
    }
}
