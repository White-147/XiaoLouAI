using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Options;
using XiaoLou.ControlApi.Modules.Auth;
using XiaoLou.Domain;
using XiaoLou.Infrastructure.Postgres;
using static XiaoLou.ControlApi.Modules.Auth.AuthHelpers;

namespace XiaoLou.ControlApi.Modules.Playground;

internal static class PlaygroundEndpoints
{
    public static IEndpointRouteBuilder MapPlaygroundEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/playground/config", async (
            string? accountOwnerType,
            string? accountOwnerId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresPlaygroundStore playground,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, accountOwnerType, accountOwnerId);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope) is { } denied)
            {
                return denied;
            }

            return Results.Ok(await playground.GetConfigAsync(scope, ct));
        });

        endpoints.MapGet("/api/playground/models", (PostgresPlaygroundStore playground) =>
        {
            return Results.Ok(playground.ListModels());
        });

        endpoints.MapGet("/api/playground/conversations", async (
            string? accountOwnerType,
            string? accountOwnerId,
            string? search,
            int? limit,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresPlaygroundStore playground,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, accountOwnerType, accountOwnerId);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope) is { } denied)
            {
                return denied;
            }

            return Results.Ok(new
            {
                items = await playground.ListConversationsAsync(scope, search, limit ?? 100, ct),
            });
        });

        endpoints.MapPost("/api/playground/conversations", async (
            PlaygroundConversationRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresPlaygroundStore playground,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, request.AccountOwnerType, request.AccountOwnerId);
            var scopedRequest = request with
            {
                AccountOwnerType = scope.AccountOwnerType,
                AccountOwnerId = scope.AccountOwnerId,
                RegionCode = scope.RegionCode,
                Currency = scope.Currency,
            };
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scopedRequest) is { } denied)
            {
                return denied;
            }

            try
            {
                return Results.Json(
                    await playground.CreateConversationAsync(scopedRequest, ResolveActorId(httpContext), scopedRequest, ct),
                    statusCode: StatusCodes.Status201Created);
            }
            catch (UnauthorizedAccessException ex)
            {
                return Results.Json(new { error = ex.Message }, statusCode: StatusCodes.Status403Forbidden);
            }
        });

        endpoints.MapGet("/api/playground/conversations/{conversationId}", async (
            string conversationId,
            string? accountOwnerType,
            string? accountOwnerId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresPlaygroundStore playground,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, accountOwnerType, accountOwnerId);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope) is { } denied)
            {
                return denied;
            }

            var conversation = await playground.GetConversationAsync(scope, conversationId, ct);
            return conversation is null ? Results.NotFound(new { error = "playground conversation not found" }) : Results.Ok(conversation);
        });

        endpoints.MapPut("/api/playground/conversations/{conversationId}", async (
            string conversationId,
            PlaygroundConversationRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresPlaygroundStore playground,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, request.AccountOwnerType, request.AccountOwnerId);
            var scopedRequest = request with
            {
                AccountOwnerType = scope.AccountOwnerType,
                AccountOwnerId = scope.AccountOwnerId,
                RegionCode = scope.RegionCode,
                Currency = scope.Currency,
            };
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scopedRequest) is { } denied)
            {
                return denied;
            }

            var conversation = await playground.UpdateConversationAsync(scopedRequest, conversationId, scopedRequest, ct);
            return conversation is null ? Results.NotFound(new { error = "playground conversation not found" }) : Results.Ok(conversation);
        });

        endpoints.MapDelete("/api/playground/conversations/{conversationId}", async (
            string conversationId,
            string? accountOwnerType,
            string? accountOwnerId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresPlaygroundStore playground,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, accountOwnerType, accountOwnerId);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope) is { } denied)
            {
                return denied;
            }

            var deleted = await playground.DeleteConversationAsync(scope, conversationId, ct);
            return deleted ? Results.Ok(new { deleted, conversationId }) : Results.NotFound(new { error = "playground conversation not found" });
        });

        endpoints.MapGet("/api/playground/conversations/{conversationId}/messages", async (
            string conversationId,
            string? accountOwnerType,
            string? accountOwnerId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresPlaygroundStore playground,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, accountOwnerType, accountOwnerId);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope) is { } denied)
            {
                return denied;
            }

            return Results.Ok(new { items = await playground.ListMessagesAsync(scope, conversationId, ct) });
        });

        endpoints.MapGet("/api/playground/chat-jobs", async (
            string? accountOwnerType,
            string? accountOwnerId,
            string? conversationId,
            bool? activeOnly,
            string? status,
            int? limit,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresPlaygroundStore playground,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, accountOwnerType, accountOwnerId);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope) is { } denied)
            {
                return denied;
            }

            return Results.Ok(new
            {
                items = await playground.ListChatJobsAsync(scope, conversationId, activeOnly == true, status, limit ?? 100, ct),
            });
        });

        endpoints.MapPost("/api/playground/chat-jobs", async (
            PlaygroundChatRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresPlaygroundStore playground,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, request.AccountOwnerType, request.AccountOwnerId);
            var scopedRequest = request with
            {
                AccountOwnerType = scope.AccountOwnerType,
                AccountOwnerId = scope.AccountOwnerId,
                RegionCode = scope.RegionCode,
                Currency = scope.Currency,
            };
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scopedRequest) is { } denied)
            {
                return denied;
            }

            try
            {
                return Results.Json(
                    await playground.StartChatJobAsync(scopedRequest, ResolveActorId(httpContext), scopedRequest, ct),
                    statusCode: StatusCodes.Status202Accepted);
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (UnauthorizedAccessException ex)
            {
                return Results.Json(new { error = ex.Message }, statusCode: StatusCodes.Status403Forbidden);
            }
        });

        endpoints.MapGet("/api/playground/chat-jobs/{jobId:guid}", async (
            Guid jobId,
            string? accountOwnerType,
            string? accountOwnerId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresPlaygroundStore playground,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, accountOwnerType, accountOwnerId);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope) is { } denied)
            {
                return denied;
            }

            var job = await playground.GetChatJobAsync(scope, jobId, ct);
            return job is null ? Results.NotFound(new { error = "playground chat job not found" }) : Results.Ok(new { job });
        });

        endpoints.MapGet("/api/playground/memories", async (
            string? accountOwnerType,
            string? accountOwnerId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresPlaygroundStore playground,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, accountOwnerType, accountOwnerId);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope) is { } denied)
            {
                return denied;
            }

            return Results.Ok(await playground.ListMemoriesAsync(scope, ct));
        });

        endpoints.MapPut("/api/playground/memories/preference", async (
            PlaygroundMemoryPreferenceRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresPlaygroundStore playground,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, request.AccountOwnerType, request.AccountOwnerId);
            var scopedRequest = request with
            {
                AccountOwnerType = scope.AccountOwnerType,
                AccountOwnerId = scope.AccountOwnerId,
                RegionCode = scope.RegionCode,
                Currency = scope.Currency,
            };
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scopedRequest) is { } denied)
            {
                return denied;
            }

            return Results.Ok(await playground.UpdateMemoryPreferenceAsync(scopedRequest, scopedRequest, ct));
        });

        endpoints.MapPut("/api/playground/memories/{key}", async (
            string key,
            PlaygroundMemoryRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresPlaygroundStore playground,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, request.AccountOwnerType, request.AccountOwnerId);
            var scopedRequest = request with
            {
                AccountOwnerType = scope.AccountOwnerType,
                AccountOwnerId = scope.AccountOwnerId,
                RegionCode = scope.RegionCode,
                Currency = scope.Currency,
            };
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scopedRequest) is { } denied)
            {
                return denied;
            }

            try
            {
                return Results.Ok(await playground.UpsertMemoryAsync(scopedRequest, key, scopedRequest, ct));
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        endpoints.MapDelete("/api/playground/memories/{key}", async (
            string key,
            string? accountOwnerType,
            string? accountOwnerId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresPlaygroundStore playground,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, accountOwnerType, accountOwnerId);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope) is { } denied)
            {
                return denied;
            }

            var deleted = await playground.DeleteMemoryAsync(scope, key, ct);
            return deleted ? Results.Ok(new { deleted, key }) : Results.NotFound(new { error = "playground memory not found" });
        });

        return endpoints;
    }
}
