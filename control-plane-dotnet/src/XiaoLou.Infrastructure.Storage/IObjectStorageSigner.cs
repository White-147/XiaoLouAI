namespace XiaoLou.Infrastructure.Storage;

public interface IObjectStorageSigner
{
    SignedObjectUrl SignUpload(string bucket, string objectKey, TimeSpan expiresIn);

    SignedObjectUrl SignRead(string bucket, string objectKey, TimeSpan expiresIn);
}

public sealed record SignedObjectUrl(string Url, DateTimeOffset ExpiresAt);
