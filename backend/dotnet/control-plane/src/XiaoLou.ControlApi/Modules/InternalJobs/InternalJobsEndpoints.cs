using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Options;
using XiaoLou.ControlApi.Modules.Auth;
using XiaoLou.Domain;
using XiaoLou.Infrastructure.Postgres;
using static XiaoLou.ControlApi.Modules.Auth.AuthHelpers;

namespace XiaoLou.ControlApi.Modules.InternalJobs;

internal static class InternalJobsEndpoints
{
    public static IEndpointRouteBuilder MapInternalJobsEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/jobs", async (
            CreateJobRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresJobQueue jobs,
            CancellationToken ct) =>
        {
            if (AuthorizeAccountScope(httpContext, clientApi.Value, request, requireConfiguredAccountGrant: false) is { } denied)
            {
                return denied;
            }

            var job = await jobs.CreateJobAsync(request, ct);
            return Results.Ok(job);
        });

        endpoints.MapGet("/api/jobs", async (
            string? accountId,
            string? accountOwnerType,
            string? accountOwnerId,
            string? lane,
            string? status,
            int? limit,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresJobQueue jobs,
            CancellationToken ct) =>
        {
            Guid? parsedAccountId = Guid.TryParse(accountId, out var accountGuid) ? accountGuid : null;
            var normalizedOwnerType = NormalizeOwnerType(accountOwnerType);
            var normalizedOwnerId = NormalizeBlank(accountOwnerId);

            IResult? denied = parsedAccountId is not null
                ? AuthorizeAccountId(httpContext, clientApi.Value, parsedAccountId, requireConfiguredAccountGrant: false)
                : AuthorizeAccountScope(httpContext, clientApi.Value, new AccountScope
                {
                    AccountOwnerType = normalizedOwnerType,
                    AccountOwnerId = normalizedOwnerId,
                }, requireConfiguredAccountGrant: false);

            if (denied is not null)
            {
                return denied;
            }

            return Results.Ok(await jobs.ListJobsAsync(
                parsedAccountId,
                normalizedOwnerType,
                normalizedOwnerId,
                lane,
                status,
                limit ?? 50,
                ct));
        });

        endpoints.MapGet("/api/jobs/{jobId:guid}", async (
            Guid jobId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresJobQueue jobs,
            CancellationToken ct) =>
        {
            var job = await jobs.GetJobAsync(jobId, ct);
            if (job is null)
            {
                return Results.NotFound();
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, job, requireConfiguredAccountGrant: false) is { } denied)
            {
                return denied;
            }

            return Results.Ok(job);
        });

        endpoints.MapPost("/api/jobs/{jobId:guid}/cancel", async (
            Guid jobId,
            CancelJobRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresJobQueue jobs,
            CancellationToken ct) =>
        {
            var existing = await jobs.GetJobAsync(jobId, ct);
            if (existing is null)
            {
                return Results.NotFound();
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, existing, requireConfiguredAccountGrant: false) is { } denied)
            {
                return denied;
            }

            var job = await jobs.CancelAsync(jobId, request, ct);
            return job is null ? Results.NotFound() : Results.Ok(job);
        });

        endpoints.MapPost("/api/internal/jobs/lease", async (
            LeaseJobsRequest request,
            PostgresJobQueue jobs,
            CancellationToken ct) =>
        {
            return Results.Ok(await jobs.LeaseJobsAsync(request, ct));
        });

        endpoints.MapPost("/api/internal/jobs/{jobId:guid}/running", async (
            Guid jobId,
            MarkJobRunningRequest request,
            PostgresJobQueue jobs,
            CancellationToken ct) =>
        {
            var job = await jobs.MarkRunningAsync(jobId, request.WorkerId, ct);
            return job is null ? Results.NotFound() : Results.Ok(job);
        });

        endpoints.MapPost("/api/internal/jobs/{jobId:guid}/heartbeat", async (
            Guid jobId,
            JobHeartbeatRequest request,
            PostgresJobQueue jobs,
            CancellationToken ct) =>
        {
            var job = await jobs.HeartbeatAsync(jobId, request.WorkerId ?? "", request.LeaseSeconds, ct);
            return job is null ? Results.NotFound() : Results.Ok(job);
        });

        endpoints.MapPost("/api/internal/jobs/recover-expired", async (
            PostgresJobQueue jobs,
            CancellationToken ct) =>
        {
            return await HandleRecoverExpiredJobsAsync(jobs, ct);
        });

        endpoints.MapPost("/api/internal/jobs/recover-expired-leases", async (
            PostgresJobQueue jobs,
            CancellationToken ct) =>
        {
            return await HandleRecoverExpiredJobsAsync(jobs, ct);
        });

        endpoints.MapGet("/api/internal/jobs/{jobId:guid}/attempts", async (
            Guid jobId,
            PostgresJobQueue jobs,
            CancellationToken ct) =>
        {
            return Results.Ok(await jobs.ListAttemptsAsync(jobId, ct));
        });

        endpoints.MapPost("/api/internal/jobs/{jobId:guid}/succeed", async (
            Guid jobId,
            CompleteJobRequest request,
            PostgresJobQueue jobs,
            CancellationToken ct) =>
        {
            return await HandleJobSucceedAsync(jobId, request, jobs, ct);
        });

        endpoints.MapPost("/api/internal/jobs/{jobId:guid}/succeeded", async (
            Guid jobId,
            CompleteJobRequest request,
            PostgresJobQueue jobs,
            CancellationToken ct) =>
        {
            return await HandleJobSucceedAsync(jobId, request, jobs, ct);
        });

        endpoints.MapPost("/api/internal/jobs/{jobId:guid}/fail", async (
            Guid jobId,
            FailJobRequest request,
            PostgresJobQueue jobs,
            CancellationToken ct) =>
        {
            return await HandleJobFailAsync(jobId, request, jobs, ct);
        });

        endpoints.MapPost("/api/internal/jobs/{jobId:guid}/failed", async (
            Guid jobId,
            FailJobRequest request,
            PostgresJobQueue jobs,
            CancellationToken ct) =>
        {
            return await HandleJobFailAsync(jobId, request, jobs, ct);
        });

        endpoints.MapGet("/api/internal/jobs/wait-signal", async (
            int? timeoutSeconds,
            PostgresJobNotificationListener listener,
            CancellationToken ct) =>
        {
            var timeout = TimeSpan.FromSeconds(Math.Clamp(timeoutSeconds ?? 5, 1, 30));
            var payload = await listener.WaitForJobSignalAsync(timeout, ct);
            return Results.Ok(new
            {
                notified = payload is not null,
                payload,
            });
        });

        endpoints.MapPost("/api/internal/outbox/lease", async (
            OutboxLeaseRequest request,
            PostgresOutboxStore outbox,
            CancellationToken ct) =>
        {
            return Results.Ok(await outbox.LeaseAsync(request, ct));
        });

        endpoints.MapPost("/api/internal/outbox/{eventId:guid}/complete", async (
            Guid eventId,
            OutboxCompleteRequest request,
            PostgresOutboxStore outbox,
            CancellationToken ct) =>
        {
            var result = await outbox.CompleteAsync(eventId, request, ct);
            return result is null ? Results.NotFound() : Results.Ok(result);
        });

        return endpoints;
    }

    private static string JsonbFrom(JsonElement element)
    {
        return element.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null
            ? "{}"
            : element.GetRawText();
    }

    private static async Task<IResult> HandleRecoverExpiredJobsAsync(
        PostgresJobQueue jobs,
        CancellationToken ct)
    {
        return Results.Ok(await jobs.RecoverExpiredLeasesAsync(ct));
    }

    private static async Task<IResult> HandleJobSucceedAsync(
        Guid jobId,
        CompleteJobRequest request,
        PostgresJobQueue jobs,
        CancellationToken ct)
    {
        var job = await jobs.SucceedAsync(jobId, JsonbFrom(request.Result), ct);
        return job is null ? Results.NotFound() : Results.Ok(job);
    }

    private static async Task<IResult> HandleJobFailAsync(
        Guid jobId,
        FailJobRequest request,
        PostgresJobQueue jobs,
        CancellationToken ct)
    {
        var job = await jobs.FailOrRetryAsync(
            jobId,
            request.Error ?? "job failed",
            request.Retry,
            request.RetryDelaySeconds,
            ct);
        return job is null ? Results.NotFound() : Results.Ok(job);
    }
}
