using System.Text;
using System.Text.Json;
using System.Net;
using System.Security.Cryptography;
using Microsoft.Extensions.Hosting.WindowsServices;
using Microsoft.Extensions.Options;
using XiaoLou.Domain;
using XiaoLou.Infrastructure.Postgres;
using XiaoLou.Infrastructure.Storage;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddWindowsService();
builder.Services.AddXiaoLouPostgres(builder.Configuration);
builder.Services.Configure<ObjectStorageOptions>(builder.Configuration.GetSection("ObjectStorage"));
builder.Services.Configure<InternalApiOptions>(builder.Configuration.GetSection("InternalApi"));
builder.Services.Configure<ClientApiOptions>(builder.Configuration.GetSection("ClientApi"));
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
    if (isPublicClientRequest && !IsClientRequestAllowed(context, clientApiOptions))
    {
        var tokenConfigured = GetConfiguredClientToken(clientApiOptions) is not null;
        context.Response.StatusCode = tokenConfigured
            ? StatusCodes.Status401Unauthorized
            : StatusCodes.Status403Forbidden;
        await context.Response.WriteAsJsonAsync(new
        {
            error = tokenConfigured
                ? "client API token is required or invalid"
                : "client API is not available from this request context",
        });
        return;
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
    string? lane,
    string? status,
    int? limit,
    HttpContext httpContext,
    IOptions<ClientApiOptions> clientApi,
    PostgresJobQueue jobs,
    CancellationToken ct) =>
{
    Guid? parsedAccountId = Guid.TryParse(accountId, out var accountGuid) ? accountGuid : null;
    if (AuthorizeAccountId(httpContext, clientApi.Value, parsedAccountId) is { } denied)
    {
        return denied;
    }

    return Results.Ok(await jobs.ListJobsAsync(parsedAccountId, lane, status, limit ?? 50, ct));
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
    return Results.Ok(await jobs.RecoverExpiredLeasesAsync(ct));
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
    var job = await jobs.SucceedAsync(jobId, JsonbFrom(request.Result), ct);
    return job is null ? Results.NotFound() : Results.Ok(job);
});

app.MapPost("/api/internal/jobs/{jobId:guid}/fail", async (
    Guid jobId,
    FailJobRequest request,
    PostgresJobQueue jobs,
    CancellationToken ct) =>
{
    var job = await jobs.FailOrRetryAsync(
        jobId,
        request.Error ?? "job failed",
        request.Retry,
        request.RetryDelaySeconds,
        ct);
    return job is null ? Results.NotFound() : Results.Ok(job);
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
    PostgresPaymentLedger ledger,
    IPaymentSignatureVerifier verifier,
    CancellationToken ct) =>
{
    using var reader = new StreamReader(http.Body, Encoding.UTF8);
    var rawBody = await reader.ReadToEndAsync(ct);
    var callback = JsonSerializer.Deserialize<PaymentCallbackRequest>(rawBody, jsonOptions)
        ?? new PaymentCallbackRequest();
    var signature = http.Headers["X-XiaoLou-Signature"].FirstOrDefault() ?? callback.Signature;
    var signatureValid = verifier.Verify(provider, rawBody, signature);
    var result = await ledger.ProcessCallbackAsync(callback with
    {
        Provider = provider,
        SignatureValid = signatureValid,
        RawBody = rawBody,
    }, ct);

    return signatureValid && !IsRejected(result)
        ? Results.Ok(result)
        : Results.BadRequest(result);
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

static bool IsRejected(Dictionary<string, object?> result)
{
    return result.TryGetValue("processed", out var processed)
        && processed is bool processedValue
        && !processedValue
        && result.ContainsKey("error");
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
        || context.Request.Path.StartsWithSegments("/api/providers/health");
}

static bool IsPublicClientApiRequest(HttpContext context)
{
    return context.Request.Path.StartsWithSegments("/api/accounts/ensure")
        || context.Request.Path.StartsWithSegments("/api/jobs")
        || context.Request.Path.StartsWithSegments("/api/media");
}

static IResult? AuthorizeAccountScope(HttpContext context, ClientApiOptions options, AccountScope scope)
{
    if (!IsClientTokenModeEnabled(options) || !ShouldRequireAccountScope(options))
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
    if (!IsClientTokenModeEnabled(options) || !ShouldRequireAccountScope(options))
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
    if (!IsClientTokenModeEnabled(options) || !ShouldRequireAccountScope(options))
    {
        return null;
    }

    return TryReadAccountId(row, out var accountId)
        && IsAccountScopeAllowed(context, options, accountId.ToString("D"), null, null)
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

static bool IsClientRequestAllowed(HttpContext context, ClientApiOptions options)
{
    var expectedToken = GetConfiguredClientToken(options);
    if (expectedToken is not null)
    {
        var supplied = ReadClientToken(context, options);
        return supplied is not null && FixedTimeEquals(expectedToken, supplied);
    }

    if (HasExternalForwardedAddress(context))
    {
        return false;
    }

    var remoteIp = context.Connection.RemoteIpAddress;
    return remoteIp is null || IPAddress.IsLoopback(remoteIp);
}

static bool IsClientPermissionAllowed(HttpContext context, ClientApiOptions options)
{
    if (!IsClientTokenModeEnabled(options))
    {
        return true;
    }

    var allowedPermissions = GetConfiguredAllowedPermissions(options);
    if (string.IsNullOrWhiteSpace(allowedPermissions))
    {
        return true;
    }

    var requiredPermission = GetRequiredClientPermission(context);
    return requiredPermission is not null
        && ContainsCsvGrant(allowedPermissions, requiredPermission);
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

    return null;
}

static bool IsClientTokenModeEnabled(ClientApiOptions options)
{
    return GetConfiguredClientToken(options) is not null;
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

static bool ContainsCsvGrant(string? csv, string value)
{
    if (string.IsNullOrWhiteSpace(csv))
    {
        return false;
    }

    return csv.Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
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

    public bool RequireAccountScope { get; init; } = true;

    public bool RequireConfiguredAccountGrant { get; init; }

    public string? AllowedAccountIds { get; init; }

    public string? AllowedAccountOwnerIds { get; init; }

    public string? AllowedPermissions { get; init; }
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
