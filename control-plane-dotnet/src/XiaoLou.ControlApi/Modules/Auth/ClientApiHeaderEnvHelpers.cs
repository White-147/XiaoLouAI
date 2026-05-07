using System.Net;
using Microsoft.AspNetCore.Http;

namespace XiaoLou.ControlApi.Modules.Auth;

internal static class ClientApiHeaderEnvHelpers
{
    internal static string? ReadHeader(HttpContext context, string name)
    {
        return context.Request.Headers[name].FirstOrDefault();
    }

    internal static ClientPrincipal? GetClientPrincipal(HttpContext context)
    {
        return context.Items.TryGetValue(ClientPrincipal.ItemKey, out var value)
            ? value as ClientPrincipal
            : null;
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

    internal static bool IsClientAuthProviderEnabled(ClientApiOptions options)
    {
        return string.Equals(GetConfiguredClientAuthProvider(options), "hs256-jwt", StringComparison.OrdinalIgnoreCase);
    }

    internal static string? GetConfiguredClientAuthProvider(ClientApiOptions options)
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

    internal static string? GetConfiguredClientToken(ClientApiOptions options)
    {
        var configuredToken = string.IsNullOrWhiteSpace(options.Token)
            ? Environment.GetEnvironmentVariable("CLIENT_API_TOKEN")
            : options.Token;
        return string.IsNullOrWhiteSpace(configuredToken) ? null : configuredToken.Trim();
    }

    internal static string GetConfiguredClientTokenHeader(ClientApiOptions options)
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

    internal static bool ShouldRequireAccountScope(ClientApiOptions options)
    {
        return ReadBoolOption("CLIENT_API_REQUIRE_ACCOUNT_SCOPE", options.RequireAccountScope);
    }

    internal static bool ShouldRequireConfiguredAccountGrant(ClientApiOptions options)
    {
        return ReadBoolOption("CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT", options.RequireConfiguredAccountGrant);
    }

    internal static bool ShouldRequireAuthProvider(ClientApiOptions options)
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

    internal static int ReadPositiveIntegerOption(string envName, int fallback)
    {
        var raw = Environment.GetEnvironmentVariable(envName);
        return int.TryParse(raw, out var value) && value > 0 ? value : fallback;
    }

    internal static string? ReadClientToken(HttpContext context, ClientApiOptions options)
    {
        var headerName = GetConfiguredClientTokenHeader(options);
        var headerValue = ReadHeader(context, headerName);
        if (!string.IsNullOrWhiteSpace(headerValue))
        {
            return headerValue.Trim();
        }

        return ReadAuthorizationBearerToken(context);
    }

    internal static string? ReadAuthorizationBearerToken(HttpContext context)
    {
        var authorization = ReadHeader(context, "Authorization");
        const string bearerPrefix = "Bearer ";
        return authorization is not null && authorization.StartsWith(bearerPrefix, StringComparison.OrdinalIgnoreCase)
            ? authorization[bearerPrefix.Length..].Trim()
            : null;
    }

    internal static int GetClientAuthProviderClockSkewSeconds(ClientApiOptions options)
    {
        var raw = Environment.GetEnvironmentVariable("CLIENT_API_AUTH_PROVIDER_CLOCK_SKEW_SECONDS");
        if (int.TryParse(raw, out var envValue))
        {
            return Math.Clamp(envValue, 0, 300);
        }

        return Math.Clamp(options.AuthProviderClockSkewSeconds, 0, 300);
    }

    internal static string? JoinGrantLists(params string?[] values)
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
}
