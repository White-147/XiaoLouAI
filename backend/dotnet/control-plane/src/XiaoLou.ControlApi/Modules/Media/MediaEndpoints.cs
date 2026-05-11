using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Options;
using XiaoLou.ControlApi.Modules.Auth;
using XiaoLou.Domain;
using XiaoLou.Infrastructure.Postgres;
using XiaoLou.Infrastructure.Storage;
using static XiaoLou.ControlApi.Modules.Auth.AuthHelpers;

namespace XiaoLou.ControlApi.Modules.Media;

internal static class MediaEndpoints
{
    public static IEndpointRouteBuilder MapMediaEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/media/upload-begin", async (
            UploadBeginRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresMediaStore media,
            CancellationToken ct) =>
        {
            if (AuthorizeAccountScope(httpContext, clientApi.Value, request, requireConfiguredAccountGrant: false) is { } denied)
            {
                return denied;
            }

            return Results.Ok(await media.BeginUploadAsync(request, ct));
        });

        endpoints.MapPost("/api/media/upload-complete", async (
            UploadCompleteRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresMediaStore media,
            CancellationToken ct) =>
        {
            if (AuthorizeAccountScope(httpContext, clientApi.Value, request, requireConfiguredAccountGrant: false) is { } denied)
            {
                return denied;
            }

            var result = await media.CompleteUploadAsync(request, ct);
            return result is null ? Results.NotFound() : Results.Ok(result);
        });

        endpoints.MapPost("/api/media/signed-read-url", async (
            SignedReadUrlRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresMediaStore media,
            CancellationToken ct) =>
        {
            if (AuthorizeAccountScope(httpContext, clientApi.Value, request, requireConfiguredAccountGrant: false) is { } denied)
            {
                return denied;
            }

            var result = await media.GetSignedReadUrlAsync(request, ct);
            return result is null ? Results.NotFound() : Results.Ok(result);
        });

        endpoints.MapPost("/api/media/move-temp-to-permanent", async (
            MoveTempToPermanentRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresMediaStore media,
            CancellationToken ct) =>
        {
            if (AuthorizeAccountScope(httpContext, clientApi.Value, request, requireConfiguredAccountGrant: false) is { } denied)
            {
                return denied;
            }

            var result = await media.MoveTempToPermanentAsync(request, ct);
            return result is null ? Results.NotFound() : Results.Ok(result);
        });

        endpoints.MapGet("/api/media/object-content/{bucket}/{**objectKey}", (
            string bucket,
            string? objectKey,
            HttpContext httpContext,
            IOptions<ObjectStorageOptions> storage) =>
        {
            var normalizedBucket = DecodeRouteValue(bucket).Trim();
            var normalizedObjectKey = DecodeRouteValue(objectKey ?? "").TrimStart('/').Replace('\\', '/');
            if (!IsStableMediaObjectKeyAllowed(normalizedObjectKey))
            {
                return Results.NotFound();
            }

            if (!TryResolveLocalObjectPath(storage.Value, normalizedBucket, normalizedObjectKey, out var filePath))
            {
                return Results.NotFound();
            }

            ApplyLocalObjectCors(httpContext);
            if (!File.Exists(filePath))
            {
                return Results.NotFound();
            }

            return Results.File(
                File.OpenRead(filePath),
                GetContentType(filePath),
                enableRangeProcessing: true);
        });

        endpoints.MapMethods("/{bucket}/{**objectKey}", ["OPTIONS"], (
            string bucket,
            string? objectKey,
            HttpContext httpContext,
            IOptions<ObjectStorageOptions> storage) =>
        {
            if (!CanHandleLocalObjectRequest(storage.Value, bucket, objectKey))
            {
                return Results.NotFound();
            }

            ApplyLocalObjectCors(httpContext);
            return Results.NoContent();
        });

        endpoints.MapPut("/{bucket}/{**objectKey}", async (
            string bucket,
            string? objectKey,
            HttpContext httpContext,
            IOptions<ObjectStorageOptions> storage,
            CancellationToken ct) =>
        {
            if (!TryResolveLocalObjectPath(storage.Value, bucket, objectKey, out var filePath))
            {
                return Results.NotFound();
            }

            ApplyLocalObjectCors(httpContext);
            if (!IsSignedObjectRequestValid(httpContext, "upload"))
            {
                return Results.StatusCode(StatusCodes.Status403Forbidden);
            }

            var directory = Path.GetDirectoryName(filePath);
            if (!string.IsNullOrWhiteSpace(directory))
            {
                Directory.CreateDirectory(directory);
            }

            await using var stream = File.Create(filePath);
            await httpContext.Request.Body.CopyToAsync(stream, ct);
            return Results.Ok(new { uploaded = true });
        });

        endpoints.MapGet("/{bucket}/{**objectKey}", (
            string bucket,
            string? objectKey,
            HttpContext httpContext,
            IOptions<ObjectStorageOptions> storage) =>
        {
            if (!TryResolveLocalObjectPath(storage.Value, bucket, objectKey, out var filePath))
            {
                return Results.NotFound();
            }

            ApplyLocalObjectCors(httpContext);
            if (!IsSignedObjectRequestValid(httpContext, "read"))
            {
                return Results.StatusCode(StatusCodes.Status403Forbidden);
            }

            if (!File.Exists(filePath))
            {
                return Results.NotFound();
            }

            return Results.File(
                File.OpenRead(filePath),
                GetContentType(filePath),
                enableRangeProcessing: true);
        });

        return endpoints;
    }

    private static string DecodeRouteValue(string value)
    {
        try
        {
            return Uri.UnescapeDataString(value);
        }
        catch
        {
            return value;
        }
    }

    private static bool IsStableMediaObjectKeyAllowed(string objectKey)
    {
        return objectKey.StartsWith("media/frontend/", StringComparison.Ordinal)
            || objectKey.StartsWith("media/generated/", StringComparison.Ordinal);
    }

    private static bool CanHandleLocalObjectRequest(ObjectStorageOptions options, string bucket, string? objectKey)
    {
        return LocalObjectStoragePathResolver.CanHandleLocalObjectRequest(options, bucket, objectKey);
    }

    private static bool TryResolveLocalObjectPath(
        ObjectStorageOptions options,
        string bucket,
        string? objectKey,
        out string filePath)
    {
        return LocalObjectStoragePathResolver.TryResolveLocalObjectPath(options, bucket, objectKey, out filePath);
    }

    private static void ApplyLocalObjectCors(HttpContext httpContext)
    {
        var origin = httpContext.Request.Headers.Origin.FirstOrDefault();
        httpContext.Response.Headers.AccessControlAllowOrigin = string.IsNullOrWhiteSpace(origin) ? "*" : origin;
        httpContext.Response.Headers.AccessControlAllowMethods = "GET,PUT,OPTIONS";
        httpContext.Response.Headers.AccessControlAllowHeaders = "Content-Type,Content-Length,Range";
        httpContext.Response.Headers.AccessControlExposeHeaders = "Accept-Ranges,Content-Length,Content-Range";
    }

    private static bool IsSignedObjectRequestValid(HttpContext httpContext, string expectedPurpose)
    {
        var purpose = httpContext.Request.Query["xiaolou_purpose"].FirstOrDefault();
        if (!string.Equals(purpose, expectedPurpose, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var expiresRaw = httpContext.Request.Query["expires"].FirstOrDefault();
        return long.TryParse(expiresRaw, out var expires)
            && DateTimeOffset.UtcNow <= DateTimeOffset.FromUnixTimeSeconds(expires);
    }

    private static string GetContentType(string filePath)
    {
        return Path.GetExtension(filePath).ToLowerInvariant() switch
        {
            ".jpg" or ".jpeg" => "image/jpeg",
            ".png" => "image/png",
            ".webp" => "image/webp",
            ".gif" => "image/gif",
            ".mp4" => "video/mp4",
            ".webm" => "video/webm",
            ".mov" => "video/quicktime",
            ".mp3" => "audio/mpeg",
            ".wav" => "audio/wav",
            ".m4a" => "audio/mp4",
            ".ogg" => "audio/ogg",
            _ => "application/octet-stream",
        };
    }
}
