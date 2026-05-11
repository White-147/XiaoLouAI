using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using XiaoLou.ControlApi.Modules.Auth;
using XiaoLou.Domain;
using Xunit;

namespace XiaoLou.ControlApi.Tests.Modules.Auth;

[Collection("ClientAuthEnvironment")]
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

    [Fact]
    public void ClientApiOptions_DefaultShapeRemainsStable()
    {
        var options = new ClientApiOptions();

        Assert.Null(options.Token);
        Assert.Equal("X-XiaoLou-Client-Token", options.TokenHeader);
        Assert.Null(options.AuthProvider);
        Assert.Null(options.AuthProviderSecret);
        Assert.Null(options.AuthProviderIssuer);
        Assert.Null(options.AuthProviderAudience);
        Assert.Equal(60, options.AuthProviderClockSkewSeconds);
        Assert.False(options.RequireAuthProvider);
        Assert.True(options.RequireAccountScope);
        Assert.False(options.RequireConfiguredAccountGrant);
        Assert.Null(options.AllowedAccountIds);
        Assert.Null(options.AllowedAccountOwnerIds);
        Assert.Null(options.AllowedPermissions);
    }

    [Fact]
    public void ClientAuthenticationResult_FactoryShapeRemainsStable()
    {
        var principal = ClientPrincipal.ForStaticToken(
            "account-1",
            "organization:tenant-1",
            "jobs:read");

        var allowed = ClientAuthenticationResult.Allowed(principal);
        var unauthorized = ClientAuthenticationResult.Unauthorized("missing token");
        var forbidden = ClientAuthenticationResult.Forbidden("denied");

        Assert.True(allowed.IsAllowed);
        Assert.Equal(StatusCodes.Status200OK, allowed.StatusCode);
        Assert.Equal("", allowed.Error);
        Assert.Same(principal, allowed.Principal);
        AssertClientError(unauthorized, StatusCodes.Status401Unauthorized, "missing token");
        AssertClientError(forbidden, StatusCodes.Status403Forbidden, "denied");
    }

    [Fact]
    public void ClientPrincipal_StaticTokenShapeRemainsStable()
    {
        var principal = ClientPrincipal.ForStaticToken(
            "account-1",
            "user:actor-1 organization:tenant-1",
            "jobs:read toolbox:*");

        Assert.Equal("xiaolou.client.principal", ClientPrincipal.ItemKey);
        Assert.Null(principal.Subject);
        Assert.False(principal.FromAuthProvider);
        Assert.Equal("account-1", principal.AllowedAccountIds);
        Assert.Equal("user:actor-1 organization:tenant-1", principal.AllowedAccountOwnerIds);
        Assert.Equal("jobs:read toolbox:*", principal.AllowedPermissions);
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

    [Fact]
    public void ClientApiHeaderEnvHelpers_PreserveOptionEnvPrecedenceDefaultsAndAliases()
    {
        using var env = ClearClientAuthEnvironment();
        Environment.SetEnvironmentVariable("CLIENT_API_TOKEN", "  env-token  ");
        Environment.SetEnvironmentVariable("CLIENT_API_TOKEN_HEADER", "  X-Env-Client-Token  ");
        Environment.SetEnvironmentVariable("CLIENT_API_ALLOWED_ACCOUNT_IDS", "env-account");
        Environment.SetEnvironmentVariable("CLIENT_API_ALLOWED_ACCOUNT_OWNER_IDS", "user:env-owner");
        Environment.SetEnvironmentVariable("ClientApi__AllowedPermissions", "identity:read jobs:read");
        Environment.SetEnvironmentVariable("CLIENT_API_ALLOWED_PERMISSIONS", "toolbox:write");
        Environment.SetEnvironmentVariable("CONTROL_API_CLIENT_ASSERTION_PERMISSIONS", "jobs:read,media:read");
        Environment.SetEnvironmentVariable("CLIENT_API_AUTH_PROVIDER_SECRET", "env-secret");
        Environment.SetEnvironmentVariable("CLIENT_API_AUTH_PROVIDER_ISSUER", "env-issuer");
        Environment.SetEnvironmentVariable("CLIENT_API_AUTH_PROVIDER_AUDIENCE", "env-audience");

        var fallbackOptions = new ClientApiOptions();
        var configuredOptions = new ClientApiOptions
        {
            Token = "  option-token  ",
            TokenHeader = "  X-Option-Client-Token  ",
            AllowedAccountIds = "option-account",
            AllowedAccountOwnerIds = "user:option-owner",
            AllowedPermissions = "admin:read",
            AuthProviderSecret = "option-secret",
            AuthProviderIssuer = "option-issuer",
            AuthProviderAudience = "option-audience",
        };

        Assert.Equal("env-token", ClientApiHeaderEnvHelpers.GetConfiguredClientToken(fallbackOptions));
        Assert.Equal("option-token", ClientApiHeaderEnvHelpers.GetConfiguredClientToken(configuredOptions));
        Assert.Equal("X-Env-Client-Token", ClientApiHeaderEnvHelpers.GetConfiguredClientTokenHeader(configuredOptions));
        Assert.Equal("env-account", AuthHelpers.GetConfiguredAllowedAccountIds(fallbackOptions));
        Assert.Equal("option-account", AuthHelpers.GetConfiguredAllowedAccountIds(configuredOptions));
        Assert.Equal("user:env-owner", AuthHelpers.GetConfiguredAllowedAccountOwnerIds(fallbackOptions));
        Assert.Equal("user:option-owner", AuthHelpers.GetConfiguredAllowedAccountOwnerIds(configuredOptions));
        Assert.Equal(
            "admin:read,identity:read,jobs:read,toolbox:write,media:read",
            AuthHelpers.GetConfiguredAllowedPermissions(configuredOptions));
        Assert.Equal("env-secret", AuthHelpers.GetConfiguredClientAuthProviderSecret(fallbackOptions));
        Assert.Equal("option-secret", AuthHelpers.GetConfiguredClientAuthProviderSecret(configuredOptions));
        Assert.Equal("env-issuer", AuthHelpers.GetConfiguredClientAuthProviderIssuer(fallbackOptions));
        Assert.Equal("option-issuer", AuthHelpers.GetConfiguredClientAuthProviderIssuer(configuredOptions));
        Assert.Equal("env-audience", AuthHelpers.GetConfiguredClientAuthProviderAudience(fallbackOptions));
        Assert.Equal("option-audience", AuthHelpers.GetConfiguredClientAuthProviderAudience(configuredOptions));

        Environment.SetEnvironmentVariable("CLIENT_API_TOKEN_HEADER", null);
        Assert.Equal("X-Option-Client-Token", ClientApiHeaderEnvHelpers.GetConfiguredClientTokenHeader(configuredOptions));
        Assert.Equal("X-XiaoLou-Client-Token", ClientApiHeaderEnvHelpers.GetConfiguredClientTokenHeader(new ClientApiOptions
        {
            TokenHeader = "",
        }));
    }

    [Theory]
    [InlineData("hs256-jwt", "hs256-jwt", true)]
    [InlineData("jwt-hs256", "hs256-jwt", true)]
    [InlineData("none", "none", false)]
    [InlineData("   ", null, false)]
    public void ClientApiHeaderEnvHelpers_NormalizeProviderAliases(
        string? configuredProvider,
        string? expectedProvider,
        bool expectedEnabled)
    {
        using var env = ClearClientAuthEnvironment();
        var options = new ClientApiOptions
        {
            AuthProvider = configuredProvider,
        };

        Assert.Equal(expectedProvider, ClientApiHeaderEnvHelpers.GetConfiguredClientAuthProvider(options));
        Assert.Equal(expectedEnabled, ClientApiHeaderEnvHelpers.IsClientAuthProviderEnabled(options));

        Environment.SetEnvironmentVariable("CLIENT_API_AUTH_PROVIDER", configuredProvider);
        Assert.Equal(expectedProvider, ClientApiHeaderEnvHelpers.GetConfiguredClientAuthProvider(new ClientApiOptions()));
        Assert.Equal(expectedEnabled, ClientApiHeaderEnvHelpers.IsClientAuthProviderEnabled(new ClientApiOptions()));
    }

    [Fact]
    public void ClientApiHeaderEnvHelpers_ClampAuthProviderClockSkew()
    {
        using var env = ClearClientAuthEnvironment();

        Assert.Equal(0, ClientApiHeaderEnvHelpers.GetClientAuthProviderClockSkewSeconds(new ClientApiOptions
        {
            AuthProviderClockSkewSeconds = -10,
        }));
        Assert.Equal(300, ClientApiHeaderEnvHelpers.GetClientAuthProviderClockSkewSeconds(new ClientApiOptions
        {
            AuthProviderClockSkewSeconds = 999,
        }));

        Environment.SetEnvironmentVariable("CLIENT_API_AUTH_PROVIDER_CLOCK_SKEW_SECONDS", "-1");
        Assert.Equal(0, ClientApiHeaderEnvHelpers.GetClientAuthProviderClockSkewSeconds(new ClientApiOptions
        {
            AuthProviderClockSkewSeconds = 60,
        }));

        Environment.SetEnvironmentVariable("CLIENT_API_AUTH_PROVIDER_CLOCK_SKEW_SECONDS", "301");
        Assert.Equal(300, ClientApiHeaderEnvHelpers.GetClientAuthProviderClockSkewSeconds(new ClientApiOptions
        {
            AuthProviderClockSkewSeconds = 60,
        }));

        Environment.SetEnvironmentVariable("CLIENT_API_AUTH_PROVIDER_CLOCK_SKEW_SECONDS", "not-a-number");
        Assert.Equal(42, ClientApiHeaderEnvHelpers.GetClientAuthProviderClockSkewSeconds(new ClientApiOptions
        {
            AuthProviderClockSkewSeconds = 42,
        }));
    }

    [Fact]
    public void CreateLocalAuthToken_EncodesActorAndRecentTimestamp()
    {
        var before = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        var token = AuthHelpers.CreateLocalAuthToken("synthetic-actor");

        var after = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var decoded = Encoding.UTF8.GetString(Convert.FromBase64String(token));
        var separatorIndex = decoded.LastIndexOf(':');
        Assert.True(separatorIndex > 0);
        Assert.Equal("synthetic-actor", decoded[..separatorIndex]);
        Assert.True(long.TryParse(decoded[(separatorIndex + 1)..], out var timestamp));
        Assert.InRange(timestamp, before, after);
    }

    [Fact]
    public void TryReadLocalAuthTokenActorId_DecodesValidSessionToken()
    {
        var token = AuthHelpers.CreateLocalAuthToken("synthetic-actor");

        Assert.True(AuthHelpers.TryReadLocalAuthTokenActorId(token, out var actorId));
        Assert.Equal("synthetic-actor", actorId);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not-base64")]
    [InlineData("c3ludGhldGljLWFjdG9y")]
    [InlineData("c3ludGhldGljLWFjdG9yOm5vdC1hLXRpbWVzdGFtcA==")]
    public void TryReadLocalAuthTokenActorId_RejectsInvalidTokenShape(string? token)
    {
        Assert.False(AuthHelpers.TryReadLocalAuthTokenActorId(token, out var actorId));
        Assert.Equal("", actorId);
    }

    [Fact]
    public void CreateControlApiClientAssertion_ReturnsNullWithoutSecret()
    {
        using var env = ClearClientAuthEnvironment();

        var assertion = AuthHelpers.CreateControlApiClientAssertion(
            SyntheticPermissionContext(),
            new ClientApiOptions());

        Assert.Null(assertion);
    }

    [Fact]
    public void CreateControlApiClientAssertion_SignsExpectedHeaderPayloadAndExplicitClaims()
    {
        using var env = ClearClientAuthEnvironment();
        Environment.SetEnvironmentVariable("CLIENT_API_AUTH_PROVIDER_TTL_SECONDS", "120");
        var secret = "  synthetic-secret  ";
        var options = new ClientApiOptions
        {
            AuthProviderSecret = secret,
            AuthProviderIssuer = "https://issuer.example.test",
            AuthProviderAudience = "control-api",
            AllowedPermissions = "jobs:read media:write",
        };

        var assertion = AuthHelpers.CreateControlApiClientAssertion(SyntheticPermissionContext(), options);

        var parts = AssertJwtShape(assertion);
        var header = DecodeJwtJson(parts[0]);
        var payload = DecodeJwtJson(parts[1]);
        Assert.Equal("HS256", header.GetProperty("alg").GetString());
        Assert.Equal("JWT", header.GetProperty("typ").GetString());
        AssertJwtSignature(secret.Trim(), parts);
        Assert.Equal("actor-1", payload.GetProperty("sub").GetString());
        Assert.Equal("https://issuer.example.test", payload.GetProperty("iss").GetString());
        Assert.Equal("control-api", payload.GetProperty("aud").GetString());
        Assert.Equal("user", payload.GetProperty("xiaolou_account_owner_type").GetString());
        Assert.Equal("tenant-current", payload.GetProperty("xiaolou_current_organization_id").GetString());
        Assert.True(Guid.TryParse(payload.GetProperty("jti").GetString(), out _));

        var iat = payload.GetProperty("iat").GetInt64();
        var nbf = payload.GetProperty("nbf").GetInt64();
        var exp = payload.GetProperty("exp").GetInt64();
        Assert.Equal(30, iat - nbf);
        Assert.Equal(120, exp - iat);

        Assert.Equal(
            new[] { "jobs:read", "media:write" },
            ReadStringArray(payload, "xiaolou_permissions"));
        Assert.Equal(
            new[]
            {
                "actor-1",
                "user:actor-1",
                "tenant-enabled",
                "organization:tenant-enabled",
                "tenant-current",
                "organization:tenant-current",
            },
            ReadStringArray(payload, "xiaolou_account_owner_ids"));
    }

    [Fact]
    public void CreateControlApiClientAssertion_UsesDefaultPermissionsWhenUnconfigured()
    {
        using var env = ClearClientAuthEnvironment();
        var assertion = AuthHelpers.CreateControlApiClientAssertion(
            SyntheticPermissionContext(),
            new ClientApiOptions
            {
                AuthProviderSecret = "synthetic-secret",
            });

        var parts = AssertJwtShape(assertion);
        var payload = DecodeJwtJson(parts[1]);
        var permissions = ReadStringArray(payload, "xiaolou_permissions");

        Assert.Contains("accounts:ensure", permissions);
        Assert.Contains("jobs:create", permissions);
        Assert.Contains("playground:write", permissions);
        Assert.Contains("toolbox:write", permissions);
    }

    [Theory]
    [InlineData("GET", "/api/playground", true)]
    [InlineData("POST", "/api/media/upload-begin", true)]
    [InlineData("GET", "/api/media/object-content/xiaolou-staging/media/frontend/sample.png", false)]
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
    [InlineData("/api/playground", true)]
    [InlineData("/api/media/upload-begin", true)]
    [InlineData("/api/media/object-content/xiaolou-staging/media/frontend/sample.png", false)]
    [InlineData("/api/wallets", true)]
    [InlineData("/api/windows-native/status", false)]
    [InlineData("/api/internal/jobs/lease", false)]
    public void ClientRoutePolicy_ClassifiesPublicClientApiPathsDirectly(string path, bool expected)
    {
        Assert.Equal(expected, ClientRoutePolicy.IsPublicClientApiRequest(new PathString(path)));
    }

    [Theory]
    [InlineData("GET", "/api/auth/providers", true)]
    [InlineData("GET", "/api/me", true)]
    [InlineData("POST", "/api/auth/login", true)]
    [InlineData("POST", "/api/auth/password/bootstrap-admin", true)]
    [InlineData("POST", "/api/auth/session/refresh", true)]
    [InlineData("POST", "/api/auth/password/reset/request", true)]
    [InlineData("POST", "/api/auth/password/reset/complete", true)]
    [InlineData("POST", "/api/auth/password/change", false)]
    [InlineData("POST", "/api/auth/password/admin-reset", false)]
    [InlineData("POST", "/api/auth/demo-session", true)]
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
    public void AuthenticateClientRequest_UsesAuthorizationBearerFallbackForStaticToken()
    {
        using var env = ClearClientAuthEnvironment();
        var options = new ClientApiOptions
        {
            Token = "synthetic-client-token",
        };
        var context = NewHttpContext("GET", "/api/jobs");
        context.Request.Headers["Authorization"] = "Bearer synthetic-client-token";

        var result = AuthHelpers.AuthenticateClientRequest(context, options);

        Assert.True(result.IsAllowed);
        Assert.Equal(StatusCodes.Status200OK, result.StatusCode);
        Assert.IsType<ClientPrincipal>(result.Principal);
    }

    [Theory]
    [InlineData("missing.segments")]
    [InlineData("not-base64.!!.also-not-base64")]
    public void AuthenticateClientRequest_RejectsMalformedProviderJwt(string token)
    {
        using var env = ClearClientAuthEnvironment();
        var context = NewHttpContext("GET", "/api/jobs");
        context.Request.Headers["Authorization"] = $"Bearer {token}";

        var result = AuthHelpers.AuthenticateClientRequest(context, RequiredProviderOptions());

        AssertClientError(
            result,
            StatusCodes.Status401Unauthorized,
            "client auth provider token is required or invalid");
    }

    [Fact]
    public void AuthenticateClientRequest_RejectsProviderJwtAlgMismatch()
    {
        using var env = ClearClientAuthEnvironment();
        var token = CreateProviderJwt(
            "synthetic-provider-secret",
            SyntheticProviderPayload(),
            new Dictionary<string, object?>
            {
                ["alg"] = "none",
                ["typ"] = "JWT",
            });
        var context = NewHttpContext("GET", "/api/jobs");
        context.Request.Headers["Authorization"] = $"Bearer {token}";

        var result = AuthHelpers.AuthenticateClientRequest(context, RequiredProviderOptions());

        AssertClientError(
            result,
            StatusCodes.Status401Unauthorized,
            "client auth provider token is required or invalid");
    }

    [Fact]
    public void AuthenticateClientRequest_RejectsProviderJwtSignatureFailure()
    {
        using var env = ClearClientAuthEnvironment();
        var token = CreateProviderJwt(
            "synthetic-provider-secret",
            SyntheticProviderPayload(),
            signingSecret: "wrong-provider-secret");
        var context = NewHttpContext("GET", "/api/jobs");
        context.Request.Headers["Authorization"] = $"Bearer {token}";

        var result = AuthHelpers.AuthenticateClientRequest(context, RequiredProviderOptions());

        AssertClientError(
            result,
            StatusCodes.Status401Unauthorized,
            "client auth provider token is required or invalid");
    }

    [Fact]
    public void AuthenticateClientRequest_CreatesProviderPrincipalFromValidJwt()
    {
        using var env = ClearClientAuthEnvironment();
        var token = CreateProviderJwt(
            "synthetic-provider-secret",
            SyntheticProviderPayload());
        var context = NewHttpContext("GET", "/api/jobs");
        context.Request.Headers["Authorization"] = $"Bearer {token}";

        var result = AuthHelpers.AuthenticateClientRequest(context, RequiredProviderOptions());

        Assert.True(result.IsAllowed);
        Assert.Equal(StatusCodes.Status200OK, result.StatusCode);
        var principal = Assert.IsType<ClientPrincipal>(result.Principal);
        Assert.True(principal.FromAuthProvider);
        Assert.Equal("provider-subject", principal.Subject);
        Assert.Equal("account-1,account-2", principal.AllowedAccountIds);
        Assert.Equal(
            "explicit-owner,organization:explicit-org,provider-subject,organization:provider-subject",
            principal.AllowedAccountOwnerIds);
        Assert.Equal("jobs:read,toolbox:write,media:read", principal.AllowedPermissions);
    }

    [Fact]
    public void AuthenticateClientRequest_AcceptsProviderJwtAudienceArray()
    {
        using var env = ClearClientAuthEnvironment();
        var payload = SyntheticProviderPayload();
        payload["aud"] = new[] { "other-audience", "control-api" };
        var token = CreateProviderJwt("synthetic-provider-secret", payload);
        var context = NewHttpContext("GET", "/api/jobs");
        context.Request.Headers["Authorization"] = $"Bearer {token}";

        var result = AuthHelpers.AuthenticateClientRequest(context, RequiredProviderOptions());

        Assert.True(result.IsAllowed);
        Assert.Equal("provider-subject", result.Principal?.Subject);
    }

    [Theory]
    [InlineData("iss", "wrong-issuer")]
    [InlineData("aud", "wrong-audience")]
    public void AuthenticateClientRequest_RejectsProviderJwtIssuerOrAudienceMismatch(
        string claimName,
        string claimValue)
    {
        using var env = ClearClientAuthEnvironment();
        var payload = SyntheticProviderPayload();
        payload[claimName] = claimValue;
        var token = CreateProviderJwt("synthetic-provider-secret", payload);
        var context = NewHttpContext("GET", "/api/jobs");
        context.Request.Headers["Authorization"] = $"Bearer {token}";

        var result = AuthHelpers.AuthenticateClientRequest(context, RequiredProviderOptions());

        AssertClientError(
            result,
            StatusCodes.Status401Unauthorized,
            "client auth provider token is required or invalid");
    }

    [Theory]
    [InlineData(-30, null, true)]
    [InlineData(-90, null, false)]
    [InlineData(300, 30, true)]
    [InlineData(300, 90, false)]
    public void AuthenticateClientRequest_AppliesProviderJwtExpNbfAndSkew(
        int expOffsetSeconds,
        int? nbfOffsetSeconds,
        bool expectedAllowed)
    {
        using var env = ClearClientAuthEnvironment();
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var payload = SyntheticProviderPayload(now);
        payload["exp"] = now + expOffsetSeconds;
        if (nbfOffsetSeconds is not null)
        {
            payload["nbf"] = now + nbfOffsetSeconds.Value;
        }

        var token = CreateProviderJwt("synthetic-provider-secret", payload);
        var context = NewHttpContext("GET", "/api/jobs");
        context.Request.Headers["Authorization"] = $"Bearer {token}";

        var result = AuthHelpers.AuthenticateClientRequest(context, RequiredProviderOptions());

        if (expectedAllowed)
        {
            Assert.True(result.IsAllowed);
            Assert.Equal("provider-subject", result.Principal?.Subject);
        }
        else
        {
            AssertClientError(
                result,
                StatusCodes.Status401Unauthorized,
                "client auth provider token is required or invalid");
        }
    }

    [Fact]
    public void AuthenticateClientRequest_RequiredProviderModeRejectsStaticTokenFallback()
    {
        using var env = ClearClientAuthEnvironment();
        var context = NewHttpContext("GET", "/api/jobs");
        context.Request.Headers["X-XiaoLou-Client-Token"] = "synthetic-client-token";

        var result = AuthHelpers.AuthenticateClientRequest(
            context,
            RequiredProviderOptions(token: "synthetic-client-token"));

        AssertClientError(
            result,
            StatusCodes.Status401Unauthorized,
            "client auth provider token is required or invalid");
    }

    [Fact]
    public void AuthenticateClientRequest_FallsBackToStaticTokenWhenProviderIsOptional()
    {
        using var env = ClearClientAuthEnvironment();
        var context = NewHttpContext("GET", "/api/jobs");
        context.Request.Headers["Authorization"] = "Bearer invalid.provider.token";
        context.Request.Headers["X-XiaoLou-Client-Token"] = "synthetic-client-token";

        var result = AuthHelpers.AuthenticateClientRequest(
            context,
            new ClientApiOptions
            {
                Token = "synthetic-client-token",
                AuthProvider = "hs256-jwt",
                AuthProviderSecret = "synthetic-provider-secret",
                AllowedPermissions = "jobs:read",
            });

        Assert.True(result.IsAllowed);
        var principal = Assert.IsType<ClientPrincipal>(result.Principal);
        Assert.False(principal.FromAuthProvider);
        Assert.Equal("jobs:read", principal.AllowedPermissions);
    }

    [Theory]
    [InlineData("GET", "/api/admin/retired-review", true)]
    [InlineData("POST", "/api/admin/retired-review", false)]
    public void IsClientPermissionAllowed_FiltersProviderGrantsThroughConfiguredPermissions(
        string method,
        string path,
        bool expected)
    {
        using var env = ClearClientAuthEnvironment();
        var token = CreateProviderJwt(
            "synthetic-provider-secret",
            SyntheticProviderPayload(permissions: "admin:*"));
        var context = NewHttpContext(method, path);
        context.Request.Headers["Authorization"] = $"Bearer {token}";
        var options = RequiredProviderOptions(
            allowedPermissions: "admin:read",
            requireAuthProvider: false);
        var authentication = AuthHelpers.AuthenticateClientRequest(context, options);
        context.Items[ClientPrincipal.ItemKey] = authentication.Principal;

        Assert.True(authentication.IsAllowed);
        Assert.Equal(expected, AuthHelpers.IsClientPermissionAllowed(context, options));
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
    [InlineData("POST", "/api/auth/password/change", "identity:write")]
    [InlineData("POST", "/api/auth/password/admin-reset", "identity:write")]
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
    [InlineData("GET", "/api/playground/models", "playground:read")]
    [InlineData("POST", "/api/media/signed-read-url", "media:read")]
    [InlineData("POST", "/api/jobs/synthetic-job/cancel", "jobs:cancel")]
    [InlineData("GET", "/metrics", null)]
    public void ClientRoutePolicy_MapsPermissionsDirectly(
        string method,
        string path,
        string? expected)
    {
        Assert.Equal(expected, ClientRoutePolicy.GetRequiredClientPermission(method, new PathString(path)));
    }

    [Fact]
    public void ResolvePublicOwnerScope_DefaultsToUserActorAndCnCny()
    {
        var context = NewHttpContext("GET", "/api/projects");
        context.Request.Headers["X-Actor-Id"] = "  synthetic-actor  ";

        var scope = AuthHelpers.ResolvePublicOwnerScope(context, null, null);

        Assert.Null(scope.AccountId);
        Assert.Equal("user", scope.AccountOwnerType);
        Assert.Equal("synthetic-actor", scope.AccountOwnerId);
        Assert.Equal("CN", scope.RegionCode);
        Assert.Equal("CNY", scope.Currency);
    }

    [Fact]
    public void ResolvePublicOwnerScope_UsesOrganizationModeAndExplicitOwner()
    {
        var context = NewHttpContext("POST", "/api/canvas-projects");

        var scope = AuthHelpers.ResolvePublicOwnerScope(
            context,
            accountOwnerType: null,
            accountOwnerId: "  tenant-1  ",
            mode: "organization");

        Assert.Equal("organization", scope.AccountOwnerType);
        Assert.Equal("tenant-1", scope.AccountOwnerId);
        Assert.Equal("CN", scope.RegionCode);
        Assert.Equal("CNY", scope.Currency);
    }

    [Fact]
    public void AuthorizeAccountScope_RequiresConfiguredOwnerGrantWhenEnabled()
    {
        using var env = ClearClientAuthEnvironment();
        var context = NewHttpContext("POST", "/api/projects");
        var options = new ClientApiOptions
        {
            Token = "synthetic-client-token",
            RequireConfiguredAccountGrant = true,
            AllowedAccountOwnerIds = "user:allowed-owner",
        };
        var scope = new AccountScope
        {
            AccountOwnerType = "user",
            AccountOwnerId = "denied-owner",
        };

        var result = InspectResult(AuthHelpers.AuthorizeAccountScope(context, options, scope)!);

        Assert.Equal(StatusCodes.Status403Forbidden, result.StatusCode);
        Assert.Equal(
            """{"error":"account scope is not authorized for this client token"}""",
            result.Body);
    }

    [Fact]
    public void AuthorizeAccountScope_AllowsConfiguredOwnerWildcard()
    {
        using var env = ClearClientAuthEnvironment();
        var context = NewHttpContext("POST", "/api/agent-canvas/projects");
        var options = new ClientApiOptions
        {
            Token = "synthetic-client-token",
            RequireConfiguredAccountGrant = true,
            AllowedAccountOwnerIds = "organization:*",
        };
        var scope = new AccountScope
        {
            AccountOwnerType = "organization",
            AccountOwnerId = "tenant-1",
        };

        Assert.Null(AuthHelpers.AuthorizeAccountScope(context, options, scope));
    }

    [Fact]
    public void AuthorizeAccountId_UsesConfiguredAccountIdGrant()
    {
        using var env = ClearClientAuthEnvironment();
        var allowedAccountId = Guid.Parse("11111111-1111-1111-1111-111111111111");
        var deniedAccountId = Guid.Parse("22222222-2222-2222-2222-222222222222");
        var context = NewHttpContext("POST", "/api/media/signed-read-url");
        var options = new ClientApiOptions
        {
            Token = "synthetic-client-token",
            RequireConfiguredAccountGrant = true,
            AllowedAccountIds = allowedAccountId.ToString("D"),
        };

        Assert.Null(AuthHelpers.AuthorizeAccountId(context, options, allowedAccountId));
        var denied = InspectResult(AuthHelpers.AuthorizeAccountId(context, options, deniedAccountId)!);
        Assert.Equal(StatusCodes.Status403Forbidden, denied.StatusCode);
        Assert.Equal(
            """{"error":"account scope is not authorized for this client token"}""",
            denied.Body);
    }

    [Fact]
    public void AuthorizeAccountId_AllowsProviderGrantWhenConfiguredGrantIsSkipped()
    {
        using var env = ClearClientAuthEnvironment();
        var accountId = Guid.Parse("11111111-1111-1111-1111-111111111111");
        var context = NewHttpContext("GET", "/api/jobs/synthetic-job");
        context.Items[ClientPrincipal.ItemKey] = new ClientPrincipal(
            Subject: "provider-subject",
            FromAuthProvider: true,
            AllowedAccountIds: accountId.ToString("D"),
            AllowedAccountOwnerIds: null,
            AllowedPermissions: "jobs:read");
        var options = new ClientApiOptions
        {
            AuthProvider = "hs256-jwt",
            RequireConfiguredAccountGrant = true,
        };

        Assert.Null(AuthHelpers.AuthorizeAccountId(context, options, accountId, requireConfiguredAccountGrant: false));

        var denied = InspectResult(AuthHelpers.AuthorizeAccountId(context, options, accountId)!);
        Assert.Equal(StatusCodes.Status403Forbidden, denied.StatusCode);
        Assert.Equal(
            """{"error":"account scope is not authorized for this client token"}""",
            denied.Body);
    }

    [Fact]
    public void AuthorizeAccountRow_AllowsProviderOwnerGrantWhenConfiguredGrantIsSkipped()
    {
        using var env = ClearClientAuthEnvironment();
        var accountId = Guid.Parse("11111111-1111-1111-1111-111111111111");
        var context = NewHttpContext("GET", "/api/jobs/synthetic-job");
        context.Items[ClientPrincipal.ItemKey] = new ClientPrincipal(
            Subject: "provider-subject",
            FromAuthProvider: true,
            AllowedAccountIds: null,
            AllowedAccountOwnerIds: "user:root_demo_001",
            AllowedPermissions: "jobs:read");
        var options = new ClientApiOptions
        {
            AuthProvider = "hs256-jwt",
            RequireConfiguredAccountGrant = true,
        };
        var row = new Dictionary<string, object?>
        {
            ["account_id"] = accountId,
            ["account_owner_type"] = "user",
            ["account_owner_id"] = "root_demo_001",
        };

        Assert.Null(AuthHelpers.AuthorizeAccountRow(context, options, row, requireConfiguredAccountGrant: false));

        var denied = InspectResult(AuthHelpers.AuthorizeAccountRow(context, options, row)!);
        Assert.Equal(StatusCodes.Status403Forbidden, denied.StatusCode);
        Assert.Equal(
            """{"error":"account scope is not authorized for this client token"}""",
            denied.Body);
    }

    [Fact]
    public void AuthorizeAccountScope_RequiresAuthProviderPrincipalGrantBeforeConfiguredGrant()
    {
        using var env = ClearClientAuthEnvironment();
        var context = NewHttpContext("POST", "/api/jobs");
        context.Items[ClientPrincipal.ItemKey] = new ClientPrincipal(
            Subject: "provider-subject",
            FromAuthProvider: true,
            AllowedAccountIds: null,
            AllowedAccountOwnerIds: "organization:tenant-1",
            AllowedPermissions: "jobs:*");
        var options = new ClientApiOptions
        {
            AuthProvider = "hs256-jwt",
            RequireConfiguredAccountGrant = true,
            AllowedAccountOwnerIds = "organization:tenant-1",
        };
        var scope = new AccountScope
        {
            AccountOwnerType = "organization",
            AccountOwnerId = "tenant-1",
        };

        Assert.Null(AuthHelpers.AuthorizeAccountScope(context, options, scope));

        var deniedOptions = new ClientApiOptions
        {
            AuthProvider = "hs256-jwt",
            RequireConfiguredAccountGrant = true,
            AllowedAccountOwnerIds = "organization:other-tenant",
        };
        var denied = InspectResult(AuthHelpers.AuthorizeAccountScope(context, deniedOptions, scope)!);
        Assert.Equal(StatusCodes.Status403Forbidden, denied.StatusCode);
        Assert.Equal(
            """{"error":"account scope is not authorized for this client token"}""",
            denied.Body);
    }

    [Fact]
    public void AccountScopeAuthorizer_AllowsConfiguredOwnerWildcardDirectly()
    {
        Assert.True(AccountScopeAuthorizer.IsAccountScopeAllowed(
            principal: null,
            configuredAllowedAccountIds: null,
            configuredAllowedAccountOwnerIds: "organization:*",
            requireConfiguredAccountGrant: true,
            shouldRequireConfiguredAccountGrant: true,
            headerAccountId: null,
            accountId: null,
            headerOwnerType: null,
            headerOwnerId: null,
            ownerType: "organization",
            ownerTypeWasSpecified: true,
            ownerId: "tenant-1"));
    }

    [Fact]
    public void AccountScopeAuthorizer_AllowsHeaderAccountIdWhenConfiguredGrantNotRequired()
    {
        Assert.True(AccountScopeAuthorizer.IsAccountScopeAllowed(
            principal: null,
            configuredAllowedAccountIds: null,
            configuredAllowedAccountOwnerIds: null,
            requireConfiguredAccountGrant: false,
            shouldRequireConfiguredAccountGrant: true,
            headerAccountId: "account-1",
            accountId: "account-1",
            headerOwnerType: null,
            headerOwnerId: null,
            ownerType: "user",
            ownerTypeWasSpecified: false,
            ownerId: null));
    }

    [Fact]
    public void AccountScopeAuthorizer_PreservesUnspecifiedOwnerTypeHeaderCompatibility()
    {
        Assert.True(AccountScopeAuthorizer.IsAccountScopeAllowed(
            principal: null,
            configuredAllowedAccountIds: null,
            configuredAllowedAccountOwnerIds: null,
            requireConfiguredAccountGrant: false,
            shouldRequireConfiguredAccountGrant: true,
            headerAccountId: null,
            accountId: null,
            headerOwnerType: "organization",
            headerOwnerId: "owner-1",
            ownerType: "user",
            ownerTypeWasSpecified: false,
            ownerId: "owner-1"));

        Assert.False(AccountScopeAuthorizer.IsAccountScopeAllowed(
            principal: null,
            configuredAllowedAccountIds: null,
            configuredAllowedAccountOwnerIds: null,
            requireConfiguredAccountGrant: false,
            shouldRequireConfiguredAccountGrant: true,
            headerAccountId: null,
            accountId: null,
            headerOwnerType: "organization",
            headerOwnerId: "owner-1",
            ownerType: "user",
            ownerTypeWasSpecified: true,
            ownerId: "owner-1"));
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

    private static Dictionary<string, object?> SyntheticPermissionContext()
    {
        return new Dictionary<string, object?>
        {
            ["actor"] = new Dictionary<string, object?>
            {
                ["id"] = "actor-1",
            },
            ["currentOrganizationId"] = "tenant-current",
            ["organizations"] = new object[]
            {
                new Dictionary<string, object?>
                {
                    ["id"] = "tenant-enabled",
                    ["status"] = "active",
                },
                new Dictionary<string, object?>
                {
                    ["id"] = "tenant-disabled",
                    ["status"] = "disabled",
                },
            },
        };
    }

    private static ClientApiOptions RequiredProviderOptions(
        string? token = null,
        string? allowedPermissions = null,
        bool requireAuthProvider = true)
    {
        return new ClientApiOptions
        {
            Token = token,
            AuthProvider = "hs256-jwt",
            AuthProviderSecret = "synthetic-provider-secret",
            AuthProviderIssuer = "https://issuer.example.test",
            AuthProviderAudience = "control-api",
            AuthProviderClockSkewSeconds = 60,
            RequireAuthProvider = requireAuthProvider,
            AllowedPermissions = allowedPermissions,
        };
    }

    private static Dictionary<string, object?> SyntheticProviderPayload(
        long? now = null,
        string? permissions = null)
    {
        var timestamp = now ?? DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        return new Dictionary<string, object?>
        {
            ["sub"] = "provider-subject",
            ["iss"] = "https://issuer.example.test",
            ["aud"] = "control-api",
            ["nbf"] = timestamp - 30,
            ["exp"] = timestamp + 300,
            ["xiaolou_account_ids"] = new[] { "account-1", "account-2" },
            ["xiaolou_account_owner_type"] = "organization",
            ["xiaolou_account_owner_ids"] = new[] { "explicit-owner", "organization:explicit-org" },
            ["scope"] = permissions ?? "jobs:read toolbox:write",
            ["scp"] = permissions is null ? new[] { "media:read", "jobs:read" } : Array.Empty<string>(),
        };
    }

    private static string CreateProviderJwt(
        string secret,
        Dictionary<string, object?> payload,
        Dictionary<string, object?>? header = null,
        string? signingSecret = null)
    {
        header ??= new Dictionary<string, object?>
        {
            ["alg"] = "HS256",
            ["typ"] = "JWT",
        };
        var signingInput = $"{Base64UrlEncode(JsonSerializer.SerializeToUtf8Bytes(header))}.{Base64UrlEncode(JsonSerializer.SerializeToUtf8Bytes(payload))}";
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(signingSecret ?? secret));
        var signature = Base64UrlEncode(hmac.ComputeHash(Encoding.ASCII.GetBytes(signingInput)));
        return $"{signingInput}.{signature}";
    }

    private static string[] AssertJwtShape(string? token)
    {
        Assert.False(string.IsNullOrWhiteSpace(token));
        var parts = token.Split('.');
        Assert.Equal(3, parts.Length);
        Assert.All(parts, part => Assert.False(string.IsNullOrWhiteSpace(part)));
        return parts;
    }

    private static JsonElement DecodeJwtJson(string part)
    {
        using var document = JsonDocument.Parse(DecodeBase64Url(part));
        return document.RootElement.Clone();
    }

    private static string[] ReadStringArray(JsonElement payload, string name)
    {
        return payload.GetProperty(name)
            .EnumerateArray()
            .Select(item => item.GetString())
            .Where(item => item is not null)
            .Select(item => item!)
            .ToArray();
    }

    private static void AssertJwtSignature(string secret, string[] parts)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var expected = hmac.ComputeHash(Encoding.ASCII.GetBytes($"{parts[0]}.{parts[1]}"));
        Assert.Equal(expected, DecodeBase64Url(parts[2]));
    }

    private static string Base64UrlEncode(byte[] bytes)
    {
        return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    private static byte[] DecodeBase64Url(string value)
    {
        var padded = value.Replace('-', '+').Replace('_', '/');
        padded = padded.PadRight(padded.Length + (4 - padded.Length % 4) % 4, '=');
        return Convert.FromBase64String(padded);
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
