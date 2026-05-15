using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Options;
using XiaoLou.ControlApi.Modules.Auth;
using XiaoLou.ControlApi.Modules.PublicAccess;
using XiaoLou.Domain;
using XiaoLou.Infrastructure.Postgres;
using static XiaoLou.ControlApi.Modules.Auth.AuthHelpers;

namespace XiaoLou.ControlApi.Modules.Playground;

internal static class PlaygroundEndpoints
{
    private static readonly JsonSerializerOptions SseJsonOptions = new(JsonSerializerDefaults.Web);

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
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope, requireConfiguredAccountGrant: false) is { } denied)
            {
                return denied;
            }

            return Results.Ok(await playground.GetConfigAsync(scope, ct));
        });

        endpoints.MapGet("/api/playground/models", (PostgresPlaygroundStore playground) =>
        {
            return PublicResponsePolicy.StableJson(playground.ListModels());
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
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope, requireConfiguredAccountGrant: false) is { } denied)
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
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scopedRequest, requireConfiguredAccountGrant: false) is { } denied)
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
                return ForbiddenError(ex);
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
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope, requireConfiguredAccountGrant: false) is { } denied)
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
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scopedRequest, requireConfiguredAccountGrant: false) is { } denied)
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
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope, requireConfiguredAccountGrant: false) is { } denied)
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
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope, requireConfiguredAccountGrant: false) is { } denied)
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
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope, requireConfiguredAccountGrant: false) is { } denied)
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
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scopedRequest, requireConfiguredAccountGrant: false) is { } denied)
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
                return BadRequestError(ex);
            }
            catch (UnauthorizedAccessException ex)
            {
                return ForbiddenError(ex);
            }
        });

        endpoints.MapPost("/api/playground/chat", async (
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
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scopedRequest, requireConfiguredAccountGrant: false) is { } denied)
            {
                return denied;
            }

            Dictionary<string, object?> result;
            try
            {
                result = await playground.StartChatJobAsync(scopedRequest, ResolveActorId(httpContext), scopedRequest, ct);
            }
            catch (ArgumentException ex)
            {
                return BadRequestError(ex);
            }
            catch (UnauthorizedAccessException ex)
            {
                return ForbiddenError(ex);
            }

            httpContext.Response.StatusCode = StatusCodes.Status200OK;
            httpContext.Response.ContentType = "text/event-stream";
            httpContext.Response.Headers.CacheControl = "no-cache";
            httpContext.Response.Headers["X-Accel-Buffering"] = "no";

            await WritePlaygroundSseEventAsync(httpContext, "conversation", new
            {
                type = "conversation",
                conversation = result["conversation"],
            }, ct);
            await WritePlaygroundSseEventAsync(httpContext, "user_message", new
            {
                type = "user_message",
                message = result["userMessage"],
            }, ct);
            await WritePlaygroundSseEventAsync(httpContext, "assistant_message", new
            {
                type = "assistant_message",
                message = result["assistantMessage"],
            }, ct);
            await WritePlaygroundSseEventAsync(httpContext, "job", new
            {
                type = "job",
                job = result["job"],
            }, ct);

            try
            {
                var memories = await playground.ListMemoriesAsync(scopedRequest, ct);
                memories.TryGetValue("items", out var memoryItems);
                await WritePlaygroundSseEventAsync(httpContext, "done", new
                {
                    type = "done",
                    conversation = result["conversation"],
                    message = result["assistantMessage"],
                    memories = memoryItems ?? Array.Empty<object>(),
                    job = result["job"],
                }, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                await WritePlaygroundSseEventAsync(httpContext, "error", new
                {
                    type = "error",
                    code = "PLAYGROUND_STREAM_FAILED",
                    message = ex.Message,
                    job = result["job"],
                }, ct);
            }

            return Results.Empty;
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
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope, requireConfiguredAccountGrant: false) is { } denied)
            {
                return denied;
            }

            var job = await playground.GetChatJobAsync(scope, jobId, ct);
            return job is null ? Results.NotFound(new { error = "playground chat job not found" }) : Results.Ok(new { job });
        });

        endpoints.MapGet("/api/playground/memories", async (
            string? accountOwnerType,
            string? accountOwnerId,
            string? search,
            bool? enabled,
            int? limit,
            int? offset,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresPlaygroundStore playground,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, accountOwnerType, accountOwnerId);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope, requireConfiguredAccountGrant: false) is { } denied)
            {
                return denied;
            }

            return Results.Ok(await playground.ListMemoriesAsync(scope, search, enabled, limit ?? 100, offset ?? 0, ct));
        });

        endpoints.MapPost("/api/playground/memories", async (
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
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scopedRequest, requireConfiguredAccountGrant: false) is { } denied)
            {
                return denied;
            }

            if (NormalizeBlank(scopedRequest.Key) is null)
            {
                return BadRequestError(new ArgumentException("Playground memory key is required.", nameof(request)));
            }

            try
            {
                return Results.Json(
                    await playground.UpsertMemoryAsync(scopedRequest, scopedRequest.Key ?? "", scopedRequest, ct),
                    statusCode: StatusCodes.Status201Created);
            }
            catch (ArgumentException ex)
            {
                return BadRequestError(ex);
            }
        });

        endpoints.MapGet("/api/playground/memories/vector-index", async (
            string? accountOwnerType,
            string? accountOwnerId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresPlaygroundStore playground,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, accountOwnerType, accountOwnerId);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope, requireConfiguredAccountGrant: false) is { } denied)
            {
                return denied;
            }

            return Results.Ok(await playground.GetMemoryVectorIndexAsync(scope, ct));
        });

        endpoints.MapPost("/api/playground/memories/vector-index/rebuild", async (
            PlaygroundMemoryVectorRebuildRequest request,
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
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scopedRequest, requireConfiguredAccountGrant: false) is { } denied)
            {
                return denied;
            }

            return Results.Ok(await playground.RebuildMemoryVectorIndexAsync(scopedRequest, scopedRequest, ct));
        });

        endpoints.MapPost("/api/playground/memories/recall-test", async (
            PlaygroundMemoryRecallRequest request,
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
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scopedRequest, requireConfiguredAccountGrant: false) is { } denied)
            {
                return denied;
            }

            if (NormalizeBlank(scopedRequest.Query) is null)
            {
                return BadRequestError(new ArgumentException("Playground memory recall query is required.", nameof(request)));
            }

            try
            {
                return Results.Ok(await playground.RecallMemoriesAsync(scopedRequest, scopedRequest, ct));
            }
            catch (ArgumentException ex)
            {
                return BadRequestError(ex);
            }
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
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scopedRequest, requireConfiguredAccountGrant: false) is { } denied)
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
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scopedRequest, requireConfiguredAccountGrant: false) is { } denied)
            {
                return denied;
            }

            try
            {
                return Results.Ok(await playground.UpsertMemoryAsync(scopedRequest, key, scopedRequest, ct));
            }
            catch (ArgumentException ex)
            {
                return BadRequestError(ex);
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
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope, requireConfiguredAccountGrant: false) is { } denied)
            {
                return denied;
            }

            var deleted = await playground.DeleteMemoryAsync(scope, key, ct);
            return deleted ? Results.Ok(new { deleted, key }) : Results.NotFound(new { error = "playground memory not found" });
        });

        return endpoints;
    }

    private static async Task WritePlaygroundSseEventAsync(
        HttpContext httpContext,
        string eventName,
        object payload,
        CancellationToken ct)
    {
        await httpContext.Response.WriteAsync($"event: {eventName}\n", ct);
        await httpContext.Response.WriteAsync($"data: {JsonSerializer.Serialize(payload, SseJsonOptions)}\n\n", ct);
        await httpContext.Response.Body.FlushAsync(ct);
    }
}
