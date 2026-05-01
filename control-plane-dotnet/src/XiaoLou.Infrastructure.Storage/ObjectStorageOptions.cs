namespace XiaoLou.Infrastructure.Storage;

public sealed class ObjectStorageOptions
{
    public string Provider { get; init; } = "s3-compatible";
    public string Bucket { get; init; } = "xiaolou-prod";
    public string PublicBaseUrl { get; init; } = "https://object-storage.example.invalid";
    public string TempPrefix { get; init; } = "temp";
    public string PermanentPrefix { get; init; } = "media";
}
