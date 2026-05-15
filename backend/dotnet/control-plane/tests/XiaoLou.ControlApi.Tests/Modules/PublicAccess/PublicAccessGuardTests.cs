using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using XiaoLou.ControlApi.Modules.PublicAccess;
using Xunit;

namespace XiaoLou.ControlApi.Tests.Modules.PublicAccess;

public sealed class PublicAccessGuardTests
{
    [Theory]
    [InlineData("POST", "/api/auth/login", (int)PublicAccessPolicyKind.AuthSensitive)]
    [InlineData("POST", "/api/auth/register/personal", (int)PublicAccessPolicyKind.AuthSensitive)]
    [InlineData("POST", "/api/accounts/ensure", (int)PublicAccessPolicyKind.AuthSensitive)]
    [InlineData("POST", "/api/jobs", (int)PublicAccessPolicyKind.JobCreate)]
    [InlineData("POST", "/api/playground/chat", (int)PublicAccessPolicyKind.JobCreate)]
    [InlineData("POST", "/api/playground/chat-jobs", (int)PublicAccessPolicyKind.JobCreate)]
    [InlineData("POST", "/api/media/upload-begin", (int)PublicAccessPolicyKind.MediaSignedUrl)]
    [InlineData("POST", "/api/media/signed-read-url", (int)PublicAccessPolicyKind.MediaSignedUrl)]
    [InlineData("PUT", "/api/media/object-upload/xiaolou-staging/media/frontend/sample.png", (int)PublicAccessPolicyKind.MediaObjectUpload)]
    [InlineData("GET", "/api/media/object-content/xiaolou-staging/media/frontend/sample.png", (int)PublicAccessPolicyKind.MediaObjectRead)]
    [InlineData("GET", "/readyz", (int)PublicAccessPolicyKind.HealthProbe)]
    [InlineData("GET", "/api/projects", (int)PublicAccessPolicyKind.None)]
    public void Classify_ReturnsExpectedPublicAccessPolicy(
        string method,
        string path,
        int expected)
    {
        Assert.Equal((PublicAccessPolicyKind)expected, PublicAccessGuardClassifier.Classify(method, path));
    }

    [Fact]
    public async Task Middleware_RejectsOversizedMediaUploadBeforeEndpointRuns()
    {
        var endpointCalls = 0;
        var middleware = CreateMiddleware(
            _ =>
            {
                endpointCalls++;
                return Task.CompletedTask;
            },
            new PublicAccessLimitOptions
            {
                MediaUploadBodyBytes = 1024 * 1024,
            });
        var context = NewContext(
            HttpMethods.Put,
            "/api/media/object-upload/xiaolou-staging/media/frontend/sample.png",
            IPAddress.Parse("203.0.113.10"),
            contentLength: 1024 * 1024 + 1);

        await middleware.InvokeAsync(context);

        Assert.Equal(0, endpointCalls);
        Assert.Equal(StatusCodes.Status413PayloadTooLarge, context.Response.StatusCode);
        Assert.Contains("PUBLIC_REQUEST_BODY_TOO_LARGE", ReadResponseBody(context));
    }

    [Fact]
    public async Task Middleware_RateLimitsRepeatedAuthRequestsByForwardedClientAddress()
    {
        var endpointCalls = 0;
        var middleware = CreateMiddleware(
            context =>
            {
                endpointCalls++;
                context.Response.StatusCode = StatusCodes.Status204NoContent;
                return Task.CompletedTask;
            },
            new PublicAccessLimitOptions
            {
                AuthPermitLimit = 1,
                AuthConcurrencyLimit = 10,
                WindowSeconds = 60,
            });

        var first = NewContext(HttpMethods.Post, "/api/auth/login", IPAddress.Loopback);
        first.Request.Headers["X-Forwarded-For"] = "198.51.100.10, 203.0.113.20";
        var second = NewContext(HttpMethods.Post, "/api/auth/login", IPAddress.Loopback);
        second.Request.Headers["X-Forwarded-For"] = "198.51.100.10, 203.0.113.20";

        await middleware.InvokeAsync(first);
        await middleware.InvokeAsync(second);

        Assert.Equal(1, endpointCalls);
        Assert.Equal(StatusCodes.Status204NoContent, first.Response.StatusCode);
        Assert.Equal(StatusCodes.Status429TooManyRequests, second.Response.StatusCode);
        Assert.Equal("60", second.Response.Headers["Retry-After"]);
        Assert.Contains("auth-sensitive", ReadResponseBody(second));
    }

    [Fact]
    public async Task Middleware_LimitsConcurrentJobCreateRequests()
    {
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var middleware = CreateMiddleware(
            async context =>
            {
                entered.TrySetResult();
                await release.Task.WaitAsync(TimeSpan.FromSeconds(5));
                context.Response.StatusCode = StatusCodes.Status202Accepted;
            },
            new PublicAccessLimitOptions
            {
                JobCreatePermitLimit = 100,
                JobCreateConcurrencyLimit = 1,
                WindowSeconds = 60,
            });
        var first = NewContext(HttpMethods.Post, "/api/jobs", IPAddress.Parse("203.0.113.30"));
        var second = NewContext(HttpMethods.Post, "/api/jobs", IPAddress.Parse("203.0.113.30"));

        var firstTask = middleware.InvokeAsync(first);
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));

        await middleware.InvokeAsync(second);
        release.TrySetResult();
        await firstTask.WaitAsync(TimeSpan.FromSeconds(5));

        Assert.Equal(StatusCodes.Status202Accepted, first.Response.StatusCode);
        Assert.Equal(StatusCodes.Status429TooManyRequests, second.Response.StatusCode);
        Assert.Contains("job-create", ReadResponseBody(second));
    }

    [Fact]
    public void Options_NormalizeInvalidValuesToSafeDefaults()
    {
        var normalized = new PublicAccessLimitOptions
        {
            WindowSeconds = 0,
            AuthPermitLimit = -1,
            MediaUploadBodyBytes = 1,
        }.Normalized();

        Assert.Equal(60, normalized.WindowSeconds);
        Assert.Equal(20, normalized.AuthPermitLimit);
        Assert.Equal(256L * 1024 * 1024, normalized.MediaUploadBodyBytes);
    }

    private static PublicAccessGuardMiddleware CreateMiddleware(
        RequestDelegate next,
        PublicAccessLimitOptions options)
    {
        return new PublicAccessGuardMiddleware(
            next,
            Options.Create(options),
            new PublicAccessRequestLimiter());
    }

    private static DefaultHttpContext NewContext(
        string method,
        string path,
        IPAddress remoteIp,
        long? contentLength = null)
    {
        var context = new DefaultHttpContext();
        context.Request.Method = method;
        context.Request.Path = path;
        context.Connection.RemoteIpAddress = remoteIp;
        context.Request.ContentLength = contentLength;
        context.Request.Body = Stream.Null;
        context.Response.Body = new MemoryStream();
        return context;
    }

    private static string ReadResponseBody(DefaultHttpContext context)
    {
        context.Response.Body.Position = 0;
        using var document = JsonDocument.Parse(context.Response.Body);
        return document.RootElement.GetRawText();
    }
}
