using Microsoft.AspNetCore.Http;

namespace XiaoLou.ControlApi.Modules.Auth;

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
