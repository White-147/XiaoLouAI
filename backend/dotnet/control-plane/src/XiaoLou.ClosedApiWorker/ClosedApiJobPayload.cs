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

internal static class ClosedApiJobPayload
{
    private static readonly HashSet<string> ImageJobTypes = new(StringComparer.Ordinal)
    {
        "create_image_generate",
        "storyboard_image_generate",
        "asset_image_generate",
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
}
