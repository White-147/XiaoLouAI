using Microsoft.AspNetCore.Http;

namespace XiaoLou.ControlApi.Modules.Auth;

internal static class ClientRoutePolicy
{
    internal static bool IsPublicClientApiRequest(PathString path)
    {
        return path.StartsWithSegments("/api/accounts/ensure")
            || path.StartsWithSegments("/api/auth")
            || string.Equals(path.Value, "/api/me", StringComparison.OrdinalIgnoreCase)
            || path.StartsWithSegments("/api/organizations")
            || path.StartsWithSegments("/api/api-center")
            || path.StartsWithSegments("/api/admin")
            || path.StartsWithSegments("/api/enterprise-applications")
            || path.StartsWithSegments("/api/playground")
            || string.Equals(path.Value, "/api/capabilities", StringComparison.OrdinalIgnoreCase)
            || path.StartsWithSegments("/api/toolbox")
            || path.StartsWithSegments("/api/jobs")
            || path.StartsWithSegments("/api/media")
            || path.StartsWithSegments("/api/projects")
            || path.StartsWithSegments("/api/canvas-projects")
            || path.StartsWithSegments("/api/agent-canvas/projects")
            || path.StartsWithSegments("/api/create")
            || string.Equals(path.Value, "/api/wallet", StringComparison.OrdinalIgnoreCase)
            || string.Equals(path.Value, "/api/wallets", StringComparison.OrdinalIgnoreCase)
            || string.Equals(path.Value, "/api/wallet/usage-stats", StringComparison.OrdinalIgnoreCase)
            || path.StartsWithSegments("/api/wallets");
    }

    internal static bool IsAnonymousIdentityRequest(string method, PathString path)
    {
        return (HttpMethods.IsGet(method) && string.Equals(path.Value, "/api/auth/providers", StringComparison.OrdinalIgnoreCase))
            || (HttpMethods.IsGet(method) && string.Equals(path.Value, "/api/me", StringComparison.OrdinalIgnoreCase))
            || (HttpMethods.IsPost(method) && string.Equals(path.Value, "/api/auth/google/exchange", StringComparison.OrdinalIgnoreCase))
            || (HttpMethods.IsPost(method) && string.Equals(path.Value, "/api/auth/login", StringComparison.OrdinalIgnoreCase))
            || (HttpMethods.IsPost(method) && string.Equals(path.Value, "/api/auth/admin/login", StringComparison.OrdinalIgnoreCase))
            || (HttpMethods.IsPost(method) && string.Equals(path.Value, "/api/auth/password/bootstrap-admin", StringComparison.OrdinalIgnoreCase))
            || (HttpMethods.IsPost(method) && string.Equals(path.Value, "/api/auth/password/reset/request", StringComparison.OrdinalIgnoreCase))
            || (HttpMethods.IsPost(method) && string.Equals(path.Value, "/api/auth/password/reset/complete", StringComparison.OrdinalIgnoreCase))
            || (HttpMethods.IsPost(method) && string.Equals(path.Value, "/api/auth/demo-session", StringComparison.OrdinalIgnoreCase))
            || (HttpMethods.IsPost(method) && string.Equals(path.Value, "/api/auth/register/personal", StringComparison.OrdinalIgnoreCase))
            || (HttpMethods.IsPost(method) && string.Equals(path.Value, "/api/auth/register/enterprise-admin", StringComparison.OrdinalIgnoreCase))
            || (HttpMethods.IsPost(method) && string.Equals(path.Value, "/api/enterprise-applications", StringComparison.OrdinalIgnoreCase));
    }

    internal static string? GetRequiredClientPermission(string method, PathString path)
    {
        if (HttpMethods.IsPost(method)
            && string.Equals(path.Value, "/api/accounts/ensure", StringComparison.OrdinalIgnoreCase))
        {
            return "accounts:ensure";
        }

        if (path.StartsWithSegments("/api/auth")
            || string.Equals(path.Value, "/api/me", StringComparison.OrdinalIgnoreCase))
        {
            return HttpMethods.IsGet(method) ? "identity:read" : "identity:write";
        }

        if (path.StartsWithSegments("/api/organizations"))
        {
            return HttpMethods.IsGet(method) ? "organization:read" : "organization:write";
        }

        if (path.StartsWithSegments("/api/api-center"))
        {
            return HttpMethods.IsGet(method) ? "api-center:read" : "api-center:write";
        }

        if (path.StartsWithSegments("/api/admin"))
        {
            return HttpMethods.IsGet(method) ? "admin:read" : "admin:write";
        }

        if (path.StartsWithSegments("/api/enterprise-applications"))
        {
            return HttpMethods.IsGet(method) ? "enterprise-applications:read" : "enterprise-applications:write";
        }

        if (path.StartsWithSegments("/api/playground"))
        {
            return HttpMethods.IsGet(method) ? "playground:read" : "playground:write";
        }

        if (string.Equals(path.Value, "/api/capabilities", StringComparison.OrdinalIgnoreCase)
            || path.StartsWithSegments("/api/toolbox"))
        {
            return HttpMethods.IsGet(method) ? "toolbox:read" : "toolbox:write";
        }

        if (path.StartsWithSegments("/api/jobs"))
        {
            if (HttpMethods.IsGet(method))
            {
                return "jobs:read";
            }

            if (HttpMethods.IsPost(method) && string.Equals(path.Value, "/api/jobs", StringComparison.OrdinalIgnoreCase))
            {
                return "jobs:create";
            }

            if (HttpMethods.IsPost(method) && path.Value?.EndsWith("/cancel", StringComparison.OrdinalIgnoreCase) == true)
            {
                return "jobs:cancel";
            }
        }

        if (HttpMethods.IsGet(method)
            && (string.Equals(path.Value, "/api/wallet", StringComparison.OrdinalIgnoreCase)
                || string.Equals(path.Value, "/api/wallets", StringComparison.OrdinalIgnoreCase)
                || string.Equals(path.Value, "/api/wallet/usage-stats", StringComparison.OrdinalIgnoreCase)
                || path.StartsWithSegments("/api/wallets")))
        {
            return "wallet:read";
        }

        if (path.StartsWithSegments("/api/media"))
        {
            if (HttpMethods.IsPost(method)
                && string.Equals(path.Value, "/api/media/signed-read-url", StringComparison.OrdinalIgnoreCase))
            {
                return "media:read";
            }

            if (HttpMethods.IsPost(method))
            {
                return "media:write";
            }
        }

        if (path.StartsWithSegments("/api/projects"))
        {
            return HttpMethods.IsGet(method) ? "projects:read" : "projects:write";
        }

        if (path.StartsWithSegments("/api/canvas-projects")
            || path.StartsWithSegments("/api/agent-canvas/projects"))
        {
            return HttpMethods.IsGet(method) ? "canvas:read" : "canvas:write";
        }

        if (path.StartsWithSegments("/api/create"))
        {
            return HttpMethods.IsGet(method) ? "create:read" : "create:write";
        }

        return null;
    }
}
