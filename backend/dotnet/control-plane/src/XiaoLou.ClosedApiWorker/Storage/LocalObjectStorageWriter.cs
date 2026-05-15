using Microsoft.Extensions.Options;
using XiaoLou.ClosedApiWorker.Vertex;
using XiaoLou.Infrastructure.Storage;

namespace XiaoLou.ClosedApiWorker.Storage;

internal sealed record StoredObject(
    string Bucket,
    string ObjectKey,
    string Url,
    string? UrlPath,
    string Provider,
    DateTimeOffset ExpiresAt,
    string MimeType);

internal sealed class LocalObjectStorageWriter(
    IOptions<ObjectStorageOptions> options,
    IObjectStorageSigner signer)
{
    private readonly ObjectStorageOptions _options = options.Value;

    public async Task<StoredObject> WriteGeneratedMediaAsync(
        Guid jobId,
        string model,
        string mimeType,
        byte[] bytes,
        CancellationToken cancellationToken)
    {
        if (!LocalObjectStoragePathResolver.IsLocalObjectStorage(_options))
        {
            throw new VertexProviderException(
                "ClosedApiWorker currently supports generated media writes only when ObjectStorage:Provider is local.",
                retry: false);
        }

        var normalizedMime = NormalizeMimeType(mimeType);
        var bucket = string.IsNullOrWhiteSpace(_options.Bucket) ? "xiaolou-prod" : _options.Bucket.Trim();
        var objectKey = BuildObjectKey(jobId, model, normalizedMime);
        if (!LocalObjectStoragePathResolver.TryResolveLocalObjectPath(_options, bucket, objectKey, out var filePath))
        {
            throw new VertexProviderException(
                "Could not resolve a safe local object storage path for generated media.",
                retry: false);
        }

        var directory = Path.GetDirectoryName(filePath);
        if (!string.IsNullOrWhiteSpace(directory))
        {
            Directory.CreateDirectory(directory);
        }

        await File.WriteAllBytesAsync(filePath, bytes, cancellationToken);
        var signed = signer.SignRead(bucket, objectKey, TimeSpan.FromDays(7));
        return new StoredObject(
            bucket,
            objectKey,
            signed.Url,
            signed.LocalObjectContentPath,
            signed.Provider,
            signed.ExpiresAt,
            normalizedMime);
    }

    private string BuildObjectKey(Guid jobId, string model, string mimeType)
    {
        var prefix = NormalizePrefix(_options.PermanentPrefix, "media");
        var safeModel = SanitizePathSegment(model);
        var extension = mimeType switch
        {
            "image/jpeg" => ".jpg",
            "image/webp" => ".webp",
            "video/mp4" => ".mp4",
            "video/webm" => ".webm",
            _ => ".png",
        };
        var mediaPath = mimeType.StartsWith("video/", StringComparison.Ordinal)
            ? "closed-api/videos"
            : "vertex/images";
        return $"{prefix}/generated/{mediaPath}/{DateTimeOffset.UtcNow:yyyy/MM/dd}/{jobId:N}-{safeModel}{extension}";
    }

    private static string NormalizePrefix(string? value, string fallback)
    {
        var prefix = string.IsNullOrWhiteSpace(value) ? fallback : value.Trim().Replace('\\', '/');
        return string.Join(
            '/',
            prefix.Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Where(segment => segment is not "." and not ".."));
    }

    private static string SanitizePathSegment(string value)
    {
        var chars = value.Trim().ToLowerInvariant()
            .Select(ch => char.IsLetterOrDigit(ch) ? ch : '-')
            .ToArray();
        var compact = new string(chars).Trim('-');
        return string.IsNullOrWhiteSpace(compact) ? "vertex-image" : compact[..Math.Min(compact.Length, 80)];
    }

    private static string NormalizeMimeType(string? mimeType)
    {
        return mimeType?.Trim().ToLowerInvariant() switch
        {
            "image/jpeg" => "image/jpeg",
            "image/webp" => "image/webp",
            "video/mp4" => "video/mp4",
            "video/webm" => "video/webm",
            _ => "image/png",
        };
    }
}
