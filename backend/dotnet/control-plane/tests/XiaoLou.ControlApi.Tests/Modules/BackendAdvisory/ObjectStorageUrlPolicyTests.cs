using Microsoft.Extensions.Options;
using XiaoLou.Infrastructure.Storage;
using Xunit;

namespace XiaoLou.ControlApi.Tests.Modules.BackendAdvisory;

public sealed class ObjectStorageUrlPolicyTests
{
    [Fact]
    public void LocalSigner_UsesControlApiObjectRoutesWithSignedUploadAndStableReadPath()
    {
        var options = new ObjectStorageOptions
        {
            Provider = "local",
            Bucket = "xiaolou-staging",
            PublicBaseUrl = "https://www.example.test",
            SigningSecret = "synthetic-object-storage-secret",
        };
        var signer = new ObjectStorageSigner(Options.Create(options));

        var upload = signer.SignUpload(
            "xiaolou-staging",
            "media/frontend/user-1/synthetic image.png",
            TimeSpan.FromMinutes(10));
        var read = signer.SignRead(
            "xiaolou-staging",
            "media/frontend/user-1/synthetic image.png",
            TimeSpan.FromMinutes(10));

        Assert.Equal("local", upload.Provider);
        Assert.StartsWith(
            "https://www.example.test/api/media/object-upload/xiaolou-staging/media/frontend/user-1/synthetic%20image.png?",
            upload.Url);
        Assert.Contains("xiaolou_purpose=upload", upload.Url);
        Assert.Contains("signature=", upload.Url);
        Assert.Equal(
            "/api/media/object-content/xiaolou-staging/media/frontend/user-1/synthetic%20image.png",
            upload.LocalObjectContentPath);

        Assert.Equal("local", read.Provider);
        Assert.StartsWith(
            "https://www.example.test/api/media/object-content/xiaolou-staging/media/frontend/user-1/synthetic%20image.png?",
            read.Url);
        Assert.Equal(upload.LocalObjectContentPath, read.LocalObjectContentPath);
    }

    [Fact]
    public void LocalSignedRequestValidation_RejectsTamperedObjectKeys()
    {
        var options = new ObjectStorageOptions
        {
            Provider = "local",
            SigningSecret = "synthetic-object-storage-secret",
        };
        var expiresAt = DateTimeOffset.UtcNow.AddMinutes(10);
        var query = LocalObjectStorageUrlPolicy.BuildSignedQuery(
            options,
            "upload",
            "xiaolou-staging",
            "media/frontend/user-1/source.png",
            expiresAt);
        var parsed = ParseQuery(query);

        Assert.True(LocalObjectStorageUrlPolicy.IsSignedRequestValid(
            options,
            "upload",
            "xiaolou-staging",
            "media/frontend/user-1/source.png",
            parsed["xiaolou_purpose"],
            parsed["expires"],
            parsed["signature"]));
        Assert.False(LocalObjectStorageUrlPolicy.IsSignedRequestValid(
            options,
            "upload",
            "xiaolou-staging",
            "media/frontend/user-1/tampered.png",
            parsed["xiaolou_purpose"],
            parsed["expires"],
            parsed["signature"]));
    }

    [Fact]
    public void ExternalSigner_DoesNotAdvertiseLocalObjectContentPath()
    {
        var signer = new ObjectStorageSigner(Options.Create(new ObjectStorageOptions
        {
            Provider = "s3-compatible",
            Bucket = "xiaolou-prod",
            PublicBaseUrl = "https://cdn.example.test/media",
        }));

        var read = signer.SignRead(
            "xiaolou-prod",
            "media/frontend/user-1/synthetic image.png",
            TimeSpan.FromMinutes(10));

        Assert.Equal("s3-compatible", read.Provider);
        Assert.Null(read.LocalObjectContentPath);
        Assert.StartsWith(
            "https://cdn.example.test/media/xiaolou-prod/media/frontend/user-1/synthetic%20image.png?",
            read.Url);
    }

    private static Dictionary<string, string> ParseQuery(string query)
    {
        return query
            .Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Select(part => part.Split('=', 2))
            .ToDictionary(
                part => Uri.UnescapeDataString(part[0]),
                part => part.Length > 1 ? Uri.UnescapeDataString(part[1]) : "",
                StringComparer.Ordinal);
    }
}
