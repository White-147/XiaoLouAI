using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Npgsql;
using XiaoLou.ControlApi.Modules.Accounts;
using XiaoLou.ControlApi.Modules.AgentCanvas;
using XiaoLou.ControlApi.Modules.Auth;
using XiaoLou.ControlApi.Modules.InternalJobs;
using XiaoLou.ControlApi.Modules.Media;
using XiaoLou.ControlApi.Modules.Payments;
using XiaoLou.ControlApi.Modules.Playground;
using XiaoLou.ControlApi.Modules.Toolbox;
using XiaoLou.Infrastructure.Postgres;
using XiaoLou.Infrastructure.Storage;
using Xunit;

namespace XiaoLou.ControlApi.Tests.Modules.BackendAdvisory;

public sealed class BackendAdvisoryEndpointResponseShapeTests
{
    [Fact]
    public async Task AgentCanvasChat_Stub_ReturnsSuccessEnvelopeWithoutActions()
    {
        using var env = ClearSyntheticEnvironment();
        await using var app = BuildSyntheticApp();

        var response = await InvokeJsonAsync(
            app,
            HttpMethods.Post,
            "/api/agent-canvas/chat",
            """
            {
              "sessionId": "agent-canvas-session-1",
              "message": "Create a simple storyboard",
              "model": "auto",
              "mode": "agent",
              "tools": {
                "webSearch": false,
                "canvasFiles": true
              },
              "canvas": {
                "title": "Synthetic canvas",
                "nodes": [],
                "groups": [],
                "viewport": {},
                "selectedNodeIds": []
              },
              "attachments": []
            }
            """);

        Assert.Equal(StatusCodes.Status200OK, response.StatusCode);
        using var payload = JsonDocument.Parse(response.Body);
        var root = payload.RootElement;
        Assert.True(root.GetProperty("success").GetBoolean());
        var data = root.GetProperty("data");
        Assert.Equal("agent-canvas-session-1", data.GetProperty("sessionId").GetString());
        Assert.Equal("contract-stub", data.GetProperty("provider").GetString());
        Assert.Equal("auto", data.GetProperty("model").GetString());
        Assert.Empty(data.GetProperty("actions").EnumerateArray());
        var warning = Assert.Single(data.GetProperty("warnings").EnumerateArray());
        Assert.Contains("AGENT_CANVAS_CHAT_STUB", warning.GetString() ?? "");
    }

    [Fact]
    public async Task AgentCanvasChat_BlankMessage_ReturnsFrontendReadableErrorEnvelope()
    {
        using var env = ClearSyntheticEnvironment();
        await using var app = BuildSyntheticApp();

        var response = await InvokeJsonAsync(
            app,
            HttpMethods.Post,
            "/api/agent-canvas/chat",
            """{"sessionId":"agent-canvas-session-1","message":"   "}""");

        Assert.Equal(StatusCodes.Status400BadRequest, response.StatusCode);
        using var payload = JsonDocument.Parse(response.Body);
        var root = payload.RootElement;
        Assert.False(root.GetProperty("success").GetBoolean());
        var error = root.GetProperty("error");
        Assert.Equal("AGENT_CANVAS_CHAT_INVALID_REQUEST", error.GetProperty("code").GetString());
        Assert.Equal("message is required", error.GetProperty("message").GetString());
    }

    [Fact]
    public async Task AgentCanvasChatStream_Stub_ReturnsSseResultWithoutActions()
    {
        using var env = ClearSyntheticEnvironment();
        await using var app = BuildSyntheticApp();

        var response = await InvokeJsonAsync(
            app,
            HttpMethods.Post,
            "/api/agent-canvas/chat/stream",
            """
            {
              "sessionId": "agent-canvas-session-1",
              "message": "Create a simple storyboard",
              "model": "auto",
              "mode": "agent",
              "canvas": {
                "title": "Synthetic canvas",
                "nodes": [],
                "groups": [],
                "viewport": {},
                "selectedNodeIds": []
              }
            }
            """);

        Assert.Equal(StatusCodes.Status200OK, response.StatusCode);
        Assert.True(
            response.ContentType?.StartsWith("text/event-stream", StringComparison.OrdinalIgnoreCase) == true,
            $"Expected text/event-stream content type, got {response.ContentType ?? "<null>"}");
        Assert.Contains("event: ready", response.Body);
        Assert.Contains("event: status", response.Body);
        Assert.Contains("event: result", response.Body);
        Assert.Contains("event: done", response.Body);
        Assert.Contains("\"provider\":\"contract-stub\"", response.Body);
        Assert.Contains("\"model\":\"auto\"", response.Body);
        Assert.Contains("\"actions\":[]", response.Body);
        Assert.Contains("AGENT_CANVAS_CHAT_STUB", response.Body);
        Assert.DoesNotContain("event: actions", response.Body);
        Assert.DoesNotContain("event: delta", response.Body);
    }

    [Fact]
    public async Task AgentCanvasChatStream_BlankMessage_ReturnsErrorBeforeAnySseEvent()
    {
        using var env = ClearSyntheticEnvironment();
        await using var app = BuildSyntheticApp();

        var response = await InvokeJsonAsync(
            app,
            HttpMethods.Post,
            "/api/agent-canvas/chat/stream",
            """{"sessionId":"agent-canvas-session-1","message":"   "}""");

        Assert.Equal(StatusCodes.Status400BadRequest, response.StatusCode);
        Assert.DoesNotContain("event:", response.Body);
        using var payload = JsonDocument.Parse(response.Body);
        var root = payload.RootElement;
        Assert.False(root.GetProperty("success").GetBoolean());
        var error = root.GetProperty("error");
        Assert.Equal("AGENT_CANVAS_CHAT_INVALID_REQUEST", error.GetProperty("code").GetString());
        Assert.Equal("message is required", error.GetProperty("message").GetString());
    }

    [Fact]
    public async Task LocalImageEditHealth_ContractStub_ReportsUnavailableOperations()
    {
        using var env = ClearSyntheticEnvironment();
        await using var app = BuildSyntheticApp();

        var response = await InvokeJsonAsync(
            app,
            HttpMethods.Get,
            "/api/canvas/local-image-edit/health",
            "{}");

        Assert.Equal(StatusCodes.Status200OK, response.StatusCode);
        using var payload = JsonDocument.Parse(response.Body);
        var root = payload.RootElement;
        Assert.True(root.GetProperty("success").GetBoolean());
        var data = root.GetProperty("data");
        Assert.False(data.GetProperty("available").GetBoolean());
        Assert.Equal("contract-stub", data.GetProperty("mode").GetString());
        Assert.Equal("none", data.GetProperty("mediaOutput").GetString());
        Assert.Contains(
            data.GetProperty("operations").EnumerateArray(),
            item => item.GetString() == "remove-background");
        Assert.Contains(
            data.GetProperty("operations").EnumerateArray(),
            item => item.GetString() == "inpaint");
    }

    [Fact]
    public async Task LocalImageEditRemoveBackground_Stub_ReturnsUnavailableEnvelopeWithoutMedia()
    {
        using var env = ClearSyntheticEnvironment();
        await using var app = BuildSyntheticApp();

        var response = await InvokeJsonAsync(
            app,
            HttpMethods.Post,
            "/api/canvas/local-image-edit/remove-background",
            """
            {
              "accountOwnerType": "user",
              "accountOwnerId": "allowed-owner",
              "projectId": "canvas-project-1",
              "nodeId": "image-node-1",
              "imageUrl": "https://cdn.example.test/source.png"
            }
            """);

        Assert.Equal(StatusCodes.Status503ServiceUnavailable, response.StatusCode);
        using var payload = JsonDocument.Parse(response.Body);
        var root = payload.RootElement;
        Assert.False(root.GetProperty("success").GetBoolean());
        var error = root.GetProperty("error");
        Assert.Equal("LOCAL_IMAGE_EDIT_UNAVAILABLE", error.GetProperty("code").GetString());
        Assert.Equal("remove-background", error.GetProperty("operation").GetString());
        Assert.Equal("canvas-project-1", error.GetProperty("projectId").GetString());
        Assert.Equal("image-node-1", error.GetProperty("nodeId").GetString());
        Assert.DoesNotContain("resultUrl", response.Body, StringComparison.Ordinal);
        Assert.DoesNotContain("jobId", response.Body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task LocalImageEditInpaint_MissingMask_ReturnsFrontendReadableErrorEnvelope()
    {
        using var env = ClearSyntheticEnvironment();
        await using var app = BuildSyntheticApp();

        var response = await InvokeJsonAsync(
            app,
            HttpMethods.Post,
            "/api/canvas/local-image-edit/inpaint",
            """
            {
              "accountOwnerType": "user",
              "accountOwnerId": "allowed-owner",
              "imageUrl": "https://cdn.example.test/source.png"
            }
            """);

        Assert.Equal(StatusCodes.Status400BadRequest, response.StatusCode);
        using var payload = JsonDocument.Parse(response.Body);
        var root = payload.RootElement;
        Assert.False(root.GetProperty("success").GetBoolean());
        var error = root.GetProperty("error");
        Assert.Equal("LOCAL_IMAGE_EDIT_INVALID_REQUEST", error.GetProperty("code").GetString());
        Assert.Equal("inpaint", error.GetProperty("operation").GetString());
        Assert.Equal("maskDataUrl is required for this local image edit operation", error.GetProperty("message").GetString());
    }

    [Theory]
    [MemberData(nameof(AccountScopeDeniedPostRoutes))]
    public async Task AccountScopedPostHandlers_ReturnStableForbiddenEnvelopeBeforeSyntheticStores(
        string path,
        string body)
    {
        using var env = ClearSyntheticEnvironment();
        await using var app = BuildSyntheticApp();

        var response = await InvokeJsonAsync(app, HttpMethods.Post, path, body);

        Assert.True(
            response.StatusCode == StatusCodes.Status403Forbidden,
            $"Expected 403 before synthetic stores, got {response.StatusCode} with body: {response.Body}");
        Assert.Equal(
            """{"error":"account scope is not authorized for this client token"}""",
            response.Body);
    }

    [Fact]
    public async Task PaymentCallback_InvalidJson_ReturnsStableBadRequestBeforeLedger()
    {
        using var env = ClearSyntheticEnvironment();
        await using var app = BuildSyntheticApp(new PaymentCallbackOptions
        {
            AllowedProviders = "alipay,wechat",
            RequireAllowedProvider = true,
        });

        var response = await InvokeJsonAsync(app, HttpMethods.Post, "/api/payments/callbacks/alipay", """{""");

        Assert.Equal(StatusCodes.Status400BadRequest, response.StatusCode);
        Assert.Equal(
            """{"error":"payment callback body must be normalized JSON before ledger processing","provider":"alipay"}""",
            response.Body);
    }

    [Fact]
    public async Task PaymentCallback_ProviderMismatch_ReturnsStableBadRequestBeforeLedger()
    {
        using var env = ClearSyntheticEnvironment();
        await using var app = BuildSyntheticApp(new PaymentCallbackOptions
        {
            AllowedProviders = "alipay,wechat",
            RequireAllowedProvider = true,
        });

        var response = await InvokeJsonAsync(
            app,
            HttpMethods.Post,
            "/api/payments/callbacks/wechat",
            """{"provider":"alipay","accountOwnerType":"user","accountOwnerId":"synthetic-owner"}""");

        Assert.Equal(StatusCodes.Status400BadRequest, response.StatusCode);
        Assert.Equal(
            """{"error":"payment callback provider mismatch","routeProvider":"wechat","bodyProvider":"alipay"}""",
            response.Body);
    }

    [Fact]
    public async Task PaymentCallback_DisabledProvider_ReturnsStableForbiddenBeforeLedger()
    {
        using var env = ClearSyntheticEnvironment();
        await using var app = BuildSyntheticApp(new PaymentCallbackOptions
        {
            AllowedProviders = "alipay",
            RequireAllowedProvider = true,
        });

        var response = await InvokeJsonAsync(
            app,
            HttpMethods.Post,
            "/api/payments/callbacks/wechat",
            """{"provider":"wechat","accountOwnerType":"user","accountOwnerId":"synthetic-owner"}""");

        Assert.Equal(StatusCodes.Status403Forbidden, response.StatusCode);
        Assert.Equal(
            """{"error":"payment callback provider is not enabled","provider":"wechat"}""",
            response.Body);
    }

    [Theory]
    [InlineData("/api/auth/login")]
    [InlineData("/api/auth/admin/login")]
    [InlineData("/api/auth/register/personal")]
    [InlineData("/api/auth/register/enterprise-admin")]
    public async Task PasswordAuthHandlers_BlankPassword_ReturnStableBadRequestBeforeSyntheticStores(string path)
    {
        using var env = ClearSyntheticEnvironment();
        await using var app = BuildSyntheticApp();

        var response = await InvokeJsonAsync(app, HttpMethods.Post, path, """{"email":"synthetic@example.test","password":""}""");

        Assert.Equal(StatusCodes.Status400BadRequest, response.StatusCode);
        Assert.Equal(
            """{"error":{"code":"AUTH_INVALID_REQUEST","message":"password is required"}}""",
            response.Body);
    }

    [Theory]
    [InlineData("/api/auth/password/bootstrap-admin", """{"email":"ops@xiaolou.local","password":""}""")]
    [InlineData("/api/auth/password/change", """{"currentPassword":"synthetic-password","newPassword":""}""")]
    public async Task PasswordFollowupHandlers_BlankNewPassword_ReturnStableBadRequestBeforeSyntheticStores(
        string path,
        string body)
    {
        using var env = ClearSyntheticEnvironment();
        await using var app = BuildSyntheticApp();

        var response = await InvokeJsonAsync(app, HttpMethods.Post, path, body);

        Assert.Equal(StatusCodes.Status400BadRequest, response.StatusCode);
        Assert.Equal(
            """{"error":{"code":"AUTH_INVALID_REQUEST","message":"password is required"}}""",
            response.Body);
    }

    [Fact]
    public async Task PasswordResetRequest_BlankEmail_ReturnsStableBadRequestBeforeSyntheticStores()
    {
        using var env = ClearSyntheticEnvironment();
        await using var app = BuildSyntheticApp();

        var response = await InvokeJsonAsync(
            app,
            HttpMethods.Post,
            "/api/auth/password/reset/request",
            """{"email":""}""");

        Assert.Equal(StatusCodes.Status400BadRequest, response.StatusCode);
        Assert.Equal(
            """{"error":{"code":"AUTH_INVALID_REQUEST","message":"email is required"}}""",
            response.Body);
    }

    [Fact]
    public async Task PasswordResetComplete_BlankToken_ReturnsStableBadRequestBeforeSyntheticStores()
    {
        using var env = ClearSyntheticEnvironment();
        await using var app = BuildSyntheticApp();

        var response = await InvokeJsonAsync(
            app,
            HttpMethods.Post,
            "/api/auth/password/reset/complete",
            """{"resetToken":"","newPassword":"synthetic-new-password"}""");

        Assert.Equal(StatusCodes.Status400BadRequest, response.StatusCode);
        Assert.Equal(
            """{"error":{"code":"AUTH_INVALID_REQUEST","message":"reset token is required"}}""",
            response.Body);
    }

    [Fact]
    public async Task PasswordResetComplete_BlankPassword_ReturnsStableBadRequestBeforeSyntheticStores()
    {
        using var env = ClearSyntheticEnvironment();
        await using var app = BuildSyntheticApp();

        var response = await InvokeJsonAsync(
            app,
            HttpMethods.Post,
            "/api/auth/password/reset/complete",
            """{"resetToken":"synthetic-reset-token","newPassword":""}""");

        Assert.Equal(StatusCodes.Status400BadRequest, response.StatusCode);
        Assert.Equal(
            """{"error":{"code":"AUTH_INVALID_REQUEST","message":"password is required"}}""",
            response.Body);
    }

    [Fact]
    public async Task PasswordBootstrap_ExternalForwardedRequest_ReturnsStableForbiddenBeforeSyntheticStores()
    {
        using var env = ClearSyntheticEnvironment();
        await using var app = BuildSyntheticApp();

        var response = await InvokeJsonAsync(
            app,
            HttpMethods.Post,
            "/api/auth/password/bootstrap-admin",
            """{"email":"ops@xiaolou.local","password":"synthetic-password"}""",
            new Dictionary<string, string>
            {
                ["X-Forwarded-For"] = "203.0.113.10",
            });

        Assert.Equal(StatusCodes.Status403Forbidden, response.StatusCode);
        Assert.Equal(
            """{"error":{"code":"AUTH_LOCAL_OPERATOR_REQUIRED","message":"platform password bootstrap is available only from local loopback access"}}""",
            response.Body);
    }

    [Theory]
    [InlineData("/api/auth/register/personal")]
    [InlineData("/api/auth/register/enterprise-admin")]
    public async Task PasswordRegistrationHandlers_ReservedPlatformEmail_ReturnStableBadRequestBeforeSyntheticStores(string path)
    {
        using var env = ClearSyntheticEnvironment();
        await using var app = BuildSyntheticApp();

        var response = await InvokeJsonAsync(app, HttpMethods.Post, path, """{"email":"ops@xiaolou.local","password":"synthetic-password"}""");

        Assert.Equal(StatusCodes.Status400BadRequest, response.StatusCode);
        Assert.Equal(
            """{"error":{"code":"AUTH_INVALID_REQUEST","message":"email is reserved"}}""",
            response.Body);
    }

    public static IEnumerable<object[]> AccountScopeDeniedPostRoutes()
    {
        yield return RouteBody(
            "/api/media/upload-begin",
            """
            {
              "accountOwnerType": "user",
              "accountOwnerId": "denied-owner",
              "idempotencyKey": "synthetic-upload",
              "bucket": "synthetic-bucket",
              "objectKey": "temp/synthetic-object.png",
              "mediaType": "image"
            }
            """);
        yield return RouteBody(
            "/api/jobs",
            """
            {
              "accountOwnerType": "user",
              "accountOwnerId": "denied-owner",
              "lane": "account-media",
              "jobType": "synthetic-image",
              "providerRoute": "synthetic-provider",
              "payload": {}
            }
            """);
        yield return RouteBody(
            "/api/toolbox/translate-text",
            """
            {
              "accountOwnerType": "user",
              "accountOwnerId": "denied-owner",
              "text": "synthetic source",
              "targetLang": "zh",
              "payload": {}
            }
            """);
        yield return RouteBody(
            "/api/playground/chat",
            """
            {
              "accountOwnerType": "user",
              "accountOwnerId": "denied-owner",
              "message": "synthetic prompt",
              "model": "qwen-plus"
            }
            """);
        yield return RouteBody(
            "/api/canvas/local-image-edit/remove-background",
            """
            {
              "accountOwnerType": "user",
              "accountOwnerId": "denied-owner",
              "imageUrl": "https://cdn.example.test/source.png"
            }
            """);
    }

    private static WebApplication BuildSyntheticApp(PaymentCallbackOptions? paymentCallbackOptions = null)
    {
        var builder = WebApplication.CreateBuilder();
        builder.Services.AddSingleton<IOptions<ClientApiOptions>>(Options.Create(new ClientApiOptions
        {
            Token = "synthetic-client-token",
            RequireConfiguredAccountGrant = true,
            AllowedAccountOwnerIds = "user:allowed-owner",
        }));
        builder.Services.AddSingleton<IOptions<PaymentCallbackOptions>>(
            Options.Create(paymentCallbackOptions ?? new PaymentCallbackOptions()));
        builder.Services.AddSingleton(_ =>
            new NpgsqlDataSourceBuilder(
                "Host=127.0.0.1;Port=1;Username=synthetic;Password=synthetic;Database=xiaolou_synthetic;Timeout=1;Command Timeout=1;Pooling=false")
            .Build());
        builder.Services.AddSingleton<PostgresAccountStore>();
        builder.Services.AddSingleton<PostgresIdentityConfigStore>();
        builder.Services.AddSingleton<PostgresWalletStore>();
        builder.Services.AddSingleton<PostgresPaymentLedger>();
        builder.Services.AddSingleton<PostgresMediaStore>();
        builder.Services.AddSingleton<PostgresJobQueue>();
        builder.Services.AddSingleton<PostgresJobNotificationListener>();
        builder.Services.AddSingleton<PostgresOutboxStore>();
        builder.Services.AddSingleton<PostgresToolboxStore>();
        builder.Services.AddSingleton<PostgresPlaygroundStore>();
        builder.Services.AddSingleton<PostgresProviderHealthStore>();
        builder.Services.AddSingleton<IObjectStorageSigner, ThrowingObjectStorageSigner>();
        builder.Services.AddSingleton<IPaymentSignatureVerifier, ThrowingPaymentSignatureVerifier>();

        var app = builder.Build();
        app.MapAccountsAuthEndpoints();
        app.MapPaymentEndpoints();
        app.MapMediaEndpoints();
        app.MapInternalJobsEndpoints();
        app.MapAgentCanvasChatEndpoints();
        app.MapAgentCanvasLocalImageEditEndpoints();
        app.MapToolboxEndpoints();
        app.MapPlaygroundEndpoints();
        return app;
    }

    private static async Task<RouteResponse> InvokeJsonAsync(
        WebApplication app,
        string method,
        string path,
        string body,
        IReadOnlyDictionary<string, string>? headers = null)
    {
        var route = FindRoute(app, method, path);
        var context = new DefaultHttpContext
        {
            RequestServices = app.Services,
        };
        context.Features.Set<IHttpRequestBodyDetectionFeature>(new SyntheticRequestBodyDetectionFeature());
        context.Request.Method = method;
        context.Request.Path = path;
        context.Request.ContentType = "application/json";
        context.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes(body));
        context.Request.ContentLength = context.Request.Body.Length;
        if (headers is not null)
        {
            foreach (var (name, value) in headers)
            {
                context.Request.Headers[name] = value;
            }
        }

        ApplyRouteValues(context, route, path);
        await using var responseBody = new MemoryStream();
        context.Response.Body = responseBody;

        await route.RequestDelegate!(context);

        responseBody.Position = 0;
        using var reader = new StreamReader(responseBody, Encoding.UTF8);
        return new RouteResponse(
            context.Response.StatusCode,
            context.Response.ContentType,
            await reader.ReadToEndAsync());
    }

    private static RouteEndpoint FindRoute(WebApplication app, string method, string path)
    {
        var exact = ((IEndpointRouteBuilder)app).DataSources
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Where(endpoint => string.Equals(endpoint.RoutePattern.RawText, path, StringComparison.Ordinal))
            .Where(endpoint =>
                endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods.Contains(
                    method,
                    StringComparer.Ordinal) == true)
            .ToArray();
        if (exact.Length > 0)
        {
            return exact.Single();
        }

        return ((IEndpointRouteBuilder)app).DataSources
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Where(endpoint =>
                string.Equals(
                    endpoint.RoutePattern.RawText,
                    "/api/payments/callbacks/{provider}",
                    StringComparison.Ordinal)
                && path.StartsWith("/api/payments/callbacks/", StringComparison.Ordinal))
            .Where(endpoint =>
                endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods.Contains(
                    method,
                    StringComparer.Ordinal) == true)
            .Single();
    }

    private static void ApplyRouteValues(DefaultHttpContext context, RouteEndpoint route, string path)
    {
        if (!string.Equals(
                route.RoutePattern.RawText,
                "/api/payments/callbacks/{provider}",
                StringComparison.Ordinal))
        {
            return;
        }

        context.Request.RouteValues["provider"] = path["/api/payments/callbacks/".Length..];
    }

    private static object[] RouteBody(string path, string body)
    {
        return new object[] { path, body };
    }

    private static EnvironmentVariableScope ClearSyntheticEnvironment()
    {
        return new EnvironmentVariableScope(
            "CLIENT_API_TOKEN",
            "CLIENT_API_TOKEN_HEADER",
            "CLIENT_API_AUTH_PROVIDER",
            "CLIENT_API_REQUIRE_AUTH_PROVIDER",
            "CLIENT_API_REQUIRE_ACCOUNT_SCOPE",
            "CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT",
            "CLIENT_API_ALLOWED_ACCOUNT_IDS",
            "CLIENT_API_ALLOWED_ACCOUNT_OWNER_IDS",
            "CLIENT_API_ALLOWED_PERMISSIONS",
            "ClientApi__AllowedPermissions",
            "CONTROL_API_CLIENT_ASSERTION_PERMISSIONS",
            "PAYMENT_CALLBACK_ALLOWED_PROVIDERS",
            "PAYMENT_CALLBACK_REQUIRE_ALLOWED_PROVIDER",
            "PAYMENT_CALLBACK_ALLOWED_ACCOUNT_IDS",
            "PAYMENT_CALLBACK_ALLOWED_ACCOUNT_OWNER_IDS",
            "PAYMENT_CALLBACK_REQUIRE_ACCOUNT_GRANT");
    }

    private sealed class ThrowingObjectStorageSigner : IObjectStorageSigner
    {
        public SignedObjectUrl SignUpload(string bucket, string objectKey, TimeSpan expiresIn)
        {
            throw new InvalidOperationException("Synthetic response-shape tests must not sign uploads.");
        }

        public SignedObjectUrl SignRead(string bucket, string objectKey, TimeSpan expiresIn)
        {
            throw new InvalidOperationException("Synthetic response-shape tests must not sign reads.");
        }
    }

    private sealed class ThrowingPaymentSignatureVerifier : IPaymentSignatureVerifier
    {
        public bool Verify(string provider, string rawBody, string? signature)
        {
            throw new InvalidOperationException("Synthetic response-shape tests must not verify payment signatures.");
        }
    }

    private sealed class EnvironmentVariableScope : IDisposable
    {
        private readonly Dictionary<string, string?> previousValues = new(StringComparer.Ordinal);

        public EnvironmentVariableScope(params string[] names)
        {
            foreach (var name in names)
            {
                previousValues[name] = Environment.GetEnvironmentVariable(name);
                Environment.SetEnvironmentVariable(name, null);
            }
        }

        public void Dispose()
        {
            foreach (var (name, value) in previousValues)
            {
                Environment.SetEnvironmentVariable(name, value);
            }
        }
    }

    private sealed class SyntheticRequestBodyDetectionFeature : IHttpRequestBodyDetectionFeature
    {
        public bool CanHaveBody => true;
    }

    private sealed record RouteResponse(int StatusCode, string? ContentType, string Body);
}
