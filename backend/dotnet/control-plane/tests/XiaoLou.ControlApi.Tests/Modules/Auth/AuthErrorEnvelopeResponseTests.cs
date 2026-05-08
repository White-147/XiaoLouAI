using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using XiaoLou.ControlApi.Modules.Auth;
using XiaoLou.Domain;
using Xunit;

namespace XiaoLou.ControlApi.Tests.Modules.Auth;

[Collection("ClientAuthEnvironment")]
public sealed class AuthErrorEnvelopeResponseTests
{
    [Fact]
    public async Task PublicClientMiddleware_WritesStableAuthenticationUnauthorizedEnvelope()
    {
        var response = await InvokePublicClientMiddlewareAsync(
            "GET",
            "/api/jobs",
            new ClientApiOptions { Token = "synthetic-client-token" });

        Assert.False(response.NextCalled);
        Assert.Equal(StatusCodes.Status401Unauthorized, response.StatusCode);
        AssertJson(response.Body, new { error = "client API token is required or invalid" });
    }

    [Fact]
    public async Task PublicClientMiddleware_WritesStableAuthenticationForbiddenEnvelope()
    {
        var response = await InvokePublicClientMiddlewareAsync(
            "GET",
            "/api/jobs",
            new ClientApiOptions(),
            context =>
            {
                context.Connection.RemoteIpAddress = IPAddress.Loopback;
                context.Request.Headers["X-Forwarded-For"] = "203.0.113.10";
            });

        Assert.False(response.NextCalled);
        Assert.Equal(StatusCodes.Status403Forbidden, response.StatusCode);
        AssertJson(response.Body, new { error = "client API is not available from this request context" });
    }

    [Fact]
    public async Task PublicClientMiddleware_WritesStablePermissionForbiddenEnvelope()
    {
        var response = await InvokePublicClientMiddlewareAsync(
            "POST",
            "/api/jobs",
            new ClientApiOptions
            {
                Token = "synthetic-client-token",
                AllowedPermissions = "jobs:read",
            },
            context => context.Request.Headers["X-XiaoLou-Client-Token"] = "synthetic-client-token");

        Assert.False(response.NextCalled);
        Assert.Equal(StatusCodes.Status403Forbidden, response.StatusCode);
        AssertJson(
            response.Body,
            new
            {
                error = "client token is missing the required public API permission",
                requiredPermission = "jobs:create",
            });
    }

    [Fact]
    public void AuthHelpers_BadRequestForbiddenAndAccountForbiddenShapesStayStable()
    {
        using var env = ClearClientAuthEnvironment();
        var badRequest = InspectResult(AuthHelpers.BadRequestError(new InvalidOperationException("bad input")));
        Assert.Equal(StatusCodes.Status400BadRequest, badRequest.StatusCode);
        AssertJson(badRequest.Body, new { error = "bad input" });

        var forbidden = InspectResult(AuthHelpers.ForbiddenError(new UnauthorizedAccessException("not allowed")));
        Assert.Equal(StatusCodes.Status403Forbidden, forbidden.StatusCode);
        AssertJson(forbidden.Body, new { error = "not allowed" });

        var context = new DefaultHttpContext();
        var accountScope = new AccountScope
        {
            AccountOwnerType = "user",
            AccountOwnerId = "denied-owner",
        };

        var accountForbidden = InspectResult(
            AuthHelpers.AuthorizeAccountScope(
                context,
                new ClientApiOptions
                {
                    Token = "synthetic-client-token",
                    RequireAccountScope = true,
                    RequireConfiguredAccountGrant = true,
                    AllowedAccountOwnerIds = "user:allowed-owner",
                },
                accountScope)!);
        Assert.Equal(StatusCodes.Status403Forbidden, accountForbidden.StatusCode);
        AssertJson(accountForbidden.Body, new { error = "account scope is not authorized for this client token" });
    }

    [Fact]
    public void PlatformAdminForbiddenEnvelopeShapeIsStable()
    {
        var result = InspectResult(AuthErrorEnvelopeResponses.PlatformAdminForbidden());

        Assert.Equal(StatusCodes.Status403Forbidden, result.StatusCode);
        AssertJson(result.Body, new { error = "platform admin permission is required" });
    }

    private static async Task<RouteResponse> InvokePublicClientMiddlewareAsync(
        string method,
        string path,
        ClientApiOptions options,
        Action<DefaultHttpContext>? configure = null)
    {
        using var env = ClearClientAuthEnvironment();
        await using var services = new ServiceCollection()
            .AddSingleton<IOptions<ClientApiOptions>>(Options.Create(options))
            .BuildServiceProvider();

        var context = new DefaultHttpContext
        {
            RequestServices = services,
        };
        context.Request.Method = method;
        context.Request.Path = path;
        context.Connection.RemoteIpAddress = IPAddress.Loopback;
        context.Response.Body = new MemoryStream();
        configure?.Invoke(context);

        var nextCalled = false;
        await InvokeSyntheticPublicClientMiddlewareAsync(context, () =>
        {
            nextCalled = true;
            return Task.CompletedTask;
        });

        context.Response.Body.Position = 0;
        using var reader = new StreamReader(context.Response.Body, Encoding.UTF8);
        return new RouteResponse(context.Response.StatusCode, await reader.ReadToEndAsync(), nextCalled);
    }

    private static async Task InvokeSyntheticPublicClientMiddlewareAsync(HttpContext context, Func<Task> next)
    {
        var isPublicClientRequest = AuthHelpers.IsPublicClientApiRequest(context);
        var isAnonymousIdentityRequest = AuthHelpers.IsAnonymousIdentityRequest(context);
        var clientApiOptions = context.RequestServices.GetRequiredService<IOptions<ClientApiOptions>>().Value;
        var clientAuth = isPublicClientRequest && !isAnonymousIdentityRequest
            ? AuthHelpers.AuthenticateClientRequest(context, clientApiOptions)
            : ClientAuthenticationResult.Allowed(null);

        if (isPublicClientRequest && !clientAuth.IsAllowed)
        {
            await AuthErrorEnvelopeResponses.WriteClientAuthenticationFailureAsync(context, clientAuth);
            return;
        }

        if (isPublicClientRequest)
        {
            context.Items[ClientPrincipal.ItemKey] = clientAuth.Principal;
        }

        if (isPublicClientRequest
            && !isAnonymousIdentityRequest
            && !AuthHelpers.IsClientPermissionAllowed(context, clientApiOptions))
        {
            await AuthErrorEnvelopeResponses.WriteClientPermissionFailureAsync(
                context,
                AuthHelpers.GetRequiredClientPermission(context));
            return;
        }

        await next();
    }

    private static ResultSnapshot InspectResult(IResult result)
    {
        var statusCode = result switch
        {
            IStatusCodeHttpResult statusResult => statusResult.StatusCode ?? StatusCodes.Status200OK,
            _ => StatusCodes.Status200OK,
        };
        var value = result switch
        {
            IValueHttpResult valueResult => valueResult.Value,
            _ => null,
        };
        return new ResultSnapshot(statusCode, JsonSerializer.Serialize(value));
    }

    private static void AssertJson<T>(string actual, T expected)
    {
        Assert.Equal(
            JsonSerializer.Serialize(expected),
            JsonSerializer.Serialize(JsonSerializer.Deserialize<JsonElement>(actual)));
    }

    private sealed record RouteResponse(int StatusCode, string Body, bool NextCalled);

    private sealed record ResultSnapshot(int StatusCode, string Body);

    private static EnvironmentVariableScope ClearClientAuthEnvironment()
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
            "CLIENT_API_AUTH_PROVIDER_SECRET",
            "CLIENT_API_AUTH_PROVIDER_ISSUER",
            "CLIENT_API_AUTH_PROVIDER_AUDIENCE",
            "CLIENT_API_AUTH_PROVIDER_CLOCK_SKEW_SECONDS",
            "CLIENT_API_AUTH_PROVIDER_TTL_SECONDS");
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
}
