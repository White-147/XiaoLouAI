using System.Text.Json;
using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Options;
using XiaoLou.ControlApi.Modules.Auth;
using XiaoLou.Domain;
using XiaoLou.Infrastructure.Postgres;
using static XiaoLou.ControlApi.Modules.Auth.AuthHelpers;

namespace XiaoLou.ControlApi.Modules.Accounts;

internal static class AccountsAuthEndpoints
{
    private static readonly HashSet<string> DemoActorIds = new(StringComparer.Ordinal)
    {
        "user_personal_001",
        "user_member_001",
        "user_demo_001",
        "ops_demo_001",
        "root_demo_001",
    };

    public static IEndpointRouteBuilder MapAccountsAuthEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/accounts/ensure", async (
            EnsureAccountRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresAccountStore accounts,
            CancellationToken ct) =>
        {
            if (AuthorizeAccountScope(httpContext, clientApi.Value, request) is { } denied)
            {
                return denied;
            }

            var account = await accounts.EnsureAccountAsync(request, ct);
            return Results.Ok(account);
        });

        endpoints.MapGet("/api/auth/providers", () => Results.Ok(new
        {
            google = new
            {
                configured = false,
            },
        }));

        endpoints.MapPost("/api/auth/google/exchange", () => Results.Json(new
        {
            error = new
            {
                code = "AUTH_PROVIDER_DISABLED",
                message = "Google login is not configured in the Windows-native canonical identity surface.",
            },
        }, statusCode: StatusCodes.Status410Gone));

        endpoints.MapPost("/api/auth/login", async (
            LoginRequest request,
            IOptions<ClientApiOptions> clientApi,
            PostgresIdentityConfigStore identity,
            CancellationToken ct) =>
        {
            try
            {
                var permissionContext = await identity.LoginWithEmailAsync(request, "personal", ct);
                return Results.Ok(BuildLoginResult(permissionContext, clientApi.Value));
            }
            catch (ArgumentException ex)
            {
                return AuthError("AUTH_INVALID_REQUEST", ex.Message, StatusCodes.Status400BadRequest);
            }
            catch (UnauthorizedAccessException ex)
            {
                return AuthError("AUTH_INVALID_CREDENTIALS", ex.Message, StatusCodes.Status401Unauthorized);
            }
        });

        endpoints.MapPost("/api/auth/admin/login", async (
            LoginRequest request,
            IOptions<ClientApiOptions> clientApi,
            PostgresIdentityConfigStore identity,
            CancellationToken ct) =>
        {
            try
            {
                var permissionContext = await identity.LoginWithEmailAsync(request, "ops_admin", ct);
                return Results.Ok(BuildLoginResult(permissionContext, clientApi.Value));
            }
            catch (ArgumentException ex)
            {
                return AuthError("AUTH_INVALID_REQUEST", ex.Message, StatusCodes.Status400BadRequest);
            }
            catch (UnauthorizedAccessException ex)
            {
                return AuthError("AUTH_INVALID_CREDENTIALS", ex.Message, StatusCodes.Status401Unauthorized);
            }
        });

        endpoints.MapPost("/api/auth/password/bootstrap-admin", async (
            BootstrapPlatformPasswordRequest request,
            HttpContext httpContext,
            PostgresIdentityConfigStore identity,
            CancellationToken ct) =>
        {
            if (!IsLocalDemoSessionRequest(httpContext))
            {
                return AuthError(
                    "AUTH_LOCAL_OPERATOR_REQUIRED",
                    "platform password bootstrap is available only from local loopback access",
                    StatusCodes.Status403Forbidden);
            }

            try
            {
                return Results.Ok(await identity.BootstrapPlatformPasswordAsync(request, ct));
            }
            catch (ArgumentException ex)
            {
                return AuthError("AUTH_INVALID_REQUEST", ex.Message, StatusCodes.Status400BadRequest);
            }
            catch (UnauthorizedAccessException ex)
            {
                return AuthError("AUTH_INVALID_CREDENTIALS", ex.Message, StatusCodes.Status401Unauthorized);
            }
        });

        endpoints.MapPost("/api/auth/password/change", async (
            ChangePasswordRequest request,
            HttpContext httpContext,
            PostgresIdentityConfigStore identity,
            CancellationToken ct) =>
        {
            try
            {
                return Results.Ok(await identity.ChangePasswordAsync(ResolveActorId(httpContext), request, ct));
            }
            catch (ArgumentException ex)
            {
                return AuthError("AUTH_INVALID_REQUEST", ex.Message, StatusCodes.Status400BadRequest);
            }
            catch (UnauthorizedAccessException ex)
            {
                return AuthError("AUTH_INVALID_CREDENTIALS", ex.Message, StatusCodes.Status401Unauthorized);
            }
        });

        endpoints.MapPost("/api/auth/password/admin-reset", async (
            AdminResetPasswordRequest request,
            HttpContext httpContext,
            PostgresIdentityConfigStore identity,
            CancellationToken ct) =>
        {
            if (await AuthorizePlatformAdminAsync(httpContext, identity, ct) is { } denied)
            {
                return denied;
            }

            try
            {
                return Results.Ok(await identity.AdminResetPasswordAsync(request, ct));
            }
            catch (ArgumentException ex)
            {
                return AuthError("AUTH_INVALID_REQUEST", ex.Message, StatusCodes.Status400BadRequest);
            }
            catch (UnauthorizedAccessException ex)
            {
                return AuthError("AUTH_INVALID_CREDENTIALS", ex.Message, StatusCodes.Status401Unauthorized);
            }
        });

        endpoints.MapPost("/api/auth/password/reset/request", async (
            RequestPasswordResetRequest request,
            HttpContext httpContext,
            PostgresIdentityConfigStore identity,
            CancellationToken ct) =>
        {
            try
            {
                return Results.Ok(await identity.RequestPasswordResetAsync(
                    request,
                    CanEchoLocalPasswordResetToken(httpContext),
                    ct));
            }
            catch (ArgumentException ex)
            {
                return AuthError("AUTH_INVALID_REQUEST", ex.Message, StatusCodes.Status400BadRequest);
            }
        });

        endpoints.MapPost("/api/auth/password/reset/complete", async (
            CompletePasswordResetRequest request,
            PostgresIdentityConfigStore identity,
            CancellationToken ct) =>
        {
            try
            {
                return Results.Ok(await identity.CompletePasswordResetAsync(request, ct));
            }
            catch (ArgumentException ex)
            {
                return AuthError("AUTH_INVALID_REQUEST", ex.Message, StatusCodes.Status400BadRequest);
            }
            catch (UnauthorizedAccessException ex)
            {
                return AuthError("AUTH_INVALID_CREDENTIALS", ex.Message, StatusCodes.Status401Unauthorized);
            }
        });

        endpoints.MapPost("/api/auth/demo-session", async (
            DemoSessionRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresIdentityConfigStore identity,
            CancellationToken ct) =>
        {
            if (!IsLocalDemoSessionRequest(httpContext))
            {
                return Results.Json(new
                {
                    error = new
                    {
                        code = "DEMO_SESSION_LOCAL_ONLY",
                        message = "Demo sessions are available only from local loopback access.",
                    },
                }, statusCode: StatusCodes.Status403Forbidden);
            }

            var actorId = NormalizeBlank(request.ActorId);
            if (actorId is null || !DemoActorIds.Contains(actorId))
            {
                return Results.Json(new
                {
                    error = new
                    {
                        code = "DEMO_ACTOR_NOT_FOUND",
                        message = "Demo actor is not available.",
                    },
                }, statusCode: StatusCodes.Status404NotFound);
            }

            var permissionContext = await identity.GetPermissionContextAsync(actorId, ct);
            return Results.Ok(BuildLoginResult(permissionContext, clientApi.Value));
        });

        endpoints.MapPost("/api/auth/register/personal", async (
            RegisterPersonalRequest request,
            IOptions<ClientApiOptions> clientApi,
            PostgresIdentityConfigStore identity,
            CancellationToken ct) =>
        {
            try
            {
                var registration = await identity.RegisterPersonalAsync(request, ct);
                return Results.Json(AttachSessionCredentials(registration, clientApi.Value), statusCode: StatusCodes.Status201Created);
            }
            catch (ArgumentException ex)
            {
                return AuthError("AUTH_INVALID_REQUEST", ex.Message, StatusCodes.Status400BadRequest);
            }
            catch (UnauthorizedAccessException ex)
            {
                return AuthError("AUTH_INVALID_CREDENTIALS", ex.Message, StatusCodes.Status401Unauthorized);
            }
        });

        endpoints.MapPost("/api/auth/register/enterprise-admin", async (
            RegisterEnterpriseAdminRequest request,
            IOptions<ClientApiOptions> clientApi,
            PostgresIdentityConfigStore identity,
            CancellationToken ct) =>
        {
            try
            {
                var registration = await identity.RegisterEnterpriseAdminAsync(request, ct);
                return Results.Json(AttachSessionCredentials(registration, clientApi.Value), statusCode: StatusCodes.Status201Created);
            }
            catch (ArgumentException ex)
            {
                return AuthError("AUTH_INVALID_REQUEST", ex.Message, StatusCodes.Status400BadRequest);
            }
            catch (UnauthorizedAccessException ex)
            {
                return AuthError("AUTH_INVALID_CREDENTIALS", ex.Message, StatusCodes.Status401Unauthorized);
            }
        });

        endpoints.MapGet("/api/me", async (
            HttpContext httpContext,
            PostgresIdentityConfigStore identity,
            CancellationToken ct) =>
        {
            return Results.Ok(await identity.GetPermissionContextAsync(ResolveActorId(httpContext), ct));
        });

        endpoints.MapPut("/api/me", async (
            UpdateMeRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresIdentityConfigStore identity,
            CancellationToken ct) =>
        {
            var actorId = ResolveActorId(httpContext);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, new AccountScope
                {
                    AccountOwnerType = "user",
                    AccountOwnerId = actorId,
                }, requireConfiguredAccountGrant: false) is { } denied)
            {
                return denied;
            }

            try
            {
                return Results.Ok(await identity.UpdateProfileAsync(actorId, request, ct));
            }
            catch (ArgumentException ex)
            {
                return AuthError("AUTH_INVALID_REQUEST", ex.Message, StatusCodes.Status400BadRequest);
            }
        });

        endpoints.MapGet("/api/organizations/{organizationId}/members", async (
            string organizationId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresIdentityConfigStore identity,
            CancellationToken ct) =>
        {
            if (AuthorizeAccountScope(httpContext, clientApi.Value, new AccountScope
                {
                    AccountOwnerType = "organization",
                    AccountOwnerId = organizationId,
                }, requireConfiguredAccountGrant: false) is { } denied)
            {
                return denied;
            }

            return Results.Ok(new
            {
                items = await identity.ListOrganizationMembersAsync(organizationId, ct),
            });
        });

        endpoints.MapPost("/api/organizations/{organizationId}/members", async (
            string organizationId,
            CreateOrganizationMemberRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresIdentityConfigStore identity,
            CancellationToken ct) =>
        {
            if (AuthorizeAccountScope(httpContext, clientApi.Value, new AccountScope
                {
                    AccountOwnerType = "organization",
                    AccountOwnerId = organizationId,
                }, requireConfiguredAccountGrant: false) is { } denied)
            {
                return denied;
            }

            try
            {
                return Results.Json(await identity.CreateOrganizationMemberAsync(organizationId, request, ct), statusCode: StatusCodes.Status201Created);
            }
            catch (ArgumentException ex)
            {
                return AuthError("AUTH_INVALID_REQUEST", ex.Message, StatusCodes.Status400BadRequest);
            }
            catch (UnauthorizedAccessException ex)
            {
                return AuthError("AUTH_INVALID_CREDENTIALS", ex.Message, StatusCodes.Status401Unauthorized);
            }
        });

        endpoints.MapGet("/api/api-center", async (
            string? accountOwnerType,
            string? accountOwnerId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresIdentityConfigStore identity,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, accountOwnerType, accountOwnerId);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope, requireConfiguredAccountGrant: false) is { } denied)
            {
                return denied;
            }

            return Results.Ok(await identity.GetApiCenterConfigAsync(scope, ct));
        });

        endpoints.MapPut("/api/api-center/defaults", async (
            JsonElement request,
            string? accountOwnerType,
            string? accountOwnerId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresIdentityConfigStore identity,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, accountOwnerType, accountOwnerId);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope, requireConfiguredAccountGrant: false) is { } denied)
            {
                return denied;
            }

            return Results.Ok(await identity.UpdateApiCenterDefaultsAsync(scope, request, ct));
        });

        endpoints.MapPut("/api/api-center/vendors/{vendorId}/api-key", async (
            string vendorId,
            JsonElement request,
            string? accountOwnerType,
            string? accountOwnerId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresIdentityConfigStore identity,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, accountOwnerType, accountOwnerId);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope, requireConfiguredAccountGrant: false) is { } denied)
            {
                return denied;
            }

            var apiKey = request.TryGetProperty("apiKey", out var apiKeyValue) ? apiKeyValue.GetString() ?? "" : "";
            return Results.Ok(await identity.SaveApiCenterVendorApiKeyAsync(scope, vendorId, apiKey, ct));
        });

        endpoints.MapPost("/api/api-center/vendors/{vendorId}/test", async (
            string vendorId,
            string? accountOwnerType,
            string? accountOwnerId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresIdentityConfigStore identity,
            PostgresProviderHealthStore providerHealth,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, accountOwnerType, accountOwnerId);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope, requireConfiguredAccountGrant: false) is { } denied)
            {
                return denied;
            }

            var result = await identity.TestApiCenterVendorConnectionAsync(scope, vendorId, ct);
            var health = await providerHealth.UpsertAsync(new ProviderHealthRequest
            {
                Provider = vendorId,
                RegionCode = NormalizeBlank(scope.RegionCode) ?? "CN",
                ModelFamily = "api-center",
                Status = "evidence_pending",
                LastError = "API-center test wrote staged canonical provider health only; real provider evidence is operator-supplied final acceptance evidence.",
            }, ct);
            result["providerHealth"] = health;
            return Results.Ok(result);
        });

        endpoints.MapPut("/api/api-center/vendors/{vendorId}/models/{modelId}", async (
            string vendorId,
            string modelId,
            JsonElement request,
            string? accountOwnerType,
            string? accountOwnerId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresIdentityConfigStore identity,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, accountOwnerType, accountOwnerId);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope, requireConfiguredAccountGrant: false) is { } denied)
            {
                return denied;
            }

            return Results.Ok(await identity.UpdateApiVendorModelAsync(scope, vendorId, modelId, request, ct));
        });

        return endpoints;
    }

    private static Dictionary<string, object?> BuildLoginResult(
        Dictionary<string, object?> permissionContext,
        ClientApiOptions options)
    {
        var actor = TryReadDictionary(permissionContext, "actor");
        var actorId = ReadDictionaryString(actor, "id")
            ?? ReadDictionaryString(permissionContext, "actorId")
            ?? "guest";
        var email = ReadDictionaryString(actor, "email") ?? "";
        return new Dictionary<string, object?>
        {
            ["actorId"] = actorId,
            ["token"] = CreateLocalAuthToken(actorId),
            ["controlApiClientAssertion"] = CreateControlApiClientAssertion(permissionContext, options),
            ["displayName"] = ReadDictionaryString(actor, "displayName") ?? actorId,
            ["email"] = email,
            ["permissionContext"] = permissionContext,
        };
    }

    private static IResult AuthError(string code, string message, int statusCode)
    {
        return Results.Json(new
        {
            error = new
            {
                code,
                message,
            },
        }, statusCode: statusCode);
    }

    private static Dictionary<string, object?> AttachSessionCredentials(
        Dictionary<string, object?> registration,
        ClientApiOptions options)
    {
        var next = new Dictionary<string, object?>(registration, StringComparer.OrdinalIgnoreCase);
        var permissionContext = next.TryGetValue("permissionContext", out var permissionContextValue)
            ? permissionContextValue as Dictionary<string, object?>
            : null;
        var actorId = ReadDictionaryString(next, "actorId")
            ?? (permissionContext is null ? null : ReadDictionaryString(TryReadDictionary(permissionContext, "actor"), "id"))
            ?? "guest";
        next["actorId"] = actorId;
        next["token"] = CreateLocalAuthToken(actorId);
        next["controlApiClientAssertion"] = permissionContext is null
            ? null
            : CreateControlApiClientAssertion(permissionContext, options);
        return next;
    }

    private static bool IsLocalDemoSessionRequest(HttpContext context)
    {
        if (HasExternalForwardedAddress(context))
        {
            return false;
        }

        var remoteIp = context.Connection.RemoteIpAddress;
        if (remoteIp is not null && !IPAddress.IsLoopback(remoteIp))
        {
            return false;
        }

        return IsLocalOriginHeader(context, "Origin")
            && IsLocalOriginHeader(context, "Referer");
    }

    private static bool CanEchoLocalPasswordResetToken(HttpContext context)
    {
        var remoteIp = context.Connection.RemoteIpAddress;
        return remoteIp is not null
            && IPAddress.IsLoopback(remoteIp)
            && IsLocalDemoSessionRequest(context);
    }

    private static bool IsLocalOriginHeader(HttpContext context, string headerName)
    {
        var headerValue = ReadHeader(context, headerName);
        if (string.IsNullOrWhiteSpace(headerValue))
        {
            return true;
        }

        return Uri.TryCreate(headerValue, UriKind.Absolute, out var uri)
            && IsLocalHost(uri.Host);
    }

    private static bool IsLocalHost(string host)
    {
        return string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase)
            || string.Equals(host, "127.0.0.1", StringComparison.OrdinalIgnoreCase)
            || string.Equals(host, "::1", StringComparison.OrdinalIgnoreCase)
            || string.Equals(host, "[::1]", StringComparison.OrdinalIgnoreCase);
    }
}

internal sealed record DemoSessionRequest(string ActorId);
