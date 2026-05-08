using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace XiaoLou.ControlApi.Modules.Auth;

internal static class ClientAssertionFactory
{
    internal static string CreateLocalAuthToken(string actorId)
    {
        return Convert.ToBase64String(Encoding.UTF8.GetBytes($"{actorId}:{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}"));
    }

    internal static string? CreateControlApiClientAssertion(
        Dictionary<string, object?> permissionContext,
        ClientApiOptions options)
    {
        var secret = ClientApiHeaderEnvHelpers.GetConfiguredClientAuthProviderSecret(options);
        if (string.IsNullOrWhiteSpace(secret))
        {
            return null;
        }

        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var ttlSeconds = ClientApiHeaderEnvHelpers.ReadPositiveIntegerOption("CLIENT_API_AUTH_PROVIDER_TTL_SECONDS", 3600);
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

    private static Dictionary<string, object?> BuildControlApiAssertionClaims(
        Dictionary<string, object?> permissionContext,
        ClientApiOptions options,
        long now,
        int ttlSeconds)
    {
        var actor = AuthHelpers.TryReadDictionary(permissionContext, "actor");
        var actorId = AuthHelpers.ReadDictionaryString(actor, "id")
            ?? AuthHelpers.ReadDictionaryString(permissionContext, "actorId")
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

        var issuer = AuthHelpers.NormalizeBlank(ClientApiHeaderEnvHelpers.GetConfiguredClientAuthProviderIssuer(options));
        if (issuer is not null)
        {
            claims["iss"] = issuer;
        }

        var audience = AuthHelpers.NormalizeBlank(ClientApiHeaderEnvHelpers.GetConfiguredClientAuthProviderAudience(options));
        if (audience is not null)
        {
            claims["aud"] = audience;
        }

        var currentOrganizationId = AuthHelpers.ReadDictionaryString(permissionContext, "currentOrganizationId");
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

        if (AuthHelpers.ReadDictionaryEnumerable(permissionContext, "organizations") is { } organizations)
        {
            foreach (var organization in organizations)
            {
                var organizationId = AuthHelpers.ReadDictionaryString(organization, "id");
                var status = AuthHelpers.ReadDictionaryString(organization, "status");
                if (organizationId is null || string.Equals(status, "disabled", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                grants.Add(organizationId);
                grants.Add($"organization:{organizationId}");
            }
        }

        var currentOrganizationId = AuthHelpers.ReadDictionaryString(permissionContext, "currentOrganizationId");
        if (currentOrganizationId is not null)
        {
            grants.Add(currentOrganizationId);
            grants.Add($"organization:{currentOrganizationId}");
        }

        return grants.Distinct(StringComparer.Ordinal).ToArray();
    }

    private static string GetAssertionPermissions(ClientApiOptions options)
    {
        return string.IsNullOrWhiteSpace(ClientApiHeaderEnvHelpers.GetConfiguredAllowedPermissions(options))
            ? DefaultClientApiPermissions()
            : ClientApiHeaderEnvHelpers.GetConfiguredAllowedPermissions(options)!;
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

    private static string Base64UrlEncode(byte[] bytes)
    {
        return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }
}
