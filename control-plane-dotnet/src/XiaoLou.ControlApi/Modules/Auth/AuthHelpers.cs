using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using XiaoLou.Domain;
using XiaoLou.Infrastructure.Postgres;

namespace XiaoLou.ControlApi.Modules.Auth;

internal static class AuthHelpers
{
    internal static string ResolveActorId(HttpContext context)
    {
        return NormalizeBlank(GetClientPrincipal(context)?.Subject)
            ?? NormalizeBlank(ReadHeader(context, "X-Actor-Id"))
            ?? "guest";
    }

    internal static async Task<IResult?> AuthorizePlatformAdminAsync(
        HttpContext context,
        PostgresIdentityConfigStore identity,
        CancellationToken cancellationToken)
    {
        var permissionContext = await identity.GetPermissionContextAsync(ResolveActorId(context), cancellationToken);
        var permissions = TryReadDictionary(permissionContext, "permissions");
        var platformRole = ReadDictionaryString(permissionContext, "platformRole")
            ?? ReadDictionaryString(TryReadDictionary(permissionContext, "actor"), "platformRole");
        var allowed = ReadDictionaryBool(permissions, "canManageOps")
            || ReadDictionaryBool(permissions, "canManageSystem")
            || string.Equals(platformRole, "ops_admin", StringComparison.Ordinal)
            || string.Equals(platformRole, "super_admin", StringComparison.Ordinal);

        return allowed
            ? null
            : Results.Json(new
            {
                error = "platform admin permission is required",
            }, statusCode: StatusCodes.Status403Forbidden);
    }

    internal static string CreateLocalAuthToken(string actorId)
    {
        return Convert.ToBase64String(Encoding.UTF8.GetBytes($"{actorId}:{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}"));
    }

    internal static string? CreateControlApiClientAssertion(
        Dictionary<string, object?> permissionContext,
        ClientApiOptions options)
    {
        var secret = GetConfiguredClientAuthProviderSecret(options);
        if (string.IsNullOrWhiteSpace(secret))
        {
            return null;
        }

        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var ttlSeconds = ReadPositiveIntegerOption("CLIENT_API_AUTH_PROVIDER_TTL_SECONDS", 3600);
        var header = new Dictionary<string, object?>
        {
            ["alg"] = "HS256",
            ["typ"] = "JWT",
        };
        var claims = BuildControlApiAssertionClaims(permissionContext, options, now, ttlSeconds);
        var signingInput = $"{Base64UrlEncode(JsonSerializer.SerializeToUtf8Bytes(header))}.{Base64UrlEncode(JsonSerializer.SerializeToUtf8Bytes(claims))}";
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret.Trim()));
        var signature = Base64UrlEncode(hmac.ComputeHash(Encoding.ASCII.GetBytes(signingInput)));
        return $"{signingInput}.{signature}";
    }

    internal static Dictionary<string, object?>? TryReadDictionary(Dictionary<string, object?>? source, string key)
    {
        return source is not null && source.TryGetValue(key, out var value)
            ? value as Dictionary<string, object?>
            : null;
    }

    internal static IEnumerable<Dictionary<string, object?>>? ReadDictionaryEnumerable(Dictionary<string, object?> source, string key)
    {
        if (!source.TryGetValue(key, out var value) || value is null)
        {
            return null;
        }

        return value switch
        {
            IEnumerable<Dictionary<string, object?>> typed => typed,
            IEnumerable<object> items => items.OfType<Dictionary<string, object?>>(),
            _ => null,
        };
    }

    internal static string? ReadDictionaryString(Dictionary<string, object?>? source, string key)
    {
        return source is not null && source.TryGetValue(key, out var value) && value is not null
            ? NormalizeBlank(Convert.ToString(value))
            : null;
    }

    internal static bool ReadDictionaryBool(Dictionary<string, object?>? source, string key)
    {
        if (source is null || !source.TryGetValue(key, out var value) || value is null)
        {
            return false;
        }

        return value switch
        {
            bool boolValue => boolValue,
            JsonElement { ValueKind: JsonValueKind.True } => true,
            JsonElement { ValueKind: JsonValueKind.False } => false,
            JsonElement { ValueKind: JsonValueKind.String } element => bool.TryParse(element.GetString(), out var parsed) && parsed,
            _ => bool.TryParse(Convert.ToString(value), out var parsed) && parsed,
        };
    }

    internal static bool IsPublicClientApiRequest(HttpContext context)
    {
        return ClientRoutePolicy.IsPublicClientApiRequest(context.Request.Path);
    }

    internal static bool IsAnonymousIdentityRequest(HttpContext context)
    {
        return ClientRoutePolicy.IsAnonymousIdentityRequest(context.Request.Method, context.Request.Path);
    }

    internal static AccountScope ResolvePublicOwnerScope(
        HttpContext context,
        string? accountOwnerType,
        string? accountOwnerId,
        string? mode = null)
    {
        var ownerType = NormalizeOwnerType(accountOwnerType)
            ?? (string.Equals(mode, "organization", StringComparison.OrdinalIgnoreCase) ? "organization" : "user");
        var ownerId = NormalizeBlank(accountOwnerId)
            ?? NormalizeBlank(ReadHeader(context, "X-Actor-Id"))
            ?? NormalizeBlank(GetClientPrincipal(context)?.Subject)
            ?? "guest";

        return new AccountScope
        {
            AccountOwnerType = ownerType,
            AccountOwnerId = ownerId,
            RegionCode = "CN",
            Currency = "CNY",
        };
    }

    internal static IResult? AuthorizeAccountScope(
        HttpContext context,
        ClientApiOptions options,
        AccountScope scope,
        bool requireConfiguredAccountGrant = true)
    {
        if (!IsClientAuthModeEnabled(options) || !ShouldRequireAccountScope(options))
        {
            return null;
        }

        var accountId = NormalizeBlank(scope.AccountId);
        var ownerType = NormalizeOwnerType(scope.AccountOwnerType);
        var ownerId = NormalizeBlank(scope.AccountOwnerId);
        return IsAccountScopeAllowed(context, options, accountId, ownerType, ownerId, requireConfiguredAccountGrant)
            ? null
            : AccountForbidden();
    }

    internal static IResult? AuthorizeAccountId(HttpContext context, ClientApiOptions options, Guid? accountId)
    {
        if (!IsClientAuthModeEnabled(options) || !ShouldRequireAccountScope(options))
        {
            return null;
        }

        return accountId is not null
            && IsAccountScopeAllowed(context, options, accountId.Value.ToString("D"), null, null)
            ? null
            : AccountForbidden();
    }

    internal static IResult? AuthorizeAccountRow(
        HttpContext context,
        ClientApiOptions options,
        Dictionary<string, object?> row)
    {
        if (!IsClientAuthModeEnabled(options) || !ShouldRequireAccountScope(options))
        {
            return null;
        }

        var ownerType = TryReadRowString(row, "account_owner_type") ?? "user";
        var ownerId = TryReadRowString(row, "account_owner_id");
        return TryReadAccountId(row, out var accountId)
            && IsAccountScopeAllowed(context, options, accountId.ToString("D"), ownerType, ownerId)
            ? null
            : AccountForbidden();
    }

    internal static ClientAuthenticationResult AuthenticateClientRequest(HttpContext context, ClientApiOptions options)
    {
        var authProviderEnabled = IsClientAuthProviderEnabled(options);
        var authProviderRequired = ShouldRequireAuthProvider(options);
        if (authProviderEnabled && ReadAuthorizationBearerToken(context) is { } bearerToken)
        {
            if (TryValidateClientAuthProviderToken(options, bearerToken, out var providerPrincipal))
            {
                return ClientAuthenticationResult.Allowed(providerPrincipal);
            }

            if (authProviderRequired)
            {
                return ClientAuthenticationResult.Unauthorized("client auth provider token is required or invalid");
            }
        }

        if (authProviderRequired)
        {
            return ClientAuthenticationResult.Unauthorized("client auth provider token is required or invalid");
        }

        var expectedToken = GetConfiguredClientToken(options);
        if (expectedToken is not null)
        {
            var supplied = ReadClientToken(context, options);
            return supplied is not null && FixedTimeEquals(expectedToken, supplied)
                ? ClientAuthenticationResult.Allowed(ClientPrincipal.ForStaticToken(
                    GetConfiguredAllowedAccountIds(options),
                    GetConfiguredAllowedAccountOwnerIds(options),
                    GetConfiguredAllowedPermissions(options)))
                : ClientAuthenticationResult.Unauthorized("client API token is required or invalid");
        }

        if (authProviderEnabled)
        {
            return ClientAuthenticationResult.Unauthorized("client auth provider token is required or invalid");
        }

        if (HasExternalForwardedAddress(context))
        {
            return ClientAuthenticationResult.Forbidden("client API is not available from this request context");
        }

        var remoteIp = context.Connection.RemoteIpAddress;
        return remoteIp is null || IPAddress.IsLoopback(remoteIp)
            ? ClientAuthenticationResult.Allowed(null)
            : ClientAuthenticationResult.Forbidden("client API is not available from this request context");
    }

    internal static bool IsClientPermissionAllowed(HttpContext context, ClientApiOptions options)
    {
        if (!IsClientAuthModeEnabled(options))
        {
            return true;
        }

        var requiredPermission = GetRequiredClientPermission(context);
        if (requiredPermission is null)
        {
            return false;
        }

        var principal = GetClientPrincipal(context);
        if (principal?.FromAuthProvider == true)
        {
            if (!ContainsCsvGrant(principal.AllowedPermissions, requiredPermission))
            {
                return false;
            }

            var configuredPermissions = GetConfiguredAllowedPermissions(options);
            return string.IsNullOrWhiteSpace(configuredPermissions)
                || ContainsCsvGrant(configuredPermissions, requiredPermission);
        }

        var allowedPermissions = principal?.AllowedPermissions ?? GetConfiguredAllowedPermissions(options);
        return string.IsNullOrWhiteSpace(allowedPermissions)
            || ContainsCsvGrant(allowedPermissions, requiredPermission);
    }

    internal static string? GetRequiredClientPermission(HttpContext context)
    {
        return ClientRoutePolicy.GetRequiredClientPermission(context.Request.Method, context.Request.Path);
    }

    internal static bool IsClientAuthModeEnabled(ClientApiOptions options)
    {
        return GetConfiguredClientToken(options) is not null
            || IsClientAuthProviderEnabled(options);
    }

    internal static string? GetConfiguredAllowedAccountIds(ClientApiOptions options)
    {
        return string.IsNullOrWhiteSpace(options.AllowedAccountIds)
            ? Environment.GetEnvironmentVariable("CLIENT_API_ALLOWED_ACCOUNT_IDS")
            : options.AllowedAccountIds;
    }

    internal static string? GetConfiguredAllowedAccountOwnerIds(ClientApiOptions options)
    {
        return string.IsNullOrWhiteSpace(options.AllowedAccountOwnerIds)
            ? Environment.GetEnvironmentVariable("CLIENT_API_ALLOWED_ACCOUNT_OWNER_IDS")
            : options.AllowedAccountOwnerIds;
    }

    internal static string? GetConfiguredAllowedPermissions(ClientApiOptions options)
    {
        return JoinGrantLists(
            options.AllowedPermissions,
            Environment.GetEnvironmentVariable("ClientApi__AllowedPermissions"),
            Environment.GetEnvironmentVariable("CLIENT_API_ALLOWED_PERMISSIONS"),
            Environment.GetEnvironmentVariable("CONTROL_API_CLIENT_ASSERTION_PERMISSIONS"));
    }

    internal static string? GetConfiguredClientAuthProviderSecret(ClientApiOptions options)
    {
        return string.IsNullOrWhiteSpace(options.AuthProviderSecret)
            ? Environment.GetEnvironmentVariable("CLIENT_API_AUTH_PROVIDER_SECRET")
            : options.AuthProviderSecret;
    }

    internal static string? GetConfiguredClientAuthProviderIssuer(ClientApiOptions options)
    {
        return string.IsNullOrWhiteSpace(options.AuthProviderIssuer)
            ? Environment.GetEnvironmentVariable("CLIENT_API_AUTH_PROVIDER_ISSUER")
            : options.AuthProviderIssuer;
    }

    internal static string? GetConfiguredClientAuthProviderAudience(ClientApiOptions options)
    {
        return string.IsNullOrWhiteSpace(options.AuthProviderAudience)
            ? Environment.GetEnvironmentVariable("CLIENT_API_AUTH_PROVIDER_AUDIENCE")
            : options.AuthProviderAudience;
    }

    internal static ClientPrincipal? GetClientPrincipal(HttpContext context)
    {
        return context.Items.TryGetValue(ClientPrincipal.ItemKey, out var value)
            ? value as ClientPrincipal
            : null;
    }

    internal static bool TryReadAccountId(Dictionary<string, object?> row, out Guid accountId)
    {
        accountId = default;
        if (!row.TryGetValue("account_id", out var value) || value is null)
        {
            return false;
        }

        if (value is Guid guid)
        {
            accountId = guid;
            return true;
        }

        return Guid.TryParse(value.ToString(), out accountId);
    }

    internal static string? TryReadRowString(Dictionary<string, object?> row, string key)
    {
        return row.TryGetValue(key, out var value) && value is not null
            ? NormalizeBlank(value.ToString())
            : null;
    }

    internal static string? ReadJsonString(JsonElement element, string propertyName)
    {
        if (element.ValueKind != JsonValueKind.Object
            || !element.TryGetProperty(propertyName, out var value)
            || value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return null;
        }

        return value.ValueKind == JsonValueKind.String
            ? NormalizeBlank(value.GetString())
            : NormalizeBlank(value.ToString());
    }

    internal static string? ReadHeader(HttpContext context, string name)
    {
        return context.Request.Headers[name].FirstOrDefault();
    }

    internal static string? NormalizeBlank(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    internal static string? NormalizeGuidText(string? value)
    {
        return Guid.TryParse(value, out var guid) ? guid.ToString("D") : NormalizeBlank(value);
    }

    internal static string? NormalizeOwnerType(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim().ToLowerInvariant();
    }

    internal static IResult BadRequestError(Exception exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }

    internal static IResult ForbiddenError(Exception exception)
    {
        return Results.Json(new { error = exception.Message }, statusCode: StatusCodes.Status403Forbidden);
    }

    internal static bool ContainsCsvGrant(string? csv, string value)
    {
        return AccountScopeAuthorizer.ContainsCsvGrant(csv, value);
    }

    internal static bool HasExternalForwardedAddress(HttpContext context)
    {
        foreach (var headerName in new[] { "X-Forwarded-For", "X-Real-IP" })
        {
            foreach (var raw in context.Request.Headers[headerName])
            {
                if (string.IsNullOrWhiteSpace(raw))
                {
                    continue;
                }

                foreach (var part in raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                {
                    if (IPAddress.TryParse(part, out var parsed) && !IPAddress.IsLoopback(parsed))
                    {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    internal static bool FixedTimeEquals(string expected, string supplied)
    {
        var expectedBytes = Encoding.UTF8.GetBytes(expected);
        var suppliedBytes = Encoding.UTF8.GetBytes(supplied);
        return suppliedBytes.Length == expectedBytes.Length
            && CryptographicOperations.FixedTimeEquals(expectedBytes, suppliedBytes);
    }

    private static Dictionary<string, object?> BuildControlApiAssertionClaims(
        Dictionary<string, object?> permissionContext,
        ClientApiOptions options,
        long now,
        int ttlSeconds)
    {
        var actor = TryReadDictionary(permissionContext, "actor");
        var actorId = ReadDictionaryString(actor, "id")
            ?? ReadDictionaryString(permissionContext, "actorId")
            ?? "guest";
        var claims = new Dictionary<string, object?>
        {
            ["sub"] = actorId,
            ["iat"] = now,
            ["nbf"] = now - 30,
            ["exp"] = now + ttlSeconds,
            ["jti"] = Guid.NewGuid().ToString("D"),
            ["xiaolou_account_owner_type"] = "user",
            ["xiaolou_account_owner_ids"] = CollectOwnerGrants(permissionContext, actorId),
            ["xiaolou_permissions"] = NormalizeGrantArray(GetAssertionPermissions(options)),
        };

        var issuer = NormalizeBlank(GetConfiguredClientAuthProviderIssuer(options));
        if (issuer is not null)
        {
            claims["iss"] = issuer;
        }

        var audience = NormalizeBlank(GetConfiguredClientAuthProviderAudience(options));
        if (audience is not null)
        {
            claims["aud"] = audience;
        }

        var currentOrganizationId = ReadDictionaryString(permissionContext, "currentOrganizationId");
        if (currentOrganizationId is not null)
        {
            claims["xiaolou_current_organization_id"] = currentOrganizationId;
        }

        return claims;
    }

    private static string[] CollectOwnerGrants(Dictionary<string, object?> permissionContext, string actorId)
    {
        var grants = new List<string>
        {
            actorId,
            $"user:{actorId}",
        };

        if (ReadDictionaryEnumerable(permissionContext, "organizations") is { } organizations)
        {
            foreach (var organization in organizations)
            {
                var organizationId = ReadDictionaryString(organization, "id");
                var status = ReadDictionaryString(organization, "status");
                if (organizationId is null || string.Equals(status, "disabled", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                grants.Add(organizationId);
                grants.Add($"organization:{organizationId}");
            }
        }

        var currentOrganizationId = ReadDictionaryString(permissionContext, "currentOrganizationId");
        if (currentOrganizationId is not null)
        {
            grants.Add(currentOrganizationId);
            grants.Add($"organization:{currentOrganizationId}");
        }

        return grants.Distinct(StringComparer.Ordinal).ToArray();
    }

    private static string GetAssertionPermissions(ClientApiOptions options)
    {
        return string.IsNullOrWhiteSpace(GetConfiguredAllowedPermissions(options))
            ? DefaultClientApiPermissions()
            : GetConfiguredAllowedPermissions(options)!;
    }

    private static string DefaultClientApiPermissions()
    {
        return "accounts:ensure,jobs:create,jobs:read,jobs:cancel,wallet:read,media:read,media:write,projects:read,projects:write,canvas:read,canvas:write,create:read,create:write,identity:read,identity:write,organization:read,organization:write,api-center:read,api-center:write,admin:read,admin:write,enterprise-applications:read,enterprise-applications:write,playground:read,playground:write,toolbox:read,toolbox:write";
    }

    private static string[] NormalizeGrantArray(string value)
    {
        return value.Split(',', ';', ' ', '\t', '\r', '\n')
            .Select(item => item.Trim())
            .Where(item => item.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static int ReadPositiveIntegerOption(string envName, int fallback)
    {
        var raw = Environment.GetEnvironmentVariable(envName);
        return int.TryParse(raw, out var value) && value > 0 ? value : fallback;
    }

    private static string Base64UrlEncode(byte[] bytes)
    {
        return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    private static IResult AccountForbidden()
    {
        return Results.Json(new
        {
            error = "account scope is not authorized for this client token",
        }, statusCode: StatusCodes.Status403Forbidden);
    }

    private static bool IsClientAuthProviderEnabled(ClientApiOptions options)
    {
        return string.Equals(GetConfiguredClientAuthProvider(options), "hs256-jwt", StringComparison.OrdinalIgnoreCase);
    }

    private static string? GetConfiguredClientAuthProvider(ClientApiOptions options)
    {
        var configuredProvider = string.IsNullOrWhiteSpace(options.AuthProvider)
            ? Environment.GetEnvironmentVariable("CLIENT_API_AUTH_PROVIDER")
            : options.AuthProvider;
        var provider = string.IsNullOrWhiteSpace(configuredProvider) ? null : configuredProvider.Trim();
        if (provider is not null && string.Equals(provider, "jwt-hs256", StringComparison.OrdinalIgnoreCase))
        {
            return "hs256-jwt";
        }

        return provider;
    }

    private static string? GetConfiguredClientToken(ClientApiOptions options)
    {
        var configuredToken = string.IsNullOrWhiteSpace(options.Token)
            ? Environment.GetEnvironmentVariable("CLIENT_API_TOKEN")
            : options.Token;
        var expectedToken = string.IsNullOrWhiteSpace(configuredToken) ? null : configuredToken.Trim();
        return expectedToken;
    }

    private static string GetConfiguredClientTokenHeader(ClientApiOptions options)
    {
        var configuredHeader = Environment.GetEnvironmentVariable("CLIENT_API_TOKEN_HEADER");
        if (string.IsNullOrWhiteSpace(configuredHeader))
        {
            configuredHeader = options.TokenHeader;
        }

        return string.IsNullOrWhiteSpace(configuredHeader)
            ? "X-XiaoLou-Client-Token"
            : configuredHeader.Trim();
    }

    private static bool ShouldRequireAccountScope(ClientApiOptions options)
    {
        return ReadBoolOption("CLIENT_API_REQUIRE_ACCOUNT_SCOPE", options.RequireAccountScope);
    }

    private static bool ShouldRequireConfiguredAccountGrant(ClientApiOptions options)
    {
        return ReadBoolOption("CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT", options.RequireConfiguredAccountGrant);
    }

    private static bool ShouldRequireAuthProvider(ClientApiOptions options)
    {
        return ReadBoolOption("CLIENT_API_REQUIRE_AUTH_PROVIDER", options.RequireAuthProvider);
    }

    internal static bool ReadBoolOption(string envName, bool configuredDefault)
    {
        var raw = Environment.GetEnvironmentVariable(envName);
        if (string.IsNullOrWhiteSpace(raw))
        {
            return configuredDefault;
        }

        return raw.Trim().ToLowerInvariant() switch
        {
            "1" or "true" or "yes" or "on" => true,
            "0" or "false" or "no" or "off" => false,
            _ => configuredDefault,
        };
    }

    private static string? ReadClientToken(HttpContext context, ClientApiOptions options)
    {
        var headerName = GetConfiguredClientTokenHeader(options);
        var headerValue = ReadHeader(context, headerName);
        if (!string.IsNullOrWhiteSpace(headerValue))
        {
            return headerValue.Trim();
        }

        var authorization = ReadHeader(context, "Authorization");
        const string bearerPrefix = "Bearer ";
        return authorization is not null && authorization.StartsWith(bearerPrefix, StringComparison.OrdinalIgnoreCase)
            ? authorization[bearerPrefix.Length..].Trim()
            : null;
    }

    private static string? ReadAuthorizationBearerToken(HttpContext context)
    {
        var authorization = ReadHeader(context, "Authorization");
        const string bearerPrefix = "Bearer ";
        return authorization is not null && authorization.StartsWith(bearerPrefix, StringComparison.OrdinalIgnoreCase)
            ? authorization[bearerPrefix.Length..].Trim()
            : null;
    }

    private static bool IsAccountScopeAllowed(
        HttpContext context,
        ClientApiOptions options,
        string? accountId,
        string? ownerType,
        string? ownerId,
        bool requireConfiguredAccountGrant = true)
    {
        var headerAccountId = NormalizeGuidText(ReadHeader(context, "X-XiaoLou-Account-Id"));
        var normalizedAccountId = NormalizeGuidText(accountId);
        var headerOwnerId = NormalizeBlank(ReadHeader(context, "X-XiaoLou-Account-Owner-Id"));
        var headerOwnerType = NormalizeOwnerType(ReadHeader(context, "X-XiaoLou-Account-Owner-Type"));
        var normalizedOwnerType = ownerType ?? "user";
        return AccountScopeAuthorizer.IsAccountScopeAllowed(
            GetClientPrincipal(context),
            GetConfiguredAllowedAccountIds(options),
            GetConfiguredAllowedAccountOwnerIds(options),
            requireConfiguredAccountGrant,
            ShouldRequireConfiguredAccountGrant(options),
            headerAccountId,
            normalizedAccountId,
            headerOwnerType,
            headerOwnerId,
            normalizedOwnerType,
            ownerType is not null,
            ownerId);
    }

    private static int GetClientAuthProviderClockSkewSeconds(ClientApiOptions options)
    {
        var raw = Environment.GetEnvironmentVariable("CLIENT_API_AUTH_PROVIDER_CLOCK_SKEW_SECONDS");
        if (int.TryParse(raw, out var envValue))
        {
            return Math.Clamp(envValue, 0, 300);
        }

        return Math.Clamp(options.AuthProviderClockSkewSeconds, 0, 300);
    }

    private static bool TryValidateClientAuthProviderToken(
        ClientApiOptions options,
        string token,
        out ClientPrincipal? principal)
    {
        principal = null;
        var secret = GetConfiguredClientAuthProviderSecret(options);
        if (string.IsNullOrWhiteSpace(secret))
        {
            return false;
        }

        var parts = token.Split('.');
        if (parts.Length != 3 || parts.Any(string.IsNullOrWhiteSpace))
        {
            return false;
        }

        byte[] headerBytes;
        byte[] payloadBytes;
        byte[] signatureBytes;
        try
        {
            headerBytes = DecodeBase64Url(parts[0]);
            payloadBytes = DecodeBase64Url(parts[1]);
            signatureBytes = DecodeBase64Url(parts[2]);
        }
        catch (FormatException)
        {
            return false;
        }

        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret.Trim()));
        var expectedSignature = hmac.ComputeHash(Encoding.ASCII.GetBytes($"{parts[0]}.{parts[1]}"));
        if (signatureBytes.Length != expectedSignature.Length
            || !CryptographicOperations.FixedTimeEquals(signatureBytes, expectedSignature))
        {
            return false;
        }

        try
        {
            using var headerJson = JsonDocument.Parse(headerBytes);
            if (!headerJson.RootElement.TryGetProperty("alg", out var alg)
                || !string.Equals(alg.GetString(), "HS256", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            using var payloadJson = JsonDocument.Parse(payloadBytes);
            var payload = payloadJson.RootElement;
            if (!IsClientAuthProviderIssuerAllowed(options, payload)
                || !IsClientAuthProviderAudienceAllowed(options, payload)
                || !IsClientAuthProviderTimeWindowAllowed(options, payload))
            {
                return false;
            }

            var subject = ReadStringClaim(payload, "sub");
            var ownerType = ReadStringClaim(payload, "xiaolou_account_owner_type") ?? "user";
            var accountOwnerIds = ReadClaimGrantList(
                payload,
                "xiaolou_account_owner_ids",
                "account_owner_ids",
                "owner_ids",
                "owner_id");
            if (!string.IsNullOrWhiteSpace(subject))
            {
                accountOwnerIds = JoinGrantLists(accountOwnerIds, subject, $"{ownerType}:{subject}");
            }

            principal = new ClientPrincipal(
                Subject: subject,
                FromAuthProvider: true,
                AllowedAccountIds: ReadClaimGrantList(payload, "xiaolou_account_ids", "account_ids", "account_id"),
                AllowedAccountOwnerIds: accountOwnerIds,
                AllowedPermissions: ReadClaimGrantList(payload, "xiaolou_permissions", "permissions", "scope", "scp"));
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static bool IsClientAuthProviderIssuerAllowed(ClientApiOptions options, JsonElement payload)
    {
        var configuredIssuer = NormalizeBlank(GetConfiguredClientAuthProviderIssuer(options));
        if (configuredIssuer is null)
        {
            return true;
        }

        return string.Equals(ReadStringClaim(payload, "iss"), configuredIssuer, StringComparison.Ordinal);
    }

    private static bool IsClientAuthProviderAudienceAllowed(ClientApiOptions options, JsonElement payload)
    {
        var configuredAudience = NormalizeBlank(GetConfiguredClientAuthProviderAudience(options));
        if (configuredAudience is null)
        {
            return true;
        }

        if (!payload.TryGetProperty("aud", out var aud))
        {
            return false;
        }

        if (aud.ValueKind == JsonValueKind.String)
        {
            return string.Equals(aud.GetString(), configuredAudience, StringComparison.Ordinal);
        }

        if (aud.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in aud.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.String
                    && string.Equals(item.GetString(), configuredAudience, StringComparison.Ordinal))
                {
                    return true;
                }
            }
        }

        return false;
    }

    private static bool IsClientAuthProviderTimeWindowAllowed(ClientApiOptions options, JsonElement payload)
    {
        if (!payload.TryGetProperty("exp", out var exp) || !TryReadUnixSeconds(exp, out var expiresAt))
        {
            return false;
        }

        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var skew = GetClientAuthProviderClockSkewSeconds(options);
        if (now - skew > expiresAt)
        {
            return false;
        }

        if (!payload.TryGetProperty("nbf", out var nbf))
        {
            return true;
        }

        return TryReadUnixSeconds(nbf, out var notBefore)
            && now + skew >= notBefore;
    }

    private static bool TryReadUnixSeconds(JsonElement element, out long value)
    {
        value = 0;
        return element.ValueKind switch
        {
            JsonValueKind.Number => element.TryGetInt64(out value),
            JsonValueKind.String => long.TryParse(element.GetString(), out value),
            _ => false,
        };
    }

    private static string? ReadStringClaim(JsonElement payload, string name)
    {
        return payload.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? NormalizeBlank(value.GetString())
            : null;
    }

    private static string? ReadClaimGrantList(JsonElement payload, params string[] names)
    {
        var grants = new List<string>();
        foreach (var name in names)
        {
            if (!payload.TryGetProperty(name, out var value))
            {
                continue;
            }

            if (value.ValueKind == JsonValueKind.String)
            {
                AddGrantValues(grants, value.GetString());
            }
            else if (value.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in value.EnumerateArray())
                {
                    if (item.ValueKind == JsonValueKind.String)
                    {
                        AddGrantValues(grants, item.GetString());
                    }
                }
            }
        }

        return grants.Count == 0
            ? null
            : string.Join(",", grants.Distinct(StringComparer.OrdinalIgnoreCase));
    }

    private static void AddGrantValues(List<string> grants, string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return;
        }

        grants.AddRange(raw.Split(
                new[] { ',', ';', ' ', '\r', '\n', '\t' },
                StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(item => !string.IsNullOrWhiteSpace(item)));
    }

    private static string? JoinGrantLists(params string?[] values)
    {
        var grants = new List<string>();
        foreach (var value in values)
        {
            AddGrantValues(grants, value);
        }

        return grants.Count == 0
            ? null
            : string.Join(",", grants.Distinct(StringComparer.OrdinalIgnoreCase));
    }

    private static byte[] DecodeBase64Url(string value)
    {
        var padded = value.Replace('-', '+').Replace('_', '/');
        padded = padded.PadRight(padded.Length + (4 - padded.Length % 4) % 4, '=');
        return Convert.FromBase64String(padded);
    }

}

internal sealed class ClientApiOptions
{
    public string? Token { get; init; }

    public string TokenHeader { get; init; } = "X-XiaoLou-Client-Token";

    public string? AuthProvider { get; init; }

    public string? AuthProviderSecret { get; init; }

    public string? AuthProviderIssuer { get; init; }

    public string? AuthProviderAudience { get; init; }

    public int AuthProviderClockSkewSeconds { get; init; } = 60;

    public bool RequireAuthProvider { get; init; }

    public bool RequireAccountScope { get; init; } = true;

    public bool RequireConfiguredAccountGrant { get; init; }

    public string? AllowedAccountIds { get; init; }

    public string? AllowedAccountOwnerIds { get; init; }

    public string? AllowedPermissions { get; init; }
}

internal sealed record ClientAuthenticationResult(
    bool IsAllowed,
    int StatusCode,
    string Error,
    ClientPrincipal? Principal)
{
    public static ClientAuthenticationResult Allowed(ClientPrincipal? principal)
    {
        return new ClientAuthenticationResult(true, StatusCodes.Status200OK, "", principal);
    }

    public static ClientAuthenticationResult Unauthorized(string error)
    {
        return new ClientAuthenticationResult(false, StatusCodes.Status401Unauthorized, error, null);
    }

    public static ClientAuthenticationResult Forbidden(string error)
    {
        return new ClientAuthenticationResult(false, StatusCodes.Status403Forbidden, error, null);
    }
}

internal sealed record ClientPrincipal(
    string? Subject,
    bool FromAuthProvider,
    string? AllowedAccountIds,
    string? AllowedAccountOwnerIds,
    string? AllowedPermissions)
{
    public const string ItemKey = "xiaolou.client.principal";

    public static ClientPrincipal ForStaticToken(
        string? allowedAccountIds,
        string? allowedAccountOwnerIds,
        string? allowedPermissions)
    {
        return new ClientPrincipal(null, false, allowedAccountIds, allowedAccountOwnerIds, allowedPermissions);
    }
}
