using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Options;
using XiaoLou.ControlApi.Modules.Auth;
using XiaoLou.Domain;
using XiaoLou.Infrastructure.Postgres;
using static XiaoLou.ControlApi.Modules.Auth.AuthHelpers;

namespace XiaoLou.ControlApi.Modules.Projects;

internal static class ProjectEndpoints
{
    private static readonly JsonSerializerOptions ProjectJsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true,
    };

    public static IEndpointRouteBuilder MapProjectEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/projects", async (
            string? accountOwnerType,
            string? accountOwnerId,
            int? page,
            int? pageSize,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, accountOwnerType, accountOwnerId);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope) is { } denied)
            {
                return denied;
            }

            var items = await projects.ListProjectsAsync(scope, page ?? 1, pageSize ?? 20, ct);
            var total = items.FirstOrDefault()?.TryGetValue("total_count", out var totalCount) == true
                ? totalCount
                : items.Count;
            return Results.Ok(new
            {
                items,
                page = Math.Max(1, page ?? 1),
                pageSize = Math.Clamp(pageSize ?? 20, 1, 100),
                total,
            });
        });

        endpoints.MapPost("/api/projects", async (
            ProjectRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.Title))
            {
                return Results.BadRequest(new { error = "title is required" });
            }

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

            return Results.Json(await projects.CreateProjectAsync(scopedRequest, ct), statusCode: StatusCodes.Status201Created);
        });

        endpoints.MapGet("/api/projects/{projectId}", async (
            string projectId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var project = await projects.GetProjectAsync(projectId, ct);
            if (project is null)
            {
                return Results.NotFound(new { error = "project not found" });
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, project) is { } denied)
            {
                return denied;
            }

            return Results.Ok(project);
        });

        endpoints.MapPut("/api/projects/{projectId}", async (
            string projectId,
            ProjectRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var existing = await projects.GetProjectAsync(projectId, ct);
            if (existing is null)
            {
                return Results.NotFound(new { error = "project not found" });
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, existing) is { } denied)
            {
                return denied;
            }

            var project = await projects.UpdateProjectAsync(projectId, request, ct);
            return project is null ? Results.NotFound(new { error = "project not found" }) : Results.Ok(project);
        });

        endpoints.MapGet("/api/projects/{projectId}/overview", async (
            string projectId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var project = await projects.GetProjectAsync(projectId, ct);
            if (project is null)
            {
                return Results.NotFound(new { error = "project not found" });
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, project) is { } denied)
            {
                return denied;
            }

            var overview = await projects.GetProjectOverviewAsync(projectId, ct);
            return overview is null ? Results.NotFound(new { error = "project not found" }) : Results.Ok(overview);
        });

        endpoints.MapGet("/api/projects/{projectId}/settings", async (
            string projectId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var project = await projects.GetProjectAsync(projectId, ct);
            if (project is null)
            {
                return Results.NotFound(new { error = "project not found" });
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, project) is { } denied)
            {
                return denied;
            }

            return Results.Ok(await projects.GetSettingsAsync(projectId, ct));
        });

        endpoints.MapPut("/api/projects/{projectId}/settings", async (
            string projectId,
            JsonElement request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var project = await projects.GetProjectAsync(projectId, ct);
            if (project is null)
            {
                return Results.NotFound(new { error = "project not found" });
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, project) is { } denied)
            {
                return denied;
            }

            return Results.Ok(await projects.UpsertSettingsAsync(projectId, new ProjectSettingsRequest { Data = request }, ct));
        });

        endpoints.MapGet("/api/projects/{projectId}/script", async (
            string projectId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var project = await projects.GetProjectAsync(projectId, ct);
            if (project is null)
            {
                return Results.NotFound(new { error = "project not found" });
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, project) is { } denied)
            {
                return denied;
            }

            return Results.Ok(await projects.GetScriptAsync(projectId, ct));
        });

        endpoints.MapPut("/api/projects/{projectId}/script", async (
            string projectId,
            ProjectScriptRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var project = await projects.GetProjectAsync(projectId, ct);
            if (project is null)
            {
                return Results.NotFound(new { error = "project not found" });
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, project) is { } denied)
            {
                return denied;
            }

            return Results.Ok(await projects.UpsertScriptAsync(projectId, request, ct));
        });

        endpoints.MapGet("/api/projects/{projectId}/timeline", async (
            string projectId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var project = await projects.GetProjectAsync(projectId, ct);
            if (project is null)
            {
                return Results.NotFound(new { error = "project not found" });
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, project) is { } denied)
            {
                return denied;
            }

            return Results.Ok(await projects.GetTimelineAsync(projectId, ct));
        });

        endpoints.MapPut("/api/projects/{projectId}/timeline", async (
            string projectId,
            ProjectTimelineRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var project = await projects.GetProjectAsync(projectId, ct);
            if (project is null)
            {
                return Results.NotFound(new { error = "project not found" });
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, project) is { } denied)
            {
                return denied;
            }

            return Results.Ok(await projects.UpsertTimelineAsync(projectId, request, ct));
        });

        endpoints.MapGet("/api/projects/{projectId}/assets", async (
            string projectId,
            string? assetType,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var project = await projects.GetProjectAsync(projectId, ct);
            if (project is null)
            {
                return Results.NotFound(new { error = "project not found" });
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, project) is { } denied)
            {
                return denied;
            }

            return Results.Ok(new { items = await projects.ListAssetsAsync(projectId, assetType, ct) });
        });

        endpoints.MapGet("/api/projects/{projectId}/assets/{assetId}", async (
            string projectId,
            string assetId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var project = await projects.GetProjectAsync(projectId, ct);
            if (project is null)
            {
                return Results.NotFound(new { error = "project not found" });
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, project) is { } denied)
            {
                return denied;
            }

            var asset = await projects.GetAssetAsync(projectId, assetId, ct);
            return asset is null ? Results.NotFound(new { error = "asset not found" }) : Results.Ok(asset);
        });

        endpoints.MapPost("/api/projects/{projectId}/assets", async (
            string projectId,
            JsonElement request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var project = await projects.GetProjectAsync(projectId, ct);
            if (project is null)
            {
                return Results.NotFound(new { error = "project not found" });
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, project) is { } denied)
            {
                return denied;
            }

            var asset = await projects.UpsertAssetAsync(projectId, null, request, ct);
            return asset is null
                ? Results.Json(new { error = "asset is owned by another project" }, statusCode: StatusCodes.Status403Forbidden)
                : Results.Json(asset, statusCode: StatusCodes.Status201Created);
        });

        endpoints.MapPut("/api/projects/{projectId}/assets/{assetId}", async (
            string projectId,
            string assetId,
            JsonElement request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var project = await projects.GetProjectAsync(projectId, ct);
            if (project is null)
            {
                return Results.NotFound(new { error = "project not found" });
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, project) is { } denied)
            {
                return denied;
            }

            var asset = await projects.UpsertAssetAsync(projectId, assetId, request, ct);
            return asset is null
                ? Results.Json(new { error = "asset is owned by another project" }, statusCode: StatusCodes.Status403Forbidden)
                : Results.Ok(asset);
        });

        endpoints.MapDelete("/api/projects/{projectId}/assets/{assetId}", async (
            string projectId,
            string assetId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var project = await projects.GetProjectAsync(projectId, ct);
            if (project is null)
            {
                return Results.NotFound(new { error = "project not found" });
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, project) is { } denied)
            {
                return denied;
            }

            var deleted = await projects.DeleteProjectItemAsync("project_assets", projectId, assetId, ct);
            return deleted ? Results.Ok(new { deleted, assetId }) : Results.NotFound(new { error = "asset not found" });
        });

        endpoints.MapGet("/api/projects/{projectId}/storyboards", async (
            string projectId,
            int? episodeNo,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var project = await projects.GetProjectAsync(projectId, ct);
            if (project is null)
            {
                return Results.NotFound(new { error = "project not found" });
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, project) is { } denied)
            {
                return denied;
            }

            return Results.Ok(new { items = await projects.ListStoryboardsAsync(projectId, episodeNo, ct) });
        });

        endpoints.MapGet("/api/projects/{projectId}/storyboards/{storyboardId}", async (
            string projectId,
            string storyboardId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var project = await projects.GetProjectAsync(projectId, ct);
            if (project is null)
            {
                return Results.NotFound(new { error = "project not found" });
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, project) is { } denied)
            {
                return denied;
            }

            var storyboard = await projects.GetStoryboardAsync(projectId, storyboardId, ct);
            return storyboard is null ? Results.NotFound(new { error = "storyboard not found" }) : Results.Ok(storyboard);
        });

        endpoints.MapPut("/api/projects/{projectId}/storyboards/{storyboardId}", async (
            string projectId,
            string storyboardId,
            JsonElement request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var project = await projects.GetProjectAsync(projectId, ct);
            if (project is null)
            {
                return Results.NotFound(new { error = "project not found" });
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, project) is { } denied)
            {
                return denied;
            }

            var storyboard = await projects.UpsertStoryboardAsync(projectId, storyboardId, request, ct);
            return storyboard is null
                ? Results.Json(new { error = "storyboard is owned by another project" }, statusCode: StatusCodes.Status403Forbidden)
                : Results.Ok(storyboard);
        });

        endpoints.MapDelete("/api/projects/{projectId}/storyboards/{storyboardId}", async (
            string projectId,
            string storyboardId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var project = await projects.GetProjectAsync(projectId, ct);
            if (project is null)
            {
                return Results.NotFound(new { error = "project not found" });
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, project) is { } denied)
            {
                return denied;
            }

            var deleted = await projects.DeleteProjectItemAsync("project_storyboards", projectId, storyboardId, ct);
            return deleted ? Results.Ok(new { deleted, storyboardId }) : Results.NotFound(new { error = "storyboard not found" });
        });

        endpoints.MapGet("/api/projects/{projectId}/videos", async (
            string projectId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var project = await projects.GetProjectAsync(projectId, ct);
            if (project is null)
            {
                return Results.NotFound(new { error = "project not found" });
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, project) is { } denied)
            {
                return denied;
            }

            return Results.Ok(new { items = await projects.ListVideosAsync(projectId, ct) });
        });

        endpoints.MapPut("/api/projects/{projectId}/videos/{videoId}", async (
            string projectId,
            string videoId,
            JsonElement request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var project = await projects.GetProjectAsync(projectId, ct);
            if (project is null)
            {
                return Results.NotFound(new { error = "project not found" });
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, project) is { } denied)
            {
                return denied;
            }

            var video = await projects.UpsertVideoAsync(projectId, videoId, request, ct);
            return video is null
                ? Results.Json(new { error = "video is owned by another project" }, statusCode: StatusCodes.Status403Forbidden)
                : Results.Ok(video);
        });

        endpoints.MapGet("/api/projects/{projectId}/dubbings", async (
            string projectId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var project = await projects.GetProjectAsync(projectId, ct);
            if (project is null)
            {
                return Results.NotFound(new { error = "project not found" });
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, project) is { } denied)
            {
                return denied;
            }

            return Results.Ok(new { items = await projects.ListDubbingsAsync(projectId, ct) });
        });

        endpoints.MapPut("/api/projects/{projectId}/dubbings/{dubbingId}", async (
            string projectId,
            string dubbingId,
            JsonElement request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var project = await projects.GetProjectAsync(projectId, ct);
            if (project is null)
            {
                return Results.NotFound(new { error = "project not found" });
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, project) is { } denied)
            {
                return denied;
            }

            var dubbing = await projects.UpsertDubbingAsync(projectId, dubbingId, request, ct);
            return dubbing is null
                ? Results.Json(new { error = "dubbing is owned by another project" }, statusCode: StatusCodes.Status403Forbidden)
                : Results.Ok(dubbing);
        });

        endpoints.MapGet("/api/projects/{projectId}/exports", async (
            string projectId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var project = await projects.GetProjectAsync(projectId, ct);
            if (project is null)
            {
                return Results.NotFound(new { error = "project not found" });
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, project) is { } denied)
            {
                return denied;
            }

            return Results.Ok(new { items = await projects.ListExportsAsync(projectId, ct) });
        });

        endpoints.MapPost("/api/projects/{projectId}/exports", async (
            string projectId,
            JsonElement request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            PostgresJobQueue jobs,
            CancellationToken ct) =>
        {
            var project = await projects.GetProjectAsync(projectId, ct);
            if (project is null)
            {
                return Results.NotFound(new { error = "project not found" });
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, project) is { } denied)
            {
                return denied;
            }

            var format = ReadJsonString(request, "format") ?? "mp4";
            var payload = request.ValueKind == JsonValueKind.Object
                ? JsonSerializer.Deserialize<Dictionary<string, object?>>(request.GetRawText(), ProjectJsonOptions) ?? new Dictionary<string, object?>()
                : new Dictionary<string, object?>();
            payload["projectId"] = projectId;
            payload["format"] = format;

            var job = await jobs.CreateJobAsync(new CreateJobRequest
            {
                AccountOwnerType = TryReadRowString(project, "account_owner_type") ?? "user",
                AccountOwnerId = TryReadRowString(project, "account_owner_id") ?? "guest",
                Lane = AccountLanes.Media,
                JobType = "project_export_requested",
                IdempotencyKey = $"project-export:{projectId}:{format}:{Guid.NewGuid():N}",
                Payload = JsonSerializer.SerializeToElement(payload, ProjectJsonOptions),
                CreatedByUserId = TryReadRowString(project, "created_by_user_id"),
            }, ct);

            Guid? jobId = null;
            if (Guid.TryParse(job?.GetValueOrDefault("id")?.ToString(), out var parsedJobId))
            {
                jobId = parsedJobId;
            }

            var export = await projects.CreateExportAsync(projectId, request, jobId, ct);
            return export is null
                ? Results.Json(new { error = "export is owned by another project" }, statusCode: StatusCodes.Status403Forbidden)
                : Results.Json(export, statusCode: StatusCodes.Status202Accepted);
        });

        endpoints.MapGet("/api/canvas-projects", async (
            string? accountOwnerType,
            string? accountOwnerId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, accountOwnerType, accountOwnerId);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope) is { } denied)
            {
                return denied;
            }

            return Results.Ok(new { items = await projects.ListCanvasProjectsAsync("canvas_projects", scope, false, ct) });
        });

        endpoints.MapGet("/api/canvas-projects/{projectId}", async (
            string projectId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var project = await projects.GetCanvasProjectAsync("canvas_projects", projectId, false, ct);
            if (project is null)
            {
                return Results.NotFound(new { error = "canvas project not found" });
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, project) is { } denied)
            {
                return denied;
            }

            return Results.Ok(project);
        });

        endpoints.MapPost("/api/canvas-projects", async (
            CanvasProjectRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, request.AccountOwnerType, request.AccountOwnerId);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope) is { } denied)
            {
                return denied;
            }

            var project = await projects.UpsertCanvasProjectAsync("canvas_projects", scope, request, false, ct);
            return project is null
                ? Results.Json(new { error = "canvas project is owned by another account" }, statusCode: StatusCodes.Status403Forbidden)
                : Results.Json(project, statusCode: StatusCodes.Status201Created);
        });

        endpoints.MapPut("/api/canvas-projects/{projectId}", async (
            string projectId,
            CanvasProjectRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, request.AccountOwnerType, request.AccountOwnerId);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope) is { } denied)
            {
                return denied;
            }

            var project = await projects.UpsertCanvasProjectAsync("canvas_projects", scope, request with { Id = projectId }, false, ct);
            return project is null
                ? Results.Json(new { error = "canvas project is owned by another account" }, statusCode: StatusCodes.Status403Forbidden)
                : Results.Ok(project);
        });

        endpoints.MapDelete("/api/canvas-projects/{projectId}", async (
            string projectId,
            string? accountOwnerType,
            string? accountOwnerId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, accountOwnerType, accountOwnerId);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope) is { } denied)
            {
                return denied;
            }

            var deleted = await projects.DeleteCanvasProjectAsync("canvas_projects", scope, projectId, ct);
            return deleted ? Results.Ok(new { deleted, projectId }) : Results.NotFound(new { error = "canvas project not found" });
        });

        endpoints.MapGet("/api/agent-canvas/projects", async (
            string? accountOwnerType,
            string? accountOwnerId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, accountOwnerType, accountOwnerId);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope) is { } denied)
            {
                return denied;
            }

            return Results.Ok(new { items = await projects.ListCanvasProjectsAsync("agent_canvas_projects", scope, true, ct) });
        });

        endpoints.MapGet("/api/agent-canvas/projects/{projectId}", async (
            string projectId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var project = await projects.GetCanvasProjectAsync("agent_canvas_projects", projectId, true, ct);
            if (project is null)
            {
                return Results.NotFound(new { error = "agent canvas project not found" });
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, project) is { } denied)
            {
                return denied;
            }

            return Results.Ok(project);
        });

        endpoints.MapPost("/api/agent-canvas/projects", async (
            CanvasProjectRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, request.AccountOwnerType, request.AccountOwnerId);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope) is { } denied)
            {
                return denied;
            }

            var project = await projects.UpsertCanvasProjectAsync("agent_canvas_projects", scope, request, true, ct);
            return project is null
                ? Results.Json(new { error = "agent canvas project is owned by another account" }, statusCode: StatusCodes.Status403Forbidden)
                : Results.Json(project, statusCode: StatusCodes.Status201Created);
        });

        endpoints.MapPut("/api/agent-canvas/projects/{projectId}", async (
            string projectId,
            CanvasProjectRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, request.AccountOwnerType, request.AccountOwnerId);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope) is { } denied)
            {
                return denied;
            }

            var project = await projects.UpsertCanvasProjectAsync("agent_canvas_projects", scope, request with { Id = projectId }, true, ct);
            return project is null
                ? Results.Json(new { error = "agent canvas project is owned by another account" }, statusCode: StatusCodes.Status403Forbidden)
                : Results.Ok(project);
        });

        endpoints.MapDelete("/api/agent-canvas/projects/{projectId}", async (
            string projectId,
            string? accountOwnerType,
            string? accountOwnerId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, accountOwnerType, accountOwnerId);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope) is { } denied)
            {
                return denied;
            }

            var deleted = await projects.DeleteCanvasProjectAsync("agent_canvas_projects", scope, projectId, ct);
            return deleted ? Results.Ok(new { deleted, projectId }) : Results.NotFound(new { error = "agent canvas project not found" });
        });

        endpoints.MapGet("/api/create/images", async (
            string? accountOwnerType,
            string? accountOwnerId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, accountOwnerType, accountOwnerId);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope) is { } denied)
            {
                return denied;
            }

            return Results.Ok(new { items = await projects.ListCreateResultsAsync(scope, "image", ct) });
        });

        endpoints.MapGet("/api/create/videos", async (
            string? accountOwnerType,
            string? accountOwnerId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, accountOwnerType, accountOwnerId);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope) is { } denied)
            {
                return denied;
            }

            return Results.Ok(new { items = await projects.ListCreateResultsAsync(scope, "video", ct) });
        });

        endpoints.MapDelete("/api/create/images/{imageId}", async (
            string imageId,
            string? accountOwnerType,
            string? accountOwnerId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, accountOwnerType, accountOwnerId);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope) is { } denied)
            {
                return denied;
            }

            return Results.Ok(await projects.DeleteCreateResultAsync(scope, "image", imageId, ct));
        });

        endpoints.MapDelete("/api/create/videos/{videoId}", async (
            string videoId,
            string? accountOwnerType,
            string? accountOwnerId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresProjectSurfaceStore projects,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, accountOwnerType, accountOwnerId);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope) is { } denied)
            {
                return denied;
            }

            return Results.Ok(await projects.DeleteCreateResultAsync(scope, "video", videoId, ct));
        });

        return endpoints;
    }
}
