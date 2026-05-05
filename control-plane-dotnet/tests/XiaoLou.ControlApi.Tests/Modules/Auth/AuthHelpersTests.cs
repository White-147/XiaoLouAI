using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using XiaoLou.ControlApi.Modules.Auth;
using Xunit;

namespace XiaoLou.ControlApi.Tests.Modules.Auth;

public sealed class AuthHelpersTests
{
    [Theory]
    [InlineData(null, null)]
    [InlineData("", null)]
    [InlineData("   ", null)]
    [InlineData("  actor-1  ", "actor-1")]
    public void NormalizeBlank_TrimsAndCollapsesWhitespace(string? value, string? expected)
    {
        Assert.Equal(expected, AuthHelpers.NormalizeBlank(value));
    }

    [Fact]
    public void NormalizeGuidText_CanonicalizesValidGuid()
    {
        var guid = Guid.Parse("B6D2A928-1B64-4520-8DC0-B8C63F0D61D4");

        Assert.Equal("b6d2a928-1b64-4520-8dc0-b8c63f0d61d4", AuthHelpers.NormalizeGuidText(guid.ToString("B")));
        Assert.Equal("not-a-guid", AuthHelpers.NormalizeGuidText(" not-a-guid "));
        Assert.Null(AuthHelpers.NormalizeGuidText(" "));
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData("  USER  ", "user")]
    [InlineData(" Organization ", "organization")]
    public void NormalizeOwnerType_TrimsAndLowercases(string? value, string? expected)
    {
        Assert.Equal(expected, AuthHelpers.NormalizeOwnerType(value));
    }

    [Fact]
    public void DictionaryReaders_HandleStringsAndBooleans()
    {
        using var trueJson = JsonDocument.Parse("""{"value":"true"}""");
        using var falseJson = JsonDocument.Parse("""{"value":false}""");
        var source = new Dictionary<string, object?>
        {
            ["name"] = "  XiaoLou  ",
            ["empty"] = "   ",
            ["flag"] = true,
            ["stringFlag"] = "true",
            ["jsonStringFlag"] = trueJson.RootElement.GetProperty("value").Clone(),
            ["jsonFalseFlag"] = falseJson.RootElement.GetProperty("value").Clone(),
        };

        Assert.Equal("XiaoLou", AuthHelpers.ReadDictionaryString(source, "name"));
        Assert.Null(AuthHelpers.ReadDictionaryString(source, "empty"));
        Assert.True(AuthHelpers.ReadDictionaryBool(source, "flag"));
        Assert.True(AuthHelpers.ReadDictionaryBool(source, "stringFlag"));
        Assert.True(AuthHelpers.ReadDictionaryBool(source, "jsonStringFlag"));
        Assert.False(AuthHelpers.ReadDictionaryBool(source, "jsonFalseFlag"));
        Assert.False(AuthHelpers.ReadDictionaryBool(source, "missing"));
    }

    [Fact]
    public void ReadJsonString_ReturnsNormalizedPropertyValues()
    {
        using var document = JsonDocument.Parse("""{"name":"  alpha  ","count":3,"empty":"   ","nil":null}""");
        var root = document.RootElement;

        Assert.Equal("alpha", AuthHelpers.ReadJsonString(root, "name"));
        Assert.Equal("3", AuthHelpers.ReadJsonString(root, "count"));
        Assert.Null(AuthHelpers.ReadJsonString(root, "empty"));
        Assert.Null(AuthHelpers.ReadJsonString(root, "nil"));
        Assert.Null(AuthHelpers.ReadJsonString(root, "missing"));
    }

    [Theory]
    [InlineData("identity:read", "identity:read", true)]
    [InlineData("toolbox:*", "toolbox:write", true)]
    [InlineData("admin:read; jobs:create", "jobs:create", true)]
    [InlineData("*", "payments:write", true)]
    [InlineData("jobs:read", "jobs:write", false)]
    [InlineData(null, "jobs:read", false)]
    public void ContainsCsvGrant_MatchesExactWildcardAndPrefixGrants(string? csv, string value, bool expected)
    {
        Assert.Equal(expected, AuthHelpers.ContainsCsvGrant(csv, value));
    }

    [Fact]
    public void FixedTimeEquals_RequiresEqualContentAndLength()
    {
        Assert.True(AuthHelpers.FixedTimeEquals("client-token", "client-token"));
        Assert.False(AuthHelpers.FixedTimeEquals("client-token", "client-token-extra"));
        Assert.False(AuthHelpers.FixedTimeEquals("client-token", "wrong-token"));
    }

    [Theory]
    [InlineData(null, true, true)]
    [InlineData("", false, false)]
    [InlineData("true", false, true)]
    [InlineData("1", false, true)]
    [InlineData("yes", false, true)]
    [InlineData("on", false, true)]
    [InlineData("false", true, false)]
    [InlineData("0", true, false)]
    [InlineData("no", true, false)]
    [InlineData("off", true, false)]
    [InlineData("not-bool", true, true)]
    public void ReadBoolOption_UsesEnvironmentOverrideWhenRecognized(
        string? rawValue,
        bool configuredDefault,
        bool expected)
    {
        var envName = $"XIAOLOU_TEST_BOOL_OPTION_{Guid.NewGuid():N}";
        try
        {
            Environment.SetEnvironmentVariable(envName, rawValue);

            Assert.Equal(expected, AuthHelpers.ReadBoolOption(envName, configuredDefault));
        }
        finally
        {
            Environment.SetEnvironmentVariable(envName, null);
        }
    }

    [Theory]
    [InlineData("GET", "/api/playground", true)]
    [InlineData("POST", "/api/media/upload-begin", true)]
    [InlineData("GET", "/api/windows-native/status", false)]
    [InlineData("POST", "/api/internal/jobs/lease", false)]
    public void IsPublicClientApiRequest_ClassifiesAllowedFrontendSurface(
        string method,
        string path,
        bool expected)
    {
        var context = NewHttpContext(method, path);

        Assert.Equal(expected, AuthHelpers.IsPublicClientApiRequest(context));
    }

    [Theory]
    [InlineData("GET", "/api/auth/providers", true)]
    [InlineData("GET", "/api/me", true)]
    [InlineData("POST", "/api/auth/login", true)]
    [InlineData("POST", "/api/enterprise-applications", true)]
    [InlineData("POST", "/api/projects", false)]
    [InlineData("GET", "/api/projects", false)]
    public void IsAnonymousIdentityRequest_AllowsOnlyAnonymousIdentityRoutes(
        string method,
        string path,
        bool expected)
    {
        var context = NewHttpContext(method, path);

        Assert.Equal(expected, AuthHelpers.IsAnonymousIdentityRequest(context));
    }

    [Fact]
    public void AuthenticateClientRequest_WithConfiguredTokenRequiresMatchingDefaultHeader()
    {
        using var env = ClearClientAuthEnvironment();
        var options = new ClientApiOptions
        {
            Token = "synthetic-client-token",
            AllowedAccountIds = "synthetic-account-id",
            AllowedAccountOwnerIds = "user:synthetic-owner",
            AllowedPermissions = "jobs:read",
        };

        var missing = AuthHelpers.AuthenticateClientRequest(NewHttpContext("GET", "/api/jobs"), options);
        var failureContext = NewHttpContext("GET", "/api/jobs");
        failureContext.Request.Headers["X-XiaoLou-Client-Token"] = "wrong-synthetic-client-token";
        var failure = AuthHelpers.AuthenticateClientRequest(failureContext, options);
        var successContext = NewHttpContext("GET", "/api/jobs");
        successContext.Request.Headers["X-XiaoLou-Client-Token"] = "synthetic-client-token";
        var success = AuthHelpers.AuthenticateClientRequest(successContext, options);

        AssertClientError(
            missing,
            StatusCodes.Status401Unauthorized,
            "client API token is required or invalid");
        AssertClientError(
            failure,
            StatusCodes.Status401Unauthorized,
            "client API token is required or invalid");
        Assert.True(success.IsAllowed);
        Assert.Equal(StatusCodes.Status200OK, success.StatusCode);
        Assert.Equal("", success.Error);
        var principal = Assert.IsType<ClientPrincipal>(success.Principal);
        Assert.False(principal.FromAuthProvider);
        Assert.Equal("synthetic-account-id", principal.AllowedAccountIds);
        Assert.Equal("user:synthetic-owner", principal.AllowedAccountOwnerIds);
        Assert.Equal("jobs:read", principal.AllowedPermissions);
    }

    [Fact]
    public void AuthenticateClientRequest_UsesCustomTokenHeader()
    {
        using var env = ClearClientAuthEnvironment();
        var options = new ClientApiOptions
        {
            Token = "synthetic-client-token",
            TokenHeader = "X-Synthetic-Client-Token",
        };
        var defaultHeaderContext = NewHttpContext("GET", "/api/jobs");
        defaultHeaderContext.Request.Headers["X-XiaoLou-Client-Token"] = "synthetic-client-token";
        var customHeaderContext = NewHttpContext("GET", "/api/jobs");
        customHeaderContext.Request.Headers["X-Synthetic-Client-Token"] = "synthetic-client-token";

        var defaultHeader = AuthHelpers.AuthenticateClientRequest(defaultHeaderContext, options);
        var customHeader = AuthHelpers.AuthenticateClientRequest(customHeaderContext, options);

        AssertClientError(
            defaultHeader,
            StatusCodes.Status401Unauthorized,
            "client API token is required or invalid");
        Assert.True(customHeader.IsAllowed);
        Assert.Equal(StatusCodes.Status200OK, customHeader.StatusCode);
        Assert.IsType<ClientPrincipal>(customHeader.Principal);
    }

    [Fact]
    public void AuthenticateClientRequest_AllowsLoopbackWithoutConfiguredToken()
    {
        using var env = ClearClientAuthEnvironment();
        var context = NewHttpContext("GET", "/api/jobs", IPAddress.Loopback);

        var result = AuthHelpers.AuthenticateClientRequest(context, new ClientApiOptions());

        Assert.True(result.IsAllowed);
        Assert.Equal(StatusCodes.Status200OK, result.StatusCode);
        Assert.Equal("", result.Error);
        Assert.Null(result.Principal);
    }

    [Fact]
    public void AuthenticateClientRequest_ForbidsExternalForwardedAddressWithoutConfiguredToken()
    {
        using var env = ClearClientAuthEnvironment();
        var context = NewHttpContext("GET", "/api/jobs", IPAddress.Loopback);
        context.Request.Headers["X-Forwarded-For"] = "203.0.113.10";

        var result = AuthHelpers.AuthenticateClientRequest(context, new ClientApiOptions());

        AssertClientError(
            result,
            StatusCodes.Status403Forbidden,
            "client API is not available from this request context");
    }

    [Theory]
    [InlineData("POST", "/api/accounts/ensure", "accounts:ensure")]
    [InlineData("GET", "/api/me", "identity:read")]
    [InlineData("PUT", "/api/me", "identity:write")]
    [InlineData("GET", "/api/organizations", "organization:read")]
    [InlineData("POST", "/api/organizations", "organization:write")]
    [InlineData("GET", "/api/api-center/providers", "api-center:read")]
    [InlineData("POST", "/api/api-center/providers", "api-center:write")]
    [InlineData("GET", "/api/admin/retired-review", "admin:read")]
    [InlineData("POST", "/api/admin/retired-review", "admin:write")]
    [InlineData("GET", "/api/enterprise-applications", "enterprise-applications:read")]
    [InlineData("POST", "/api/enterprise-applications", "enterprise-applications:write")]
    [InlineData("GET", "/api/playground/models", "playground:read")]
    [InlineData("POST", "/api/playground/chat", "playground:write")]
    [InlineData("GET", "/api/capabilities", "toolbox:read")]
    [InlineData("POST", "/api/toolbox/translate-text", "toolbox:write")]
    [InlineData("GET", "/api/jobs", "jobs:read")]
    [InlineData("POST", "/api/jobs", "jobs:create")]
    [InlineData("POST", "/api/jobs/synthetic-job/cancel", "jobs:cancel")]
    [InlineData("GET", "/api/wallet/usage-stats", "wallet:read")]
    [InlineData("POST", "/api/media/signed-read-url", "media:read")]
    [InlineData("POST", "/api/media/upload-begin", "media:write")]
    [InlineData("GET", "/api/projects", "projects:read")]
    [InlineData("PUT", "/api/projects/synthetic-project", "projects:write")]
    [InlineData("GET", "/api/canvas-projects", "canvas:read")]
    [InlineData("POST", "/api/agent-canvas/projects", "canvas:write")]
    [InlineData("GET", "/api/create/images", "create:read")]
    [InlineData("POST", "/api/create/videos", "create:write")]
    [InlineData("GET", "/metrics", null)]
    public void GetRequiredClientPermission_MapsRepresentativeRoutes(
        string method,
        string path,
        string? expected)
    {
        var context = NewHttpContext(method, path);

        Assert.Equal(expected, AuthHelpers.GetRequiredClientPermission(context));
    }

    [Theory]
    [InlineData("GET", "/api/jobs", true)]
    [InlineData("POST", "/api/toolbox/translate-text", true)]
    [InlineData("POST", "/api/jobs", false)]
    [InlineData("GET", "/metrics", false)]
    public void IsClientPermissionAllowed_UsesConfiguredPermissionGrants(
        string method,
        string path,
        bool expected)
    {
        using var env = ClearClientAuthEnvironment();
        var options = new ClientApiOptions
        {
            Token = "synthetic-client-token",
            AllowedPermissions = "jobs:read toolbox:*",
        };
        var context = NewHttpContext(method, path);

        Assert.Equal(expected, AuthHelpers.IsClientPermissionAllowed(context, options));
    }

    [Theory]
    [InlineData("GET", "/api/admin/retired-review", true)]
    [InlineData("POST", "/api/admin/retired-review", false)]
    public void IsClientPermissionAllowed_UsesAuthenticatedStaticTokenPrincipalGrants(
        string method,
        string path,
        bool expected)
    {
        using var env = ClearClientAuthEnvironment();
        var options = new ClientApiOptions
        {
            Token = "synthetic-client-token",
            AllowedPermissions = "admin:read",
        };
        var context = NewHttpContext(method, path);
        context.Request.Headers["X-XiaoLou-Client-Token"] = "synthetic-client-token";
        var authentication = AuthHelpers.AuthenticateClientRequest(context, options);
        context.Items[ClientPrincipal.ItemKey] = authentication.Principal;

        Assert.True(authentication.IsAllowed);
        Assert.Equal(expected, AuthHelpers.IsClientPermissionAllowed(context, options));
    }

    [Fact]
    public void ErrorEnvelopeHelpers_PreserveStatusAndErrorShape()
    {
        var badRequest = InspectResult(AuthHelpers.BadRequestError(new ArgumentException("bad input")));
        var forbidden = InspectResult(AuthHelpers.ForbiddenError(new UnauthorizedAccessException("denied")));

        Assert.Equal(StatusCodes.Status400BadRequest, badRequest.StatusCode);
        Assert.Equal("""{"error":"bad input"}""", badRequest.Body);
        Assert.Equal(StatusCodes.Status403Forbidden, forbidden.StatusCode);
        Assert.Equal("""{"error":"denied"}""", forbidden.Body);
    }

    private static DefaultHttpContext NewHttpContext(
        string method,
        string path,
        IPAddress? remoteIpAddress = null)
    {
        var context = new DefaultHttpContext();
        context.Request.Method = method;
        context.Request.Path = path;
        context.Connection.RemoteIpAddress = remoteIpAddress;
        return context;
    }

    private static void AssertClientError(
        ClientAuthenticationResult result,
        int expectedStatusCode,
        string expectedError)
    {
        Assert.False(result.IsAllowed);
        Assert.Equal(expectedStatusCode, result.StatusCode);
        Assert.Equal(expectedError, result.Error);
        Assert.Null(result.Principal);
    }

    private static (int? StatusCode, string Body) InspectResult(IResult result)
    {
        var statusResult = Assert.IsAssignableFrom<IStatusCodeHttpResult>(result);
        var valueResult = Assert.IsAssignableFrom<IValueHttpResult>(result);
        return (statusResult.StatusCode, JsonSerializer.Serialize(valueResult.Value));
    }

    private static EnvironmentVariableScope ClearClientAuthEnvironment()
    {
        return new EnvironmentVariableScope(
            "CLIENT_API_TOKEN",
            "CLIENT_API_TOKEN_HEADER",
            "CLIENT_API_AUTH_PROVIDER",
            "CLIENT_API_REQUIRE_AUTH_PROVIDER",
            "CLIENT_API_ALLOWED_PERMISSIONS",
            "ClientApi__AllowedPermissions",
            "CONTROL_API_CLIENT_ASSERTION_PERMISSIONS");
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
