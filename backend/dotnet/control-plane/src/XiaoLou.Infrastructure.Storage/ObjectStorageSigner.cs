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
        var safeBucket = Uri.EscapeDataString(string.IsNullOrWhiteSpace(bucket) ? _options.Bucket : bucket);
        var safeKey = Uri.EscapeDataString(objectKey.Replace('\\', '/'));
        var baseUrl = _options.PublicBaseUrl.TrimEnd('/');

        // P0 metadata-first signer. Replace this with provider-specific SDK signing
        // before exposing direct object-store credentials to real users.
        var url = $"{baseUrl}/{safeBucket}/{safeKey}?xiaolou_purpose={purpose}&expires={expiresAt.ToUnixTimeSeconds()}";
        return new SignedObjectUrl(url, expiresAt);
    }
}
