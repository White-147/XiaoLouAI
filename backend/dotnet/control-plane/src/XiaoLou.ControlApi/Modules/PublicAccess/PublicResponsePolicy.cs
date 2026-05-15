using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Primitives;

namespace XiaoLou.ControlApi.Modules.PublicAccess;

internal static class PublicResponsePolicy
{
    private const int MetadataMaxAgeSeconds = 30;
    private const int MetadataStaleWhileRevalidateSeconds = 120;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly HashSet<string> StableMetadataPaths = new(StringComparer.OrdinalIgnoreCase)
    {
        "/api/capabilities",
        "/api/toolbox",
        "/api/toolbox/capabilities",
        "/api/playground/models",
    };

    internal static bool IsStableMetadataRequest(HttpContext context)
    {
        return HttpMethods.IsGet(context.Request.Method)
            && IsStableMetadataPath(context.Request.Path)
            && !context.Request.Headers.ContainsKey("Range");
    }

    internal static bool IsStableMetadataPath(PathString path)
    {
        return path.Value is not null && StableMetadataPaths.Contains(path.Value);
    }

    internal static IResult StableJson<T>(T value)
    {
        return new StableJsonResult<T>(value);
    }

    private sealed class StableJsonResult<T>(T value) : IResult
    {
        public async Task ExecuteAsync(HttpContext httpContext)
        {
            var payload = JsonSerializer.SerializeToUtf8Bytes(value, JsonOptions);
            var etag = CreateWeakEtag(payload);

            ApplyStableMetadataHeaders(httpContext.Response, etag);
            if (HasMatchingEtag(httpContext.Request.Headers.IfNoneMatch, etag))
            {
                httpContext.Response.StatusCode = StatusCodes.Status304NotModified;
                return;
            }

            httpContext.Response.StatusCode = StatusCodes.Status200OK;
            httpContext.Response.ContentType = "application/json; charset=utf-8";
            await httpContext.Response.Body.WriteAsync(payload, httpContext.RequestAborted);
        }
    }

    private static void ApplyStableMetadataHeaders(HttpResponse response, string etag)
    {
        response.Headers.CacheControl =
            $"private, max-age={MetadataMaxAgeSeconds}, stale-while-revalidate={MetadataStaleWhileRevalidateSeconds}";
        response.Headers.ETag = etag;
        response.Headers.Vary = "Accept-Encoding, Authorization, X-XiaoLou-Client-Token, X-XiaoLou-Client-Assertion";
    }

    private static string CreateWeakEtag(ReadOnlySpan<byte> payload)
    {
        Span<byte> hash = stackalloc byte[SHA256.HashSizeInBytes];
        SHA256.HashData(payload, hash);
        return $"W/\"{Convert.ToHexString(hash).ToLowerInvariant()}\"";
    }

    private static bool HasMatchingEtag(StringValues ifNoneMatch, string etag)
    {
        foreach (var rawHeader in ifNoneMatch)
        {
            if (string.IsNullOrWhiteSpace(rawHeader))
            {
                continue;
            }

            foreach (var rawToken in rawHeader.Split(','))
            {
                var token = rawToken.Trim();
                if (token == "*" || string.Equals(token, etag, StringComparison.Ordinal))
                {
                    return true;
                }
            }
        }

        return false;
    }
}
