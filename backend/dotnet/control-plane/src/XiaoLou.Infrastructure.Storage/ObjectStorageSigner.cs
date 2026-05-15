using Microsoft.Extensions.Options;

namespace XiaoLou.Infrastructure.Storage;

public sealed class ObjectStorageSigner(IOptions<ObjectStorageOptions> options) : IObjectStorageSigner
{
    private readonly ObjectStorageOptions _options = options.Value;

    public SignedObjectUrl SignUpload(string bucket, string objectKey, TimeSpan expiresIn)
    {
        return Sign("upload", bucket, objectKey, expiresIn);
    }

    public SignedObjectUrl SignRead(string bucket, string objectKey, TimeSpan expiresIn)
    {
        return Sign("read", bucket, objectKey, expiresIn);
    }

    private SignedObjectUrl Sign(string purpose, string bucket, string objectKey, TimeSpan expiresIn)
    {
        var expiresAt = DateTimeOffset.UtcNow.Add(expiresIn);
        var normalizedBucket = LocalObjectStorageUrlPolicy.NormalizeBucket(_options, bucket);
        var normalizedKey = LocalObjectStorageUrlPolicy.NormalizeObjectKey(objectKey);
        if (LocalObjectStoragePathResolver.IsLocalObjectStorage(_options))
        {
            var routePath = string.Equals(purpose, "upload", StringComparison.OrdinalIgnoreCase)
                ? LocalObjectStorageUrlPolicy.BuildObjectUploadPath(normalizedBucket, normalizedKey)
                : LocalObjectStorageUrlPolicy.BuildObjectContentPath(normalizedBucket, normalizedKey);
            var signedQuery = LocalObjectStorageUrlPolicy.BuildSignedQuery(
                _options,
                purpose,
                normalizedBucket,
                normalizedKey,
                expiresAt);
            var localContentPath = LocalObjectStorageUrlPolicy.BuildObjectContentPath(normalizedBucket, normalizedKey);
            return new SignedObjectUrl(
                $"{BuildUrlPrefix()}{routePath}?{signedQuery}",
                expiresAt,
                "local",
                localContentPath);
        }

        var safeBucket = Uri.EscapeDataString(normalizedBucket);
        var safeKey = string.Join(
            '/',
            normalizedKey
                .Split('/', StringSplitOptions.RemoveEmptyEntries)
                .Select(Uri.EscapeDataString));
        var baseUrl = _options.PublicBaseUrl.TrimEnd('/');

        var url = $"{baseUrl}/{safeBucket}/{safeKey}?xiaolou_purpose={purpose}&expires={expiresAt.ToUnixTimeSeconds()}";
        return new SignedObjectUrl(
            url,
            expiresAt,
            string.IsNullOrWhiteSpace(_options.Provider) ? "s3-compatible" : _options.Provider.Trim());
    }

    private string BuildUrlPrefix()
    {
        return string.IsNullOrWhiteSpace(_options.PublicBaseUrl)
            ? ""
            : _options.PublicBaseUrl.TrimEnd('/');
    }
}
