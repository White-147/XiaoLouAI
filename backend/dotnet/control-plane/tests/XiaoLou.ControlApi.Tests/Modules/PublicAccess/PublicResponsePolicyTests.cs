using Microsoft.AspNetCore.Http;
using XiaoLou.ControlApi.Modules.PublicAccess;
using Xunit;

namespace XiaoLou.ControlApi.Tests.Modules.PublicAccess;

public sealed class PublicResponsePolicyTests
{
    [Theory]
    [InlineData("GET", "/api/capabilities", true)]
    [InlineData("GET", "/api/toolbox", true)]
    [InlineData("GET", "/api/toolbox/capabilities", true)]
    [InlineData("GET", "/api/playground/models", true)]
    [InlineData("POST", "/api/toolbox", false)]
    [InlineData("GET", "/api/playground/config", false)]
    [InlineData("GET", "/api/playground/conversations", false)]
    [InlineData("GET", "/api/playground/memories", false)]
    [InlineData("POST", "/api/playground/chat", false)]
    [InlineData("GET", "/api/wallet", false)]
    [InlineData("POST", "/api/payments/callbacks/alipay", false)]
    [InlineData("GET", "/api/providers/health", false)]
    [InlineData("GET", "/api/media/object-content/xiaolou-staging/media/frontend/sample.png", false)]
    public void IsStableMetadataRequest_AllowsOnlyReviewedJsonMetadata(
        string method,
        string path,
        bool expected)
    {
        var context = NewContext(method, path);

        Assert.Equal(expected, PublicResponsePolicy.IsStableMetadataRequest(context));
    }

    [Fact]
    public void IsStableMetadataRequest_ExcludesRangeRequests()
    {
        var context = NewContext(HttpMethods.Get, "/api/playground/models");
        context.Request.Headers.Range = "bytes=0-99";

        Assert.False(PublicResponsePolicy.IsStableMetadataRequest(context));
    }

    [Fact]
    public async Task StableJson_WritesPrivateShortCacheHeadersAndWeakEtag()
    {
        var context = NewContext(HttpMethods.Get, "/api/playground/models");
        var result = PublicResponsePolicy.StableJson(new
        {
            items = new[] { new { id = "synthetic-model", configured = true } },
        });

        await result.ExecuteAsync(context);

        Assert.Equal(StatusCodes.Status200OK, context.Response.StatusCode);
        Assert.Equal("application/json; charset=utf-8", context.Response.ContentType);
        Assert.Equal("private, max-age=30, stale-while-revalidate=120", context.Response.Headers.CacheControl);
        Assert.StartsWith("W/\"", context.Response.Headers.ETag.ToString(), StringComparison.Ordinal);
        Assert.Contains("Accept-Encoding", context.Response.Headers.Vary.ToString(), StringComparison.Ordinal);
        Assert.Contains("X-XiaoLou-Client-Token", context.Response.Headers.Vary.ToString(), StringComparison.Ordinal);
        Assert.Contains("synthetic-model", ReadBody(context), StringComparison.Ordinal);
    }

    [Fact]
    public async Task StableJson_ReturnsNotModifiedForMatchingIfNoneMatch()
    {
        var first = NewContext(HttpMethods.Get, "/api/capabilities");
        var payload = new { items = new[] { new { code = "storyboard_25" } } };
        await PublicResponsePolicy.StableJson(payload).ExecuteAsync(first);
        var etag = first.Response.Headers.ETag.ToString();

        var second = NewContext(HttpMethods.Get, "/api/capabilities");
        second.Request.Headers.IfNoneMatch = etag;
        await PublicResponsePolicy.StableJson(payload).ExecuteAsync(second);

        Assert.Equal(StatusCodes.Status304NotModified, second.Response.StatusCode);
        Assert.Equal(etag, second.Response.Headers.ETag.ToString());
        Assert.Equal("private, max-age=30, stale-while-revalidate=120", second.Response.Headers.CacheControl);
        Assert.Equal("", ReadBody(second));
    }

    private static DefaultHttpContext NewContext(string method, string path)
    {
        var context = new DefaultHttpContext();
        context.Request.Method = method;
        context.Request.Path = path;
        context.Response.Body = new MemoryStream();
        return context;
    }

    private static string ReadBody(DefaultHttpContext context)
    {
        context.Response.Body.Position = 0;
        using var reader = new StreamReader(context.Response.Body);
        return reader.ReadToEnd();
    }
}
