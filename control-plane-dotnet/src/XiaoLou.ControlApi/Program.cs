using System.Text;
using System.Text.Json;
using System.Net;
using System.Security.Cryptography;
using System.Diagnostics;
using Microsoft.Extensions.Hosting.WindowsServices;
using Microsoft.Extensions.Options;
using Npgsql;
using XiaoLou.Domain;
using XiaoLou.Infrastructure.Postgres;
using XiaoLou.Infrastructure.Storage;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddWindowsService();
builder.Services.AddXiaoLouPostgres(builder.Configuration);
builder.Services.Configure<ObjectStorageOptions>(builder.Configuration.GetSection("ObjectStorage"));
builder.Services.Configure<InternalApiOptions>(builder.Configuration.GetSection("InternalApi"));
builder.Services.Configure<ClientApiOptions>(builder.Configuration.GetSection("ClientApi"));
builder.Services.Configure<PaymentCallbackOptions>(builder.Configuration.GetSection("Payments"));
builder.Services.AddSingleton<IObjectStorageSigner, ObjectStorageSigner>();
builder.Services.AddSingleton<IPaymentSignatureVerifier, HmacPaymentSignatureVerifier>();
builder.Services.AddHostedService<LeaseRecoveryService>();

var app = builder.Build();

var postgresOptions = app.Services.GetRequiredService<IOptions<PostgresOptions>>().Value;
if (postgresOptions.ApplySchemaOnStartup)
{
    await app.Services.GetRequiredService<PostgresSchemaMigrator>()
        .ApplyAsync(app.Lifetime.ApplicationStopping);
}

var jsonOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web)
{
    PropertyNameCaseInsensitive = true,
};

app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/api/internal")
        && !IsInternalRequestAllowed(context, context.RequestServices.GetRequiredService<IOptions<InternalApiOptions>>().Value))
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await context.Response.WriteAsJsonAsync(new
        {
            error = "internal API is not available from this request context",
        });
        return;
    }

    if (IsOperationalRequest(context)
        && !IsInternalRequestAllowed(context, context.RequestServices.GetRequiredService<IOptions<InternalApiOptions>>().Value))
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await context.Response.WriteAsJsonAsync(new
        {
            error = "operational API is not available from this request context",
        });
        return;
    }

    var isPublicClientRequest = IsPublicClientApiRequest(context);
    var clientApiOptions = context.RequestServices.GetRequiredService<IOptions<ClientApiOptions>>().Value;
    var clientAuth = isPublicClientRequest
        ? AuthenticateClientRequest(context, clientApiOptions)
        : ClientAuthenticationResult.Allowed(null);
    if (isPublicClientRequest && !clientAuth.IsAllowed)
    {
        context.Response.StatusCode = clientAuth.StatusCode;
        await context.Response.WriteAsJsonAsync(new
        {
            error = clientAuth.Error,
        });
        return;
    }

    if (isPublicClientRequest)
    {
        context.Items[ClientPrincipal.ItemKey] = clientAuth.Principal;
    }

    if (isPublicClientRequest && !IsClientPermissionAllowed(context, clientApiOptions))
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await context.Response.WriteAsJsonAsync(new
        {
            error = "client token is missing the required public API permission",
            requiredPermission = GetRequiredClientPermission(context),
        });
        return;
    }

    await next();
});

app.MapGet("/healthz", () => Results.Ok(new
{
    service = "xiaolou-control-api",
    status = "ok",
    architecture = "windows-native-dotnet-postgresql",
}));

app.MapGet("/livez", () => Results.Ok(new
{
    service = "xiaolou-control-api",
    status = "alive",
}));

app.MapGet("/readyz", async (NpgsqlDataSource dataSource, CancellationToken ct) =>
{
    try
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("select 1", connection);
        await command.ExecuteScalarAsync(ct);

        return Results.Ok(new
        {
            service = "xiaolou-control-api",
            status = "ready",
            dependency = "postgresql",
        });
    }
    catch (Exception ex)
    {
        return Results.Json(new
        {
            service = "xiaolou-control-api",
            status = "not_ready",
            dependency = "postgresql",
            error = ex.GetType().Name,
        }, statusCode: StatusCodes.Status503ServiceUnavailable);
    }
});

app.MapGet("/metrics", () =>
{
    using var process = Process.GetCurrentProcess();
    var uptimeSeconds = Math.Max(0, (DateTimeOffset.UtcNow - new DateTimeOffset(process.StartTime.ToUniversalTime())).TotalSeconds);
    var lines = new[]
    {
        "# HELP xiaolou_controlapi_up Control API process up signal.",
        "# TYPE xiaolou_controlapi_up gauge",
        "xiaolou_controlapi_up 1",
        "# HELP xiaolou_controlapi_uptime_seconds Control API process uptime in seconds.",
        "# TYPE xiaolou_controlapi_uptime_seconds gauge",
        $"xiaolou_controlapi_uptime_seconds {uptimeSeconds:F0}",
        "# HELP xiaolou_controlapi_working_set_bytes Control API process working set.",
        "# TYPE xiaolou_controlapi_working_set_bytes gauge",
        $"xiaolou_controlapi_working_set_bytes {process.WorkingSet64}",
        "# HELP xiaolou_controlapi_gc_total_memory_bytes Managed memory reported by GC.",
        "# TYPE xiaolou_controlapi_gc_total_memory_bytes gauge",
        $"xiaolou_controlapi_gc_total_memory_bytes {GC.GetTotalMemory(false)}",
    };

    return Results.Text(string.Join('\n', lines) + "\n", "text/plain; version=0.0.4; charset=utf-8");
});

app.MapGet("/api/windows-native/status", () => Results.Ok(new
{
    enabled = true,
    service = "xiaolou-control-api",
    productionTarget = "windows-native-dotnet-postgresql",
    asyncFoundation = "postgresql",
    coreApiRole = "compat-readonly",
}));

app.MapPost("/api/schema/apply", async (PostgresSchemaMigrator migrator, CancellationToken ct) =>
{
    await migrator.ApplyAsync(ct);
    return Results.Ok(new { applied = true });
});

app.MapPost("/api/accounts/ensure", async (
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

app.MapPost("/api/jobs", async (
    CreateJobRequest request,
    HttpContext httpContext,
    IOptions<ClientApiOptions> clientApi,
    PostgresJobQueue jobs,
    CancellationToken ct) =>
{
    if (AuthorizeAccountScope(httpContext, clientApi.Value, request) is { } denied)
    {
        return denied;
    }

    var job = await jobs.CreateJobAsync(request, ct);
    return Results.Ok(job);
});

app.MapGet("/api/jobs", async (
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
        ? AuthorizeAccountId(httpContext, clientApi.Value, parsedAccountId)
        : AuthorizeAccountScope(httpContext, clientApi.Value, new AccountScope
        {
            AccountOwnerType = normalizedOwnerType,
            AccountOwnerId = normalizedOwnerId,
        });

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

app.MapGet("/api/jobs/{jobId:guid}", async (
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

    if (AuthorizeAccountRow(httpContext, clientApi.Value, job) is { } denied)
    {
        return denied;
    }

    return Results.Ok(job);
});

app.MapPost("/api/jobs/{jobId:guid}/cancel", async (
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

    if (AuthorizeAccountRow(httpContext, clientApi.Value, existing) is { } denied)
    {
        return denied;
    }

    var job = await jobs.CancelAsync(jobId, request, ct);
    return job is null ? Results.NotFound() : Results.Ok(job);
});

app.MapGet("/api/wallet", async (
    string? accountOwnerType,
    string? accountOwnerId,
    HttpContext httpContext,
    IOptions<ClientApiOptions> clientApi,
    PostgresWalletStore wallets,
    CancellationToken ct) =>
{
    var scope = ResolvePublicOwnerScope(httpContext, accountOwnerType, accountOwnerId);
    if (AuthorizeAccountScope(httpContext, clientApi.Value, scope) is { } denied)
    {
        return denied;
    }

    var wallet = await wallets.GetWalletByOwnerAsync(scope.AccountOwnerType, scope.AccountOwnerId, ct);
    return wallet is null
        ? Results.NotFound(new { error = "wallet not found" })
        : Results.Ok(wallet);
});

app.MapGet("/api/wallets", async (
    string? accountOwnerType,
    string? accountOwnerId,
    HttpContext httpContext,
    IOptions<ClientApiOptions> clientApi,
    PostgresWalletStore wallets,
    CancellationToken ct) =>
{
    var scope = ResolvePublicOwnerScope(httpContext, accountOwnerType, accountOwnerId);
    if (AuthorizeAccountScope(httpContext, clientApi.Value, scope) is { } denied)
    {
        return denied;
    }

    return Results.Ok(new
    {
        items = await wallets.ListWalletsByOwnerAsync(scope.AccountOwnerType, scope.AccountOwnerId, 20, ct),
    });
});

app.MapGet("/api/wallets/{walletId:guid}/ledger", async (
    Guid walletId,
    int? limit,
    HttpContext httpContext,
    IOptions<ClientApiOptions> clientApi,
    PostgresWalletStore wallets,
    CancellationToken ct) =>
{
    var wallet = await wallets.GetWalletByAccountIdAsync(walletId, ct);
    if (wallet is null)
    {
        return Results.NotFound(new { error = "wallet not found" });
    }

    if (AuthorizeAccountRow(httpContext, clientApi.Value, wallet) is { } denied)
    {
        return denied;
    }

    return Results.Ok(new
    {
        items = await wallets.ListLedgerAsync(walletId, limit ?? 50, ct),
    });
});

app.MapGet("/api/wallet/usage-stats", async (
    string? mode,
    string? accountOwnerType,
    string? accountOwnerId,
    HttpContext httpContext,
    IOptions<ClientApiOptions> clientApi,
    PostgresWalletStore wallets,
    CancellationToken ct) =>
{
    var scope = ResolvePublicOwnerScope(httpContext, accountOwnerType, accountOwnerId, mode);
    if (AuthorizeAccountScope(httpContext, clientApi.Value, scope) is { } denied)
    {
        return denied;
    }

    return Results.Ok(await wallets.GetUsageStatsAsync(
        scope.AccountOwnerType,
        scope.AccountOwnerId,
        mode,
        ct));
});

app.MapPost("/api/internal/jobs/lease", async (
    LeaseJobsRequest request,
    PostgresJobQueue jobs,
    CancellationToken ct) =>
{
    return Results.Ok(await jobs.LeaseJobsAsync(request, ct));
});

app.MapPost("/api/internal/jobs/{jobId:guid}/running", async (
    Guid jobId,
    MarkJobRunningRequest request,
    PostgresJobQueue jobs,
    CancellationToken ct) =>
{
    var job = await jobs.MarkRunningAsync(jobId, request.WorkerId, ct);
    return job is null ? Results.NotFound() : Results.Ok(job);
});

app.MapPost("/api/internal/jobs/{jobId:guid}/heartbeat", async (
    Guid jobId,
    JobHeartbeatRequest request,
    PostgresJobQueue jobs,
    CancellationToken ct) =>
{
    var job = await jobs.HeartbeatAsync(jobId, request.WorkerId ?? "", request.LeaseSeconds, ct);
    return job is null ? Results.NotFound() : Results.Ok(job);
});

app.MapPost("/api/internal/jobs/recover-expired", async (
    PostgresJobQueue jobs,
    CancellationToken ct) =>
{
    return await HandleRecoverExpiredJobsAsync(jobs, ct);
});

app.MapPost("/api/internal/jobs/recover-expired-leases", async (
    PostgresJobQueue jobs,
    CancellationToken ct) =>
{
    return await HandleRecoverExpiredJobsAsync(jobs, ct);
});

app.MapGet("/api/internal/jobs/{jobId:guid}/attempts", async (
    Guid jobId,
    PostgresJobQueue jobs,
    CancellationToken ct) =>
{
    return Results.Ok(await jobs.ListAttemptsAsync(jobId, ct));
});

app.MapPost("/api/internal/jobs/{jobId:guid}/succeed", async (
    Guid jobId,
    CompleteJobRequest request,
    PostgresJobQueue jobs,
    CancellationToken ct) =>
{
    return await HandleJobSucceedAsync(jobId, request, jobs, ct);
});

app.MapPost("/api/internal/jobs/{jobId:guid}/succeeded", async (
    Guid jobId,
    CompleteJobRequest request,
    PostgresJobQueue jobs,
    CancellationToken ct) =>
{
    return await HandleJobSucceedAsync(jobId, request, jobs, ct);
});

app.MapPost("/api/internal/jobs/{jobId:guid}/fail", async (
    Guid jobId,
    FailJobRequest request,
    PostgresJobQueue jobs,
    CancellationToken ct) =>
{
    return await HandleJobFailAsync(jobId, request, jobs, ct);
});

app.MapPost("/api/internal/jobs/{jobId:guid}/failed", async (
    Guid jobId,
    FailJobRequest request,
    PostgresJobQueue jobs,
    CancellationToken ct) =>
{
    return await HandleJobFailAsync(jobId, request, jobs, ct);
});

app.MapGet("/api/internal/jobs/wait-signal", async (
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

app.MapPost("/api/payments/callbacks/{provider}", async (
    string provider,
    HttpRequest http,
    IOptions<PaymentCallbackOptions> paymentCallbackOptions,
    PostgresPaymentLedger ledger,
    IPaymentSignatureVerifier verifier,
    CancellationToken ct) =>
{
    return await HandlePaymentCallbackAsync(
        provider,
        http,
        paymentCallbackOptions.Value,
        ledger,
        verifier,
        jsonOptions,
        ct);
});

app.MapPost("/api/payments/alipay/notify", async (
    HttpRequest http,
    IOptions<PaymentCallbackOptions> paymentCallbackOptions,
    PostgresPaymentLedger ledger,
    IPaymentSignatureVerifier verifier,
    CancellationToken ct) =>
{
    return await HandlePaymentCallbackAsync(
        "alipay",
        http,
        paymentCallbackOptions.Value,
        ledger,
        verifier,
        jsonOptions,
        ct);
});

app.MapPost("/api/payments/wechat/notify", async (
    HttpRequest http,
    IOptions<PaymentCallbackOptions> paymentCallbackOptions,
    PostgresPaymentLedger ledger,
    IPaymentSignatureVerifier verifier,
    CancellationToken ct) =>
{
    return await HandlePaymentCallbackAsync(
        "wechat",
        http,
        paymentCallbackOptions.Value,
        ledger,
        verifier,
        jsonOptions,
        ct);
});

app.MapPost("/api/media/upload-begin", async (
    UploadBeginRequest request,
    HttpContext httpContext,
    IOptions<ClientApiOptions> clientApi,
    PostgresMediaStore media,
    CancellationToken ct) =>
{
    if (AuthorizeAccountScope(httpContext, clientApi.Value, request) is { } denied)
    {
        return denied;
    }

    return Results.Ok(await media.BeginUploadAsync(request, ct));
});

app.MapPost("/api/media/upload-complete", async (
    UploadCompleteRequest request,
    HttpContext httpContext,
    IOptions<ClientApiOptions> clientApi,
    PostgresMediaStore media,
    CancellationToken ct) =>
{
    if (AuthorizeAccountScope(httpContext, clientApi.Value, request) is { } denied)
    {
        return denied;
    }

    var result = await media.CompleteUploadAsync(request, ct);
    return result is null ? Results.NotFound() : Results.Ok(result);
});

app.MapPost("/api/media/signed-read-url", async (
    SignedReadUrlRequest request,
    HttpContext httpContext,
    IOptions<ClientApiOptions> clientApi,
    PostgresMediaStore media,
    CancellationToken ct) =>
{
    if (AuthorizeAccountScope(httpContext, clientApi.Value, request) is { } denied)
    {
        return denied;
    }

    var result = await media.GetSignedReadUrlAsync(request, ct);
    return result is null ? Results.NotFound() : Results.Ok(result);
});

app.MapPost("/api/media/move-temp-to-permanent", async (
    MoveTempToPermanentRequest request,
    HttpContext httpContext,
    IOptions<ClientApiOptions> clientApi,
    PostgresMediaStore media,
    CancellationToken ct) =>
{
    if (AuthorizeAccountScope(httpContext, clientApi.Value, request) is { } denied)
    {
        return denied;
    }

    var result = await media.MoveTempToPermanentAsync(request, ct);
    return result is null ? Results.NotFound() : Results.Ok(result);
});

app.MapGet("/api/projects", async (
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

app.MapPost("/api/projects", async (
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

app.MapGet("/api/projects/{projectId}", async (
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

app.MapPut("/api/projects/{projectId}", async (
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

app.MapGet("/api/projects/{projectId}/overview", async (
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

app.MapGet("/api/projects/{projectId}/settings", async (
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

app.MapPut("/api/projects/{projectId}/settings", async (
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

app.MapGet("/api/projects/{projectId}/script", async (
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

app.MapPut("/api/projects/{projectId}/script", async (
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

app.MapGet("/api/projects/{projectId}/timeline", async (
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

app.MapPut("/api/projects/{projectId}/timeline", async (
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

app.MapGet("/api/canvas-projects", async (
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

app.MapGet("/api/canvas-projects/{projectId}", async (
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

app.MapPost("/api/canvas-projects", async (
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

app.MapPut("/api/canvas-projects/{projectId}", async (
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

app.MapDelete("/api/canvas-projects/{projectId}", async (
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

app.MapGet("/api/agent-canvas/projects", async (
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

app.MapGet("/api/agent-canvas/projects/{projectId}", async (
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

app.MapPost("/api/agent-canvas/projects", async (
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

app.MapPut("/api/agent-canvas/projects/{projectId}", async (
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

app.MapDelete("/api/agent-canvas/projects/{projectId}", async (
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

app.MapGet("/api/create/images", async (
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

app.MapGet("/api/create/videos", async (
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

app.MapDelete("/api/create/images/{imageId}", async (
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

app.MapDelete("/api/create/videos/{videoId}", async (
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

app.MapGet("/api/providers/health", async (
    PostgresProviderHealthStore providers,
    CancellationToken ct) =>
{
    return Results.Ok(await providers.ListAsync(ct));
});

app.MapPut("/api/providers/health", async (
    ProviderHealthRequest request,
    PostgresProviderHealthStore providers,
    CancellationToken ct) =>
{
    return Results.Ok(await providers.UpsertAsync(request, ct));
});

app.MapPost("/api/internal/outbox/lease", async (
    OutboxLeaseRequest request,
    PostgresOutboxStore outbox,
    CancellationToken ct) =>
{
    return Results.Ok(await outbox.LeaseAsync(request, ct));
});

app.MapPost("/api/internal/outbox/{eventId:guid}/complete", async (
    Guid eventId,
    OutboxCompleteRequest request,
    PostgresOutboxStore outbox,
    CancellationToken ct) =>
{
    var result = await outbox.CompleteAsync(eventId, request, ct);
    return result is null ? Results.NotFound() : Results.Ok(result);
});

app.Run();

static string JsonbFrom(JsonElement element)
{
    return element.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null
        ? "{}"
        : element.GetRawText();
}

static async Task<IResult> HandleRecoverExpiredJobsAsync(
    PostgresJobQueue jobs,
    CancellationToken ct)
{
    return Results.Ok(await jobs.RecoverExpiredLeasesAsync(ct));
}

static async Task<IResult> HandleJobSucceedAsync(
    Guid jobId,
    CompleteJobRequest request,
    PostgresJobQueue jobs,
    CancellationToken ct)
{
    var job = await jobs.SucceedAsync(jobId, JsonbFrom(request.Result), ct);
    return job is null ? Results.NotFound() : Results.Ok(job);
}

static async Task<IResult> HandleJobFailAsync(
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

static async Task<IResult> HandlePaymentCallbackAsync(
    string provider,
    HttpRequest http,
    PaymentCallbackOptions paymentCallbackOptions,
    PostgresPaymentLedger ledger,
    IPaymentSignatureVerifier verifier,
    JsonSerializerOptions jsonOptions,
    CancellationToken ct)
{
    using var reader = new StreamReader(http.Body, Encoding.UTF8);
    var rawBody = await reader.ReadToEndAsync(ct);
    PaymentCallbackRequest callback;
    try
    {
        callback = JsonSerializer.Deserialize<PaymentCallbackRequest>(rawBody, jsonOptions)
            ?? new PaymentCallbackRequest();
    }
    catch (JsonException)
    {
        return Results.BadRequest(new
        {
            error = "payment callback body must be normalized JSON before ledger processing",
            provider = NormalizePaymentProvider(provider) ?? provider,
        });
    }

    if (ValidatePaymentCallbackProviderBoundary(
        provider,
        callback,
        paymentCallbackOptions,
        out var normalizedProvider) is { } denied)
    {
        return denied;
    }

    var signature = http.Headers["X-XiaoLou-Signature"].FirstOrDefault() ?? callback.Signature;
    var signatureValid = verifier.Verify(normalizedProvider, rawBody, signature);
    var result = await ledger.ProcessCallbackAsync(callback with
    {
        Provider = normalizedProvider,
        SignatureValid = signatureValid,
        RawBody = rawBody,
    }, ct);

    return signatureValid && !IsRejected(result)
        ? Results.Ok(result)
        : Results.BadRequest(result);
}

static bool IsRejected(Dictionary<string, object?> result)
{
    return result.TryGetValue("processed", out var processed)
        && processed is bool processedValue
        && !processedValue
        && result.ContainsKey("error");
}

static IResult? ValidatePaymentCallbackProviderBoundary(
    string routeProvider,
    PaymentCallbackRequest callback,
    PaymentCallbackOptions options,
    out string normalizedProvider)
{
    normalizedProvider = NormalizePaymentProvider(routeProvider) ?? "";
    if (string.IsNullOrWhiteSpace(normalizedProvider))
    {
        return Results.BadRequest(new
        {
            error = "payment callback provider is invalid",
        });
    }

    var rawBodyProvider = NormalizeBlank(callback.Provider);
    if (rawBodyProvider is not null)
    {
        var bodyProvider = NormalizePaymentProvider(rawBodyProvider);
        if (bodyProvider is null)
        {
            return Results.BadRequest(new
            {
                error = "payment callback body provider is invalid",
            });
        }

        if (!string.Equals(bodyProvider, normalizedProvider, StringComparison.Ordinal))
        {
            return Results.BadRequest(new
            {
                error = "payment callback provider mismatch",
                routeProvider = normalizedProvider,
                bodyProvider,
            });
        }
    }

    if (!IsPaymentCallbackProviderAllowed(normalizedProvider, options))
    {
        return Results.Json(new
        {
            error = "payment callback provider is not enabled",
            provider = normalizedProvider,
        }, statusCode: StatusCodes.Status403Forbidden);
    }

    if (!IsPaymentCallbackAccountAllowed(callback, options))
    {
        return Results.Json(new
        {
            error = "payment callback account is not enabled",
            accountId = NormalizeGuidText(callback.AccountId),
            accountOwnerType = NormalizeOwnerType(callback.AccountOwnerType) ?? "user",
            accountOwnerId = NormalizeBlank(callback.AccountOwnerId),
        }, statusCode: StatusCodes.Status403Forbidden);
    }

    return null;
}

static bool IsPaymentCallbackProviderAllowed(string provider, PaymentCallbackOptions options)
{
    var allowedProviders = GetConfiguredPaymentCallbackAllowedProviders(options);
    if (string.IsNullOrWhiteSpace(allowedProviders))
    {
        return !ShouldRequirePaymentCallbackAllowedProvider(options);
    }

    return ContainsCsvGrant(allowedProviders, provider);
}

static string? GetConfiguredPaymentCallbackAllowedProviders(PaymentCallbackOptions options)
{
    return string.IsNullOrWhiteSpace(options.AllowedProviders)
        ? Environment.GetEnvironmentVariable("PAYMENT_CALLBACK_ALLOWED_PROVIDERS")
        : options.AllowedProviders;
}

static bool ShouldRequirePaymentCallbackAllowedProvider(PaymentCallbackOptions options)
{
    return ReadBoolOption("PAYMENT_CALLBACK_REQUIRE_ALLOWED_PROVIDER", options.RequireAllowedProvider);
}

static bool IsPaymentCallbackAccountAllowed(PaymentCallbackRequest callback, PaymentCallbackOptions options)
{
    var allowedAccountIds = GetConfiguredPaymentCallbackAllowedAccountIds(options);
    var allowedOwnerIds = GetConfiguredPaymentCallbackAllowedAccountOwnerIds(options);
    var hasConfiguredGrant = !string.IsNullOrWhiteSpace(allowedAccountIds)
        || !string.IsNullOrWhiteSpace(allowedOwnerIds);
    if (!hasConfiguredGrant)
    {
        return !ShouldRequirePaymentCallbackAccountGrant(options);
    }

    var accountId = NormalizeGuidText(callback.AccountId);
    if (accountId is not null && ContainsCsvGrant(allowedAccountIds, accountId))
    {
        return true;
    }

    var ownerType = NormalizeOwnerType(callback.AccountOwnerType) ?? "user";
    var ownerId = NormalizeBlank(callback.AccountOwnerId);
    return ownerId is not null
        && (ContainsCsvGrant(allowedOwnerIds, ownerId)
            || ContainsCsvGrant(allowedOwnerIds, $"{ownerType}:{ownerId}")
            || ContainsCsvGrant(allowedOwnerIds, $"{ownerType}:*"));
}

static string? GetConfiguredPaymentCallbackAllowedAccountIds(PaymentCallbackOptions options)
{
    return string.IsNullOrWhiteSpace(options.AllowedAccountIds)
        ? Environment.GetEnvironmentVariable("PAYMENT_CALLBACK_ALLOWED_ACCOUNT_IDS")
        : options.AllowedAccountIds;
}

static string? GetConfiguredPaymentCallbackAllowedAccountOwnerIds(PaymentCallbackOptions options)
{
    return string.IsNullOrWhiteSpace(options.AllowedAccountOwnerIds)
        ? Environment.GetEnvironmentVariable("PAYMENT_CALLBACK_ALLOWED_ACCOUNT_OWNER_IDS")
        : options.AllowedAccountOwnerIds;
}

static bool ShouldRequirePaymentCallbackAccountGrant(PaymentCallbackOptions options)
{
    return ReadBoolOption("PAYMENT_CALLBACK_REQUIRE_ACCOUNT_GRANT", options.RequireAccountGrant);
}

static bool IsInternalRequestAllowed(HttpContext context, InternalApiOptions options)
{
    var configuredToken = string.IsNullOrWhiteSpace(options.Token)
        ? Environment.GetEnvironmentVariable("INTERNAL_API_TOKEN")
        : options.Token;
    var expectedToken = string.IsNullOrWhiteSpace(configuredToken) ? null : configuredToken.Trim();
    if (expectedToken is not null)
    {
        var supplied = context.Request.Headers["X-XiaoLou-Internal-Token"].FirstOrDefault();
        return !string.IsNullOrWhiteSpace(supplied) && FixedTimeEquals(expectedToken, supplied.Trim());
    }

    if (HasExternalForwardedAddress(context))
    {
        return false;
    }

    var remoteIp = context.Connection.RemoteIpAddress;
    return remoteIp is null || IPAddress.IsLoopback(remoteIp);
}

static bool IsOperationalRequest(HttpContext context)
{
    return context.Request.Path.StartsWithSegments("/api/schema")
        || context.Request.Path.StartsWithSegments("/api/providers/health")
        || context.Request.Path.StartsWithSegments("/metrics");
}

static bool IsPublicClientApiRequest(HttpContext context)
{
    var path = context.Request.Path;
    return path.StartsWithSegments("/api/accounts/ensure")
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

static AccountScope ResolvePublicOwnerScope(
    HttpContext context,
    string? accountOwnerType,
    string? accountOwnerId,
    string? mode = null)
{
    var ownerType = NormalizeOwnerType(accountOwnerType)
        ?? (string.Equals(mode, "organization", StringComparison.OrdinalIgnoreCase) ? "organization" : "user");
    var ownerId = NormalizeBlank(accountOwnerId)
        ?? NormalizeBlank(ReadHeader(context, "X-Actor-Id"))
        ?? NormalizeBlank(GetClientPrincipal(context)?.Subject)
        ?? "guest";

    return new AccountScope
    {
        AccountOwnerType = ownerType,
        AccountOwnerId = ownerId,
        RegionCode = "CN",
        Currency = "CNY",
    };
}

static IResult? AuthorizeAccountScope(HttpContext context, ClientApiOptions options, AccountScope scope)
{
    if (!IsClientAuthModeEnabled(options) || !ShouldRequireAccountScope(options))
    {
        return null;
    }

    var accountId = NormalizeBlank(scope.AccountId);
    var ownerType = NormalizeOwnerType(scope.AccountOwnerType);
    var ownerId = NormalizeBlank(scope.AccountOwnerId);
    return IsAccountScopeAllowed(context, options, accountId, ownerType, ownerId)
        ? null
        : AccountForbidden();
}

static IResult? AuthorizeAccountId(HttpContext context, ClientApiOptions options, Guid? accountId)
{
    if (!IsClientAuthModeEnabled(options) || !ShouldRequireAccountScope(options))
    {
        return null;
    }

    return accountId is not null
        && IsAccountScopeAllowed(context, options, accountId.Value.ToString("D"), null, null)
        ? null
        : AccountForbidden();
}

static IResult? AuthorizeAccountRow(
    HttpContext context,
    ClientApiOptions options,
    Dictionary<string, object?> row)
{
    if (!IsClientAuthModeEnabled(options) || !ShouldRequireAccountScope(options))
    {
        return null;
    }

    var ownerType = TryReadRowString(row, "account_owner_type") ?? "user";
    var ownerId = TryReadRowString(row, "account_owner_id");
    return TryReadAccountId(row, out var accountId)
        && IsAccountScopeAllowed(context, options, accountId.ToString("D"), ownerType, ownerId)
        ? null
        : AccountForbidden();
}

static IResult AccountForbidden()
{
    return Results.Json(new
    {
        error = "account scope is not authorized for this client token",
    }, statusCode: StatusCodes.Status403Forbidden);
}

static ClientAuthenticationResult AuthenticateClientRequest(HttpContext context, ClientApiOptions options)
{
    var authProviderEnabled = IsClientAuthProviderEnabled(options);
    var authProviderRequired = ShouldRequireAuthProvider(options);
    if (authProviderEnabled && ReadAuthorizationBearerToken(context) is { } bearerToken)
    {
        if (TryValidateClientAuthProviderToken(options, bearerToken, out var providerPrincipal))
        {
            return ClientAuthenticationResult.Allowed(providerPrincipal);
        }

        if (authProviderRequired)
        {
            return ClientAuthenticationResult.Unauthorized("client auth provider token is required or invalid");
        }
    }

    if (authProviderRequired)
    {
        return ClientAuthenticationResult.Unauthorized("client auth provider token is required or invalid");
    }

    var expectedToken = GetConfiguredClientToken(options);
    if (expectedToken is not null)
    {
        var supplied = ReadClientToken(context, options);
        return supplied is not null && FixedTimeEquals(expectedToken, supplied)
            ? ClientAuthenticationResult.Allowed(ClientPrincipal.ForStaticToken(
                GetConfiguredAllowedAccountIds(options),
                GetConfiguredAllowedAccountOwnerIds(options),
                GetConfiguredAllowedPermissions(options)))
            : ClientAuthenticationResult.Unauthorized("client API token is required or invalid");
    }

    if (authProviderEnabled)
    {
        return ClientAuthenticationResult.Unauthorized("client auth provider token is required or invalid");
    }

    if (HasExternalForwardedAddress(context))
    {
        return ClientAuthenticationResult.Forbidden("client API is not available from this request context");
    }

    var remoteIp = context.Connection.RemoteIpAddress;
    return remoteIp is null || IPAddress.IsLoopback(remoteIp)
        ? ClientAuthenticationResult.Allowed(null)
        : ClientAuthenticationResult.Forbidden("client API is not available from this request context");
}

static bool IsClientPermissionAllowed(HttpContext context, ClientApiOptions options)
{
    if (!IsClientAuthModeEnabled(options))
    {
        return true;
    }

    var requiredPermission = GetRequiredClientPermission(context);
    if (requiredPermission is null)
    {
        return false;
    }

    var principal = GetClientPrincipal(context);
    if (principal?.FromAuthProvider == true)
    {
        if (!ContainsCsvGrant(principal.AllowedPermissions, requiredPermission))
        {
            return false;
        }

        var configuredPermissions = GetConfiguredAllowedPermissions(options);
        return string.IsNullOrWhiteSpace(configuredPermissions)
            || ContainsCsvGrant(configuredPermissions, requiredPermission);
    }

    var allowedPermissions = principal?.AllowedPermissions ?? GetConfiguredAllowedPermissions(options);
    return string.IsNullOrWhiteSpace(allowedPermissions)
        || ContainsCsvGrant(allowedPermissions, requiredPermission);
}

static string? GetRequiredClientPermission(HttpContext context)
{
    var path = context.Request.Path;
    var method = context.Request.Method;

    if (HttpMethods.IsPost(method)
        && string.Equals(path.Value, "/api/accounts/ensure", StringComparison.OrdinalIgnoreCase))
    {
        return "accounts:ensure";
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

static bool IsClientAuthModeEnabled(ClientApiOptions options)
{
    return GetConfiguredClientToken(options) is not null
        || IsClientAuthProviderEnabled(options);
}

static bool IsClientAuthProviderEnabled(ClientApiOptions options)
{
    return string.Equals(GetConfiguredClientAuthProvider(options), "hs256-jwt", StringComparison.OrdinalIgnoreCase);
}

static string? GetConfiguredClientAuthProvider(ClientApiOptions options)
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

static string? GetConfiguredClientToken(ClientApiOptions options)
{
    var configuredToken = string.IsNullOrWhiteSpace(options.Token)
        ? Environment.GetEnvironmentVariable("CLIENT_API_TOKEN")
        : options.Token;
    var expectedToken = string.IsNullOrWhiteSpace(configuredToken) ? null : configuredToken.Trim();
    return expectedToken;
}

static string GetConfiguredClientTokenHeader(ClientApiOptions options)
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

static bool ShouldRequireAccountScope(ClientApiOptions options)
{
    return ReadBoolOption("CLIENT_API_REQUIRE_ACCOUNT_SCOPE", options.RequireAccountScope);
}

static bool ShouldRequireConfiguredAccountGrant(ClientApiOptions options)
{
    return ReadBoolOption("CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT", options.RequireConfiguredAccountGrant);
}

static bool ShouldRequireAuthProvider(ClientApiOptions options)
{
    return ReadBoolOption("CLIENT_API_REQUIRE_AUTH_PROVIDER", options.RequireAuthProvider);
}

static bool ReadBoolOption(string envName, bool configuredDefault)
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

static string? ReadClientToken(HttpContext context, ClientApiOptions options)
{
    var headerName = GetConfiguredClientTokenHeader(options);
    var headerValue = ReadHeader(context, headerName);
    if (!string.IsNullOrWhiteSpace(headerValue))
    {
        return headerValue.Trim();
    }

    var authorization = ReadHeader(context, "Authorization");
    const string bearerPrefix = "Bearer ";
    return authorization is not null && authorization.StartsWith(bearerPrefix, StringComparison.OrdinalIgnoreCase)
        ? authorization[bearerPrefix.Length..].Trim()
        : null;
}

static string? ReadAuthorizationBearerToken(HttpContext context)
{
    var authorization = ReadHeader(context, "Authorization");
    const string bearerPrefix = "Bearer ";
    return authorization is not null && authorization.StartsWith(bearerPrefix, StringComparison.OrdinalIgnoreCase)
        ? authorization[bearerPrefix.Length..].Trim()
        : null;
}

static bool IsAccountScopeAllowed(
    HttpContext context,
    ClientApiOptions options,
    string? accountId,
    string? ownerType,
    string? ownerId)
{
    var headerAccountId = NormalizeGuidText(ReadHeader(context, "X-XiaoLou-Account-Id"));
    var normalizedAccountId = NormalizeGuidText(accountId);
    var headerOwnerId = NormalizeBlank(ReadHeader(context, "X-XiaoLou-Account-Owner-Id"));
    var headerOwnerType = NormalizeOwnerType(ReadHeader(context, "X-XiaoLou-Account-Owner-Type"));
    var normalizedOwnerType = ownerType ?? "user";
    var principal = GetClientPrincipal(context);
    if (principal?.FromAuthProvider == true)
    {
        if (!IsPrincipalAccountGrantAllowed(principal, normalizedAccountId, normalizedOwnerType, ownerId))
        {
            return false;
        }

        return !ShouldRequireConfiguredAccountGrant(options)
            || IsConfiguredAccountGrantAllowed(options, normalizedAccountId, normalizedOwnerType, ownerId);
    }

    var configuredGrantAllowed = IsConfiguredAccountGrantAllowed(options, normalizedAccountId, normalizedOwnerType, ownerId);
    if (ShouldRequireConfiguredAccountGrant(options))
    {
        return configuredGrantAllowed;
    }

    if (headerAccountId is not null && normalizedAccountId is not null)
    {
        return string.Equals(headerAccountId, normalizedAccountId, StringComparison.OrdinalIgnoreCase);
    }

    if (configuredGrantAllowed)
    {
        return true;
    }

    if (headerOwnerId is not null && ownerId is not null)
    {
        return string.Equals(headerOwnerId, ownerId, StringComparison.Ordinal)
            && (ownerType is null || headerOwnerType is null || string.Equals(headerOwnerType, ownerType, StringComparison.Ordinal));
    }

    return false;
}

static bool IsPrincipalAccountGrantAllowed(
    ClientPrincipal principal,
    string? accountId,
    string ownerType,
    string? ownerId)
{
    if (accountId is not null && ContainsCsvGrant(principal.AllowedAccountIds, accountId))
    {
        return true;
    }

    if (ownerId is not null
        && (ContainsCsvGrant(principal.AllowedAccountOwnerIds, ownerId)
            || ContainsCsvGrant(principal.AllowedAccountOwnerIds, $"{ownerType}:{ownerId}")
            || ContainsCsvGrant(principal.AllowedAccountOwnerIds, $"{ownerType}:*")))
    {
        return true;
    }

    return false;
}

static bool IsConfiguredAccountGrantAllowed(
    ClientApiOptions options,
    string? accountId,
    string ownerType,
    string? ownerId)
{
    if (accountId is not null && ContainsCsvGrant(GetConfiguredAllowedAccountIds(options), accountId))
    {
        return true;
    }

    var allowedOwnerIds = GetConfiguredAllowedAccountOwnerIds(options);
    if (ownerId is not null
        && (ContainsCsvGrant(allowedOwnerIds, ownerId)
            || ContainsCsvGrant(allowedOwnerIds, $"{ownerType}:{ownerId}")
            || ContainsCsvGrant(allowedOwnerIds, $"{ownerType}:*")))
    {
        return true;
    }

    return false;
}

static string? GetConfiguredAllowedAccountIds(ClientApiOptions options)
{
    return string.IsNullOrWhiteSpace(options.AllowedAccountIds)
        ? Environment.GetEnvironmentVariable("CLIENT_API_ALLOWED_ACCOUNT_IDS")
        : options.AllowedAccountIds;
}

static string? GetConfiguredAllowedAccountOwnerIds(ClientApiOptions options)
{
    return string.IsNullOrWhiteSpace(options.AllowedAccountOwnerIds)
        ? Environment.GetEnvironmentVariable("CLIENT_API_ALLOWED_ACCOUNT_OWNER_IDS")
        : options.AllowedAccountOwnerIds;
}

static string? GetConfiguredAllowedPermissions(ClientApiOptions options)
{
    return string.IsNullOrWhiteSpace(options.AllowedPermissions)
        ? Environment.GetEnvironmentVariable("CLIENT_API_ALLOWED_PERMISSIONS")
        : options.AllowedPermissions;
}

static string? GetConfiguredClientAuthProviderSecret(ClientApiOptions options)
{
    return string.IsNullOrWhiteSpace(options.AuthProviderSecret)
        ? Environment.GetEnvironmentVariable("CLIENT_API_AUTH_PROVIDER_SECRET")
        : options.AuthProviderSecret;
}

static string? GetConfiguredClientAuthProviderIssuer(ClientApiOptions options)
{
    return string.IsNullOrWhiteSpace(options.AuthProviderIssuer)
        ? Environment.GetEnvironmentVariable("CLIENT_API_AUTH_PROVIDER_ISSUER")
        : options.AuthProviderIssuer;
}

static string? GetConfiguredClientAuthProviderAudience(ClientApiOptions options)
{
    return string.IsNullOrWhiteSpace(options.AuthProviderAudience)
        ? Environment.GetEnvironmentVariable("CLIENT_API_AUTH_PROVIDER_AUDIENCE")
        : options.AuthProviderAudience;
}

static int GetClientAuthProviderClockSkewSeconds(ClientApiOptions options)
{
    var raw = Environment.GetEnvironmentVariable("CLIENT_API_AUTH_PROVIDER_CLOCK_SKEW_SECONDS");
    if (int.TryParse(raw, out var envValue))
    {
        return Math.Clamp(envValue, 0, 300);
    }

    return Math.Clamp(options.AuthProviderClockSkewSeconds, 0, 300);
}

static bool TryValidateClientAuthProviderToken(
    ClientApiOptions options,
    string token,
    out ClientPrincipal? principal)
{
    principal = null;
    var secret = GetConfiguredClientAuthProviderSecret(options);
    if (string.IsNullOrWhiteSpace(secret))
    {
        return false;
    }

    var parts = token.Split('.');
    if (parts.Length != 3 || parts.Any(string.IsNullOrWhiteSpace))
    {
        return false;
    }

    byte[] headerBytes;
    byte[] payloadBytes;
    byte[] signatureBytes;
    try
    {
        headerBytes = DecodeBase64Url(parts[0]);
        payloadBytes = DecodeBase64Url(parts[1]);
        signatureBytes = DecodeBase64Url(parts[2]);
    }
    catch (FormatException)
    {
        return false;
    }

    using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret.Trim()));
    var expectedSignature = hmac.ComputeHash(Encoding.ASCII.GetBytes($"{parts[0]}.{parts[1]}"));
    if (signatureBytes.Length != expectedSignature.Length
        || !CryptographicOperations.FixedTimeEquals(signatureBytes, expectedSignature))
    {
        return false;
    }

    try
    {
        using var headerJson = JsonDocument.Parse(headerBytes);
        if (!headerJson.RootElement.TryGetProperty("alg", out var alg)
            || !string.Equals(alg.GetString(), "HS256", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        using var payloadJson = JsonDocument.Parse(payloadBytes);
        var payload = payloadJson.RootElement;
        if (!IsClientAuthProviderIssuerAllowed(options, payload)
            || !IsClientAuthProviderAudienceAllowed(options, payload)
            || !IsClientAuthProviderTimeWindowAllowed(options, payload))
        {
            return false;
        }

        var subject = ReadStringClaim(payload, "sub");
        var ownerType = ReadStringClaim(payload, "xiaolou_account_owner_type") ?? "user";
        var accountOwnerIds = ReadClaimGrantList(
            payload,
            "xiaolou_account_owner_ids",
            "account_owner_ids",
            "owner_ids",
            "owner_id");
        if (!string.IsNullOrWhiteSpace(subject))
        {
            accountOwnerIds = JoinGrantLists(accountOwnerIds, subject, $"{ownerType}:{subject}");
        }

        principal = new ClientPrincipal(
            Subject: subject,
            FromAuthProvider: true,
            AllowedAccountIds: ReadClaimGrantList(payload, "xiaolou_account_ids", "account_ids", "account_id"),
            AllowedAccountOwnerIds: accountOwnerIds,
            AllowedPermissions: ReadClaimGrantList(payload, "xiaolou_permissions", "permissions", "scope", "scp"));
        return true;
    }
    catch (JsonException)
    {
        return false;
    }
}

static bool IsClientAuthProviderIssuerAllowed(ClientApiOptions options, JsonElement payload)
{
    var configuredIssuer = NormalizeBlank(GetConfiguredClientAuthProviderIssuer(options));
    if (configuredIssuer is null)
    {
        return true;
    }

    return string.Equals(ReadStringClaim(payload, "iss"), configuredIssuer, StringComparison.Ordinal);
}

static bool IsClientAuthProviderAudienceAllowed(ClientApiOptions options, JsonElement payload)
{
    var configuredAudience = NormalizeBlank(GetConfiguredClientAuthProviderAudience(options));
    if (configuredAudience is null)
    {
        return true;
    }

    if (!payload.TryGetProperty("aud", out var aud))
    {
        return false;
    }

    if (aud.ValueKind == JsonValueKind.String)
    {
        return string.Equals(aud.GetString(), configuredAudience, StringComparison.Ordinal);
    }

    if (aud.ValueKind == JsonValueKind.Array)
    {
        foreach (var item in aud.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.String
                && string.Equals(item.GetString(), configuredAudience, StringComparison.Ordinal))
            {
                return true;
            }
        }
    }

    return false;
}

static bool IsClientAuthProviderTimeWindowAllowed(ClientApiOptions options, JsonElement payload)
{
    if (!payload.TryGetProperty("exp", out var exp) || !TryReadUnixSeconds(exp, out var expiresAt))
    {
        return false;
    }

    var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
    var skew = GetClientAuthProviderClockSkewSeconds(options);
    if (now - skew > expiresAt)
    {
        return false;
    }

    if (!payload.TryGetProperty("nbf", out var nbf))
    {
        return true;
    }

    return TryReadUnixSeconds(nbf, out var notBefore)
        && now + skew >= notBefore;
}

static bool TryReadUnixSeconds(JsonElement element, out long value)
{
    value = 0;
    return element.ValueKind switch
    {
        JsonValueKind.Number => element.TryGetInt64(out value),
        JsonValueKind.String => long.TryParse(element.GetString(), out value),
        _ => false,
    };
}

static string? ReadStringClaim(JsonElement payload, string name)
{
    return payload.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
        ? NormalizeBlank(value.GetString())
        : null;
}

static string? ReadClaimGrantList(JsonElement payload, params string[] names)
{
    var grants = new List<string>();
    foreach (var name in names)
    {
        if (!payload.TryGetProperty(name, out var value))
        {
            continue;
        }

        if (value.ValueKind == JsonValueKind.String)
        {
            AddGrantValues(grants, value.GetString());
        }
        else if (value.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in value.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.String)
                {
                    AddGrantValues(grants, item.GetString());
                }
            }
        }
    }

    return grants.Count == 0
        ? null
        : string.Join(",", grants.Distinct(StringComparer.OrdinalIgnoreCase));
}

static void AddGrantValues(List<string> grants, string? raw)
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

static string? JoinGrantLists(params string?[] values)
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

static byte[] DecodeBase64Url(string value)
{
    var padded = value.Replace('-', '+').Replace('_', '/');
    padded = padded.PadRight(padded.Length + (4 - padded.Length % 4) % 4, '=');
    return Convert.FromBase64String(padded);
}

static ClientPrincipal? GetClientPrincipal(HttpContext context)
{
    return context.Items.TryGetValue(ClientPrincipal.ItemKey, out var value)
        ? value as ClientPrincipal
        : null;
}

static bool TryReadAccountId(Dictionary<string, object?> row, out Guid accountId)
{
    accountId = default;
    if (!row.TryGetValue("account_id", out var value) || value is null)
    {
        return false;
    }

    if (value is Guid guid)
    {
        accountId = guid;
        return true;
    }

    return Guid.TryParse(value.ToString(), out accountId);
}

static string? TryReadRowString(Dictionary<string, object?> row, string key)
{
    return row.TryGetValue(key, out var value) && value is not null
        ? NormalizeBlank(value.ToString())
        : null;
}

static string? ReadHeader(HttpContext context, string name)
{
    return context.Request.Headers[name].FirstOrDefault();
}

static string? NormalizeBlank(string? value)
{
    return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

static string? NormalizeGuidText(string? value)
{
    return Guid.TryParse(value, out var guid) ? guid.ToString("D") : NormalizeBlank(value);
}

static string? NormalizeOwnerType(string? value)
{
    return string.IsNullOrWhiteSpace(value) ? null : value.Trim().ToLowerInvariant();
}

static string? NormalizePaymentProvider(string? value)
{
    var provider = NormalizeBlank(value)?.ToLowerInvariant();
    if (provider is null || provider.Length > 64)
    {
        return null;
    }

    foreach (var ch in provider)
    {
        if (!char.IsAsciiLetterOrDigit(ch) && ch is not '-' and not '_')
        {
            return null;
        }
    }

    return provider;
}

static bool ContainsCsvGrant(string? csv, string value)
{
    if (string.IsNullOrWhiteSpace(csv))
    {
        return false;
    }

    return csv.Split(
            new[] { ',', ';', ' ', '\r', '\n', '\t' },
            StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        .Any(item => item == "*"
            || string.Equals(item, value, StringComparison.OrdinalIgnoreCase)
            || IsPrefixGrantMatch(item, value));
}

static bool IsPrefixGrantMatch(string grant, string value)
{
    if (!grant.EndsWith(":*", StringComparison.Ordinal))
    {
        return false;
    }

    var prefix = grant[..^1];
    return value.StartsWith(prefix, StringComparison.OrdinalIgnoreCase);
}

static bool HasExternalForwardedAddress(HttpContext context)
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

static bool FixedTimeEquals(string expected, string supplied)
{
    var expectedBytes = Encoding.UTF8.GetBytes(expected);
    var suppliedBytes = Encoding.UTF8.GetBytes(supplied);
    return suppliedBytes.Length == expectedBytes.Length
        && CryptographicOperations.FixedTimeEquals(expectedBytes, suppliedBytes);
}

internal sealed class InternalApiOptions
{
    public string? Token { get; init; }
}

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

internal sealed class PaymentCallbackOptions
{
    public string? AllowedProviders { get; init; }

    public bool RequireAllowedProvider { get; init; }

    public string? AllowedAccountIds { get; init; }

    public string? AllowedAccountOwnerIds { get; init; }

    public bool RequireAccountGrant { get; init; }
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

internal sealed class LeaseRecoveryService(
    PostgresJobQueue jobs,
    ILogger<LeaseRecoveryService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var recovered = await jobs.RecoverExpiredLeasesAsync(stoppingToken);
                if (recovered.Count > 0)
                {
                    logger.LogWarning("Recovered {Count} expired PostgreSQL job leases.", recovered.Count);
                }
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to recover expired job leases.");
            }

            await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
        }
    }
}
