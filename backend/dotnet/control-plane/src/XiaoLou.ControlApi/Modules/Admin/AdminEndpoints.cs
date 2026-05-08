using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using XiaoLou.ControlApi.Modules.Auth;
using XiaoLou.Domain;
using XiaoLou.Infrastructure.Postgres;
using static XiaoLou.ControlApi.Modules.Auth.AuthHelpers;

namespace XiaoLou.ControlApi.Modules.Admin;

internal static class AdminEndpoints
{
    public static IEndpointRouteBuilder MapAdminEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/admin/pricing-rules", async (
            HttpContext httpContext,
            PostgresIdentityConfigStore identity,
            PostgresAdminSystemStore adminSystem,
            CancellationToken ct) =>
        {
            if (await AuthorizePlatformAdminAsync(httpContext, identity, ct) is { } denied)
            {
                return denied;
            }

            return Results.Ok(new { items = await adminSystem.ListPricingRulesAsync(ct) });
        });

        endpoints.MapPut("/api/admin/pricing-rules/{actionCode}", async (
            string actionCode,
            AdminPricingRuleUpsertRequest request,
            HttpContext httpContext,
            PostgresIdentityConfigStore identity,
            PostgresAdminSystemStore adminSystem,
            CancellationToken ct) =>
        {
            if (await AuthorizePlatformAdminAsync(httpContext, identity, ct) is { } denied)
            {
                return denied;
            }

            try
            {
                return Results.Ok(await adminSystem.UpsertPricingRuleAsync(actionCode, ToPricingRuleRequest(request), ct));
            }
            catch (ArgumentException ex)
            {
                return BadRequestError(ex);
            }
        });

        endpoints.MapGet("/api/admin/orders", async (
            int? limit,
            HttpContext httpContext,
            PostgresIdentityConfigStore identity,
            PostgresAdminSystemStore adminSystem,
            CancellationToken ct) =>
        {
            if (await AuthorizePlatformAdminAsync(httpContext, identity, ct) is { } denied)
            {
                return denied;
            }

            return Results.Ok(new { items = await adminSystem.ListAdminOrdersAsync(limit ?? 100, ct) });
        });

        endpoints.MapPost("/api/admin/orders/{orderId}/review", () => Results.Json(new
        {
            error = "manual recharge review is retired; canonical payment callbacks and wallet ledger are the only write path",
            code = "RECHARGE_FLOW_RETIRED",
        }, statusCode: StatusCodes.Status410Gone));

        endpoints.MapGet("/api/admin/accounts", async (
            string? query,
            HttpContext httpContext,
            PostgresIdentityConfigStore identity,
            CancellationToken ct) =>
        {
            if (await AuthorizeSuperAdminAsync(httpContext, identity, ct) is { } denied)
            {
                return denied;
            }

            return Results.Ok(new { items = await identity.ListPlatformAccountsAsync(query, ct) });
        });

        endpoints.MapPut("/api/admin/accounts/{userId}", async (
            string userId,
            UpdatePlatformAccountRequest request,
            HttpContext httpContext,
            PostgresIdentityConfigStore identity,
            CancellationToken ct) =>
        {
            if (await AuthorizeSuperAdminAsync(httpContext, identity, ct) is { } denied)
            {
                return denied;
            }

            try
            {
                return Results.Ok(await identity.UpdatePlatformAccountAsync(userId, request, ct));
            }
            catch (ArgumentException ex)
            {
                return BadRequestError(ex);
            }
        });

        endpoints.MapDelete("/api/admin/accounts/{userId}", async (
            string userId,
            HttpContext httpContext,
            PostgresIdentityConfigStore identity,
            CancellationToken ct) =>
        {
            if (await AuthorizeSuperAdminAsync(httpContext, identity, ct) is { } denied)
            {
                return denied;
            }

            var actorId = ResolveActorId(httpContext);
            if (string.Equals(actorId, userId, StringComparison.Ordinal))
            {
                return BadRequestError(new ArgumentException("cannot delete current admin account"));
            }

            try
            {
                return Results.Ok(await identity.DeletePlatformAccountAsync(userId, ct));
            }
            catch (ArgumentException ex)
            {
                return BadRequestError(ex);
            }
        });

        endpoints.MapGet("/api/enterprise-applications", async (
            int? limit,
            HttpContext httpContext,
            PostgresIdentityConfigStore identity,
            PostgresAdminSystemStore adminSystem,
            CancellationToken ct) =>
        {
            if (await AuthorizePlatformAdminAsync(httpContext, identity, ct) is { } denied)
            {
                return denied;
            }

            return Results.Ok(new { items = await adminSystem.ListEnterpriseApplicationsAsync(limit ?? 100, ct) });
        });

        endpoints.MapPost("/api/enterprise-applications", async (
            EnterpriseApplicationRequest request,
            PostgresAdminSystemStore adminSystem,
            CancellationToken ct) =>
        {
            try
            {
                return Results.Json(await adminSystem.CreateEnterpriseApplicationAsync(request, ct), statusCode: StatusCodes.Status201Created);
            }
            catch (ArgumentException ex)
            {
                return BadRequestError(ex);
            }
        });

        endpoints.MapPatch("/api/enterprise-applications/{applicationId}", async (
            string applicationId,
            EnterpriseApplicationStatusUpdateRequest request,
            HttpContext httpContext,
            PostgresIdentityConfigStore identity,
            PostgresAdminSystemStore adminSystem,
            CancellationToken ct) =>
        {
            if (await AuthorizePlatformAdminAsync(httpContext, identity, ct) is { } denied)
            {
                return denied;
            }

            var application = await adminSystem.ReviewEnterpriseApplicationAsync(applicationId, ToEnterpriseApplicationReviewRequest(request), ResolveActorId(httpContext), ct);
            return application is null ? Results.NotFound(new { error = "enterprise application not found" }) : Results.Ok(application);
        });

        endpoints.MapPost("/api/enterprise-applications/{applicationId}/review", async (
            string applicationId,
            EnterpriseApplicationReviewDecisionRequest request,
            HttpContext httpContext,
            PostgresIdentityConfigStore identity,
            PostgresAdminSystemStore adminSystem,
            CancellationToken ct) =>
        {
            if (await AuthorizePlatformAdminAsync(httpContext, identity, ct) is { } denied)
            {
                return denied;
            }

            var application = await adminSystem.ReviewEnterpriseApplicationAsync(applicationId, ToEnterpriseApplicationReviewRequest(request), ResolveActorId(httpContext), ct);
            return application is null ? Results.NotFound(new { error = "enterprise application not found" }) : Results.Ok(application);
        });

        return endpoints;
    }

    private static PricingRuleRequest ToPricingRuleRequest(AdminPricingRuleUpsertRequest request) => new()
    {
        ActionCode = request.ActionCode,
        Label = request.Label,
        BaseCredits = request.BaseCredits,
        Credits = request.Credits,
        UnitLabel = request.UnitLabel,
        Description = request.Description,
        Data = request.Data,
    };

    private static EnterpriseApplicationReviewRequest ToEnterpriseApplicationReviewRequest(EnterpriseApplicationStatusUpdateRequest request) => new()
    {
        Status = request.Status,
        Decision = request.Decision,
        Note = request.Note,
    };

    private static EnterpriseApplicationReviewRequest ToEnterpriseApplicationReviewRequest(EnterpriseApplicationReviewDecisionRequest request) => new()
    {
        Status = request.Status,
        Decision = request.Decision,
        Note = request.Note,
    };

    private static async Task<IResult?> AuthorizeSuperAdminAsync(
        HttpContext context,
        PostgresIdentityConfigStore identity,
        CancellationToken cancellationToken)
    {
        var permissionContext = await identity.GetPermissionContextAsync(ResolveActorId(context), cancellationToken);
        var permissions = TryReadDictionary(permissionContext, "permissions");
        var platformRole = ReadDictionaryString(permissionContext, "platformRole")
            ?? ReadDictionaryString(TryReadDictionary(permissionContext, "actor"), "platformRole");
        return ReadDictionaryBool(permissions, "canManageSystem") || string.Equals(platformRole, "super_admin", StringComparison.Ordinal)
            ? null
            : Results.Json(new
            {
                error = "super admin permission is required",
                code = "SYSTEM_ADMIN_FORBIDDEN",
            }, statusCode: StatusCodes.Status403Forbidden);
    }
}
