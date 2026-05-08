namespace XiaoLou.Infrastructure.Storage;

public static class LocalObjectStoragePathResolver
{
    public static bool CanHandleLocalObjectRequest(ObjectStorageOptions options, string bucket, string? objectKey)
    {
        return IsLocalObjectStorage(options)
            && IsConfiguredBucket(options, bucket)
            && !string.IsNullOrWhiteSpace(objectKey);
    }

    public static bool TryResolveLocalObjectPath(
        ObjectStorageOptions options,
        string bucket,
        string? objectKey,
        out string filePath)
    {
        filePath = "";
        if (!CanHandleLocalObjectRequest(options, bucket, objectKey))
        {
            return false;
        }

        var root = ResolveLocalObjectStorageRoot(options);
        var bucketRoot = Path.GetFullPath(Path.Combine(root, bucket));
        var decodedKey = Uri.UnescapeDataString(objectKey ?? "").Replace('\\', '/');
        var segments = decodedKey
            .Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(segment => segment is not "." and not "..")
            .ToArray();
        if (segments.Length == 0)
        {
            return false;
        }

        var candidate = Path.GetFullPath(segments.Aggregate(bucketRoot, Path.Combine));
        if (!candidate.StartsWith(bucketRoot + Path.DirectorySeparatorChar, StringComparison.Ordinal)
            && !string.Equals(candidate, bucketRoot, StringComparison.Ordinal))
        {
            return false;
        }

        filePath = candidate;
        return true;
    }

    public static string ResolveLocalObjectStorageRoot(ObjectStorageOptions options)
    {
        var configured = options.LocalRootPath;
        if (string.IsNullOrWhiteSpace(configured))
        {
            configured = Environment.GetEnvironmentVariable("OBJECT_STORAGE_LOCAL_ROOT");
        }

        if (string.IsNullOrWhiteSpace(configured))
        {
            var cacheRoot = Environment.GetEnvironmentVariable("LOCAL_CACHE_DIR");
            configured = string.IsNullOrWhiteSpace(cacheRoot)
                ? Path.Combine(AppContext.BaseDirectory, "object-storage")
                : Path.Combine(cacheRoot, "object-storage");
        }

        return Path.GetFullPath(configured);
    }

    public static bool IsLocalObjectStorage(ObjectStorageOptions options)
    {
        return string.Equals(options.Provider, "local", StringComparison.OrdinalIgnoreCase);
    }

    public static bool IsConfiguredBucket(ObjectStorageOptions options, string bucket)
    {
        return string.Equals(
            string.IsNullOrWhiteSpace(options.Bucket) ? "xiaolou-prod" : options.Bucket.Trim(),
            bucket,
            StringComparison.Ordinal);
    }
}
