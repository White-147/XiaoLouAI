using System.Security.Cryptography;
using System.Text;

namespace XiaoLou.Infrastructure.Storage;

public static class LocalObjectStorageUrlPolicy
{
    public const string ObjectContentPathPrefix = "/api/media/object-content";
    public const string ObjectUploadPathPrefix = "/api/media/object-upload";

    public static bool IsStablePublicReadKey(string objectKey)
    {
        var normalized = NormalizeObjectKey(objectKey);
        return normalized.StartsWith("media/frontend/", StringComparison.Ordinal)
            || normalized.StartsWith("media/generated/", StringComparison.Ordinal);
    }

    public static string NormalizeBucket(ObjectStorageOptions options, string? bucket)
    {
        var value = string.IsNullOrWhiteSpace(bucket) ? options.Bucket : bucket;
        return string.IsNullOrWhiteSpace(value) ? "xiaolou-prod" : value.Trim();
    }

    public static string NormalizeObjectKey(string? objectKey)
    {
        return string.Join(
            '/',
            (objectKey ?? "")
                .Trim()
                .Replace('\\', '/')
                .Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Where(segment => segment is not "." and not ".."));
    }

    public static string BuildObjectContentPath(string bucket, string objectKey)
    {
        return $"{ObjectContentPathPrefix}/{Uri.EscapeDataString(bucket)}/{EncodeObjectKeyPath(objectKey)}";
    }

    public static string BuildObjectUploadPath(string bucket, string objectKey)
    {
        return $"{ObjectUploadPathPrefix}/{Uri.EscapeDataString(bucket)}/{EncodeObjectKeyPath(objectKey)}";
    }

    public static string BuildSignedQuery(
        ObjectStorageOptions options,
        string purpose,
        string bucket,
        string objectKey,
        DateTimeOffset expiresAt)
    {
        var expires = expiresAt.ToUnixTimeSeconds();
        var signature = Sign(options, purpose, bucket, objectKey, expires);
        return $"xiaolou_purpose={Uri.EscapeDataString(purpose)}&expires={expires}&signature={signature}";
    }

    public static bool IsSignedRequestValid(
        ObjectStorageOptions options,
        string expectedPurpose,
        string bucket,
        string objectKey,
        string? purpose,
        string? expiresRaw,
        string? signature)
    {
        if (!string.Equals(purpose, expectedPurpose, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (!long.TryParse(expiresRaw, out var expires)
            || DateTimeOffset.UtcNow > DateTimeOffset.FromUnixTimeSeconds(expires))
        {
            return false;
        }

        if (string.IsNullOrWhiteSpace(signature))
        {
            return false;
        }

        var expected = Sign(options, expectedPurpose, bucket, objectKey, expires);
        return FixedTimeEquals(signature.Trim(), expected);
    }

    private static string EncodeObjectKeyPath(string objectKey)
    {
        return string.Join(
            '/',
            NormalizeObjectKey(objectKey)
                .Split('/', StringSplitOptions.RemoveEmptyEntries)
                .Select(Uri.EscapeDataString));
    }

    private static string Sign(
        ObjectStorageOptions options,
        string purpose,
        string bucket,
        string objectKey,
        long expires)
    {
        var secret = ResolveSigningSecret(options);
        if (string.IsNullOrWhiteSpace(secret))
        {
            throw new InvalidOperationException(
                "ObjectStorage:SigningSecret or OBJECT_STORAGE_SIGNING_SECRET is required when ObjectStorage:Provider is local.");
        }

        var canonical = string.Join(
            '\n',
            purpose.Trim().ToLowerInvariant(),
            bucket.Trim(),
            NormalizeObjectKey(objectKey),
            expires.ToString());
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        return Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(canonical))).ToLowerInvariant();
    }

    private static string? ResolveSigningSecret(ObjectStorageOptions options)
    {
        return string.IsNullOrWhiteSpace(options.SigningSecret)
            ? Environment.GetEnvironmentVariable("OBJECT_STORAGE_SIGNING_SECRET")
            : options.SigningSecret;
    }

    private static bool FixedTimeEquals(string supplied, string expected)
    {
        var suppliedBytes = Encoding.UTF8.GetBytes(supplied);
        var expectedBytes = Encoding.UTF8.GetBytes(expected);
        return suppliedBytes.Length == expectedBytes.Length
            && CryptographicOperations.FixedTimeEquals(suppliedBytes, expectedBytes);
    }
}
