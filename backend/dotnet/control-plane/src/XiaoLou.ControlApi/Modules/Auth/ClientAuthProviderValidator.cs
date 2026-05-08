using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace XiaoLou.ControlApi.Modules.Auth;

internal static class ClientAuthProviderValidator
{
    internal static bool IsClientAuthProviderEnabled(ClientApiOptions options)
    {
        return ClientApiHeaderEnvHelpers.IsClientAuthProviderEnabled(options);
    }

    internal static bool ShouldRequireAuthProvider(ClientApiOptions options)
    {
        return ClientApiHeaderEnvHelpers.ShouldRequireAuthProvider(options);
    }

    internal static bool TryValidateClientAuthProviderToken(
        ClientApiOptions options,
        string token,
        out ClientPrincipal? principal)
    {
        principal = null;
        var secret = ClientApiHeaderEnvHelpers.GetConfiguredClientAuthProviderSecret(options);
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

    internal static bool IsProviderPermissionAllowed(
        ClientPrincipal principal,
        string? configuredPermissions,
        string requiredPermission)
    {
        if (!AccountScopeAuthorizer.ContainsCsvGrant(principal.AllowedPermissions, requiredPermission))
        {
            return false;
        }

        return string.IsNullOrWhiteSpace(configuredPermissions)
            || AccountScopeAuthorizer.ContainsCsvGrant(configuredPermissions, requiredPermission);
    }

    private static bool IsClientAuthProviderIssuerAllowed(ClientApiOptions options, JsonElement payload)
    {
        var configuredIssuer = AuthHelpers.NormalizeBlank(
            ClientApiHeaderEnvHelpers.GetConfiguredClientAuthProviderIssuer(options));
        if (configuredIssuer is null)
        {
            return true;
        }

        return string.Equals(ReadStringClaim(payload, "iss"), configuredIssuer, StringComparison.Ordinal);
    }

    private static bool IsClientAuthProviderAudienceAllowed(ClientApiOptions options, JsonElement payload)
    {
        var configuredAudience = AuthHelpers.NormalizeBlank(
            ClientApiHeaderEnvHelpers.GetConfiguredClientAuthProviderAudience(options));
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
        var skew = ClientApiHeaderEnvHelpers.GetClientAuthProviderClockSkewSeconds(options);
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
            ? AuthHelpers.NormalizeBlank(value.GetString())
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
