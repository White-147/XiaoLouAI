using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Options;
using XiaoLou.ControlApi.Modules.Auth;
using XiaoLou.Domain;
using XiaoLou.Infrastructure.Postgres;
using static XiaoLou.ControlApi.Modules.Auth.AuthHelpers;

namespace XiaoLou.ControlApi.Modules.Toolbox;

internal static class ToolboxEndpoints
{
    public static IEndpointRouteBuilder MapToolboxEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/capabilities", async (
            PostgresToolboxStore toolbox,
            CancellationToken ct) =>
        {
            return Results.Ok(await toolbox.GetSystemCapabilitiesAsync(ct));
        });

        endpoints.MapGet("/api/toolbox", async (
            PostgresToolboxStore toolbox,
            CancellationToken ct) =>
        {
            return Results.Ok(await toolbox.GetCapabilitiesAsync(ct));
        });

        endpoints.MapGet("/api/toolbox/capabilities", async (
            PostgresToolboxStore toolbox,
            CancellationToken ct) =>
        {
            return Results.Ok(await toolbox.GetCapabilitiesAsync(ct));
        });

        endpoints.MapPost("/api/toolbox/character-replace", async (
            ToolboxRunRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresToolboxStore toolbox,
            CancellationToken ct) =>
        {
            return await QueueToolboxRunAsync("character_replace", request, httpContext, clientApi.Value, toolbox, ct);
        });

        endpoints.MapPost("/api/toolbox/motion-transfer", async (
            ToolboxRunRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresToolboxStore toolbox,
            CancellationToken ct) =>
        {
            return await QueueToolboxRunAsync("motion_transfer", request, httpContext, clientApi.Value, toolbox, ct);
        });

        endpoints.MapPost("/api/toolbox/upscale-restore", async (
            ToolboxRunRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresToolboxStore toolbox,
            CancellationToken ct) =>
        {
            return await QueueToolboxRunAsync("upscale_restore", request, httpContext, clientApi.Value, toolbox, ct);
        });

        endpoints.MapPost("/api/toolbox/video-reverse-prompt", async (
            ToolboxRunRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresToolboxStore toolbox,
            CancellationToken ct) =>
        {
            return await QueueToolboxRunAsync("video_reverse_prompt", request, httpContext, clientApi.Value, toolbox, ct);
        });

        endpoints.MapPost("/api/toolbox/storyboard-grid25", async (
            ToolboxRunRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresToolboxStore toolbox,
            CancellationToken ct) =>
        {
            return await QueueToolboxRunAsync("storyboard_grid25", request, httpContext, clientApi.Value, toolbox, ct);
        });

        endpoints.MapPost("/api/toolbox/translate-text", async (
            ToolboxRunRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresToolboxStore toolbox,
            CancellationToken ct) =>
        {
            return await QueueToolboxRunAsync("translate_text", request, httpContext, clientApi.Value, toolbox, ct);
        });

        return endpoints;
    }

    private static async Task<IResult> QueueToolboxRunAsync(
        string actionCode,
        ToolboxRunRequest request,
        HttpContext httpContext,
        ClientApiOptions clientApi,
        PostgresToolboxStore toolbox,
        CancellationToken cancellationToken)
    {
        var scope = ResolvePublicOwnerScope(httpContext, request.AccountOwnerType, request.AccountOwnerId);
        var scopedRequest = request with
        {
            AccountOwnerType = scope.AccountOwnerType,
            AccountOwnerId = scope.AccountOwnerId,
            RegionCode = scope.RegionCode,
            Currency = scope.Currency,
        };
        if (AuthorizeAccountScope(httpContext, clientApi, scopedRequest) is { } denied)
        {
            return denied;
        }

        try
        {
            return Results.Json(
                await toolbox.QueueCapabilityRunAsync(scopedRequest, ResolveActorId(httpContext), actionCode, scopedRequest, cancellationToken),
                statusCode: StatusCodes.Status202Accepted);
        }
        catch (ArgumentException ex)
        {
            return Results.BadRequest(new { error = ex.Message });
        }
    }
}
