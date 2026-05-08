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
            : AuthErrorEnvelopeResponses.PlatformAdminForbidden();
    }

    internal static string CreateLocalAuthToken(string actorId)
    {
        return ClientAssertionFactory.CreateLocalAuthToken(actorId);
    }

    internal static bool TryReadLocalAuthTokenActorId(string? token, out string actorId)
    {
        actorId = "";
        var normalizedToken = NormalizeBlank(token);
        if (normalizedToken is null)
        {
            return false;
        }

        try
        {
            var base64 = normalizedToken.Replace('-', '+').Replace('_', '/');
            base64 = base64.PadRight(base64.Length + (4 - base64.Length % 4) % 4, '=');
            var decoded = Encoding.UTF8.GetString(Convert.FromBase64String(base64));
            var separatorIndex = decoded.LastIndexOf(':');
            if (separatorIndex <= 0 || separatorIndex >= decoded.Length - 1)
            {
                return false;
            }

            if (!long.TryParse(decoded[(separatorIndex + 1)..], out _))
            {
                return false;
            }

            actorId = NormalizeBlank(decoded[..separatorIndex]) ?? "";
            return actorId.Length > 0;
        }
        catch (FormatException)
        {
            return false;
        }
        catch (DecoderFallbackException)
        {
            return false;
        }
    }

    internal static string? CreateControlApiClientAssertion(
        Dictionary<string, object?> permissionContext,
        ClientApiOptions options)
    {
        return ClientAssertionFactory.CreateControlApiClientAssertion(permissionContext, options);
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

    internal static IResult? AuthorizeAccountId(
        HttpContext context,
        ClientApiOptions options,
        Guid? accountId,
        bool requireConfiguredAccountGrant = true)
    {
        if (!IsClientAuthModeEnabled(options) || !ShouldRequireAccountScope(options))
        {
            return null;
        }

        return accountId is not null
            && IsAccountScopeAllowed(context, options, accountId.Value.ToString("D"), null, null, requireConfiguredAccountGrant)
            ? null
            : AccountForbidden();
    }

    internal static IResult? AuthorizeAccountRow(
        HttpContext context,
        ClientApiOptions options,
        Dictionary<string, object?> row,
        bool requireConfiguredAccountGrant = true)
    {
        if (!IsClientAuthModeEnabled(options) || !ShouldRequireAccountScope(options))
        {
            return null;
        }

        var ownerType = TryReadRowString(row, "account_owner_type") ?? "user";
        var ownerId = TryReadRowString(row, "account_owner_id");
        return TryReadAccountId(row, out var accountId)
            && IsAccountScopeAllowed(context, options, accountId.ToString("D"), ownerType, ownerId, requireConfiguredAccountGrant)
            ? null
            : AccountForbidden();
    }

    internal static ClientAuthenticationResult AuthenticateClientRequest(HttpContext context, ClientApiOptions options)
    {
        var authProviderEnabled = ClientAuthProviderValidator.IsClientAuthProviderEnabled(options);
        var authProviderRequired = ClientAuthProviderValidator.ShouldRequireAuthProvider(options);
        if (authProviderEnabled && ReadAuthorizationBearerToken(context) is { } bearerToken)
        {
            if (ClientAuthProviderValidator.TryValidateClientAuthProviderToken(options, bearerToken, out var providerPrincipal))
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
            return ClientAuthProviderValidator.IsProviderPermissionAllowed(
                principal,
                GetConfiguredAllowedPermissions(options),
                requiredPermission);
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
            || ClientAuthProviderValidator.IsClientAuthProviderEnabled(options);
    }

    internal static string? GetConfiguredAllowedAccountIds(ClientApiOptions options)
    {
        return ClientApiHeaderEnvHelpers.GetConfiguredAllowedAccountIds(options);
    }

    internal static string? GetConfiguredAllowedAccountOwnerIds(ClientApiOptions options)
    {
        return ClientApiHeaderEnvHelpers.GetConfiguredAllowedAccountOwnerIds(options);
    }

    internal static string? GetConfiguredAllowedPermissions(ClientApiOptions options)
    {
        return ClientApiHeaderEnvHelpers.GetConfiguredAllowedPermissions(options);
    }

    internal static string? GetConfiguredClientAuthProviderSecret(ClientApiOptions options)
    {
        return ClientApiHeaderEnvHelpers.GetConfiguredClientAuthProviderSecret(options);
    }

    internal static string? GetConfiguredClientAuthProviderIssuer(ClientApiOptions options)
    {
        return ClientApiHeaderEnvHelpers.GetConfiguredClientAuthProviderIssuer(options);
    }

    internal static string? GetConfiguredClientAuthProviderAudience(ClientApiOptions options)
    {
        return ClientApiHeaderEnvHelpers.GetConfiguredClientAuthProviderAudience(options);
    }

    internal static ClientPrincipal? GetClientPrincipal(HttpContext context)
    {
        return ClientApiHeaderEnvHelpers.GetClientPrincipal(context);
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
        return ClientApiHeaderEnvHelpers.ReadHeader(context, name);
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
        return AuthErrorEnvelopeResponses.BadRequestError(exception);
    }

    internal static IResult ForbiddenError(Exception exception)
    {
        return AuthErrorEnvelopeResponses.ForbiddenError(exception);
    }

    internal static bool ContainsCsvGrant(string? csv, string value)
    {
        return AccountScopeAuthorizer.ContainsCsvGrant(csv, value);
    }

    internal static bool HasExternalForwardedAddress(HttpContext context)
    {
        return ClientApiHeaderEnvHelpers.HasExternalForwardedAddress(context);
    }

    internal static bool FixedTimeEquals(string expected, string supplied)
    {
        var expectedBytes = Encoding.UTF8.GetBytes(expected);
        var suppliedBytes = Encoding.UTF8.GetBytes(supplied);
        return suppliedBytes.Length == expectedBytes.Length
            && CryptographicOperations.FixedTimeEquals(expectedBytes, suppliedBytes);
    }

    private static IResult AccountForbidden()
    {
        return AuthErrorEnvelopeResponses.AccountForbidden();
    }

    private static string? GetConfiguredClientToken(ClientApiOptions options)
    {
        return ClientApiHeaderEnvHelpers.GetConfiguredClientToken(options);
    }

    private static bool ShouldRequireAccountScope(ClientApiOptions options)
    {
        return ClientApiHeaderEnvHelpers.ShouldRequireAccountScope(options);
    }

    private static bool ShouldRequireConfiguredAccountGrant(ClientApiOptions options)
    {
        return ClientApiHeaderEnvHelpers.ShouldRequireConfiguredAccountGrant(options);
    }

    internal static bool ReadBoolOption(string envName, bool configuredDefault)
    {
        return ClientApiHeaderEnvHelpers.ReadBoolOption(envName, configuredDefault);
    }

    private static string? ReadClientToken(HttpContext context, ClientApiOptions options)
    {
        return ClientApiHeaderEnvHelpers.ReadClientToken(context, options);
    }

    private static string? ReadAuthorizationBearerToken(HttpContext context)
    {
        return ClientApiHeaderEnvHelpers.ReadAuthorizationBearerToken(context);
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

}
