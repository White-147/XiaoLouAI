using System.IO.Compression;
using System.Net;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.Extensions.Hosting.WindowsServices;
using Microsoft.Extensions.Options;
using XiaoLou.ControlApi.Modules.Accounts;
using XiaoLou.ControlApi.Modules.AgentCanvas;
using XiaoLou.ControlApi.Modules.Admin;
using XiaoLou.ControlApi.Modules.Auth;
using XiaoLou.ControlApi.Modules.Health;
using XiaoLou.ControlApi.Modules.InternalJobs;
using XiaoLou.ControlApi.Modules.Media;
using XiaoLou.ControlApi.Modules.Operational;
using XiaoLou.ControlApi.Modules.Payments;
using XiaoLou.ControlApi.Modules.Playground;
using XiaoLou.ControlApi.Modules.Projects;
using XiaoLou.ControlApi.Modules.PublicAccess;
using XiaoLou.ControlApi.Modules.Toolbox;
using XiaoLou.Domain;
using XiaoLou.Infrastructure.Postgres;
using XiaoLou.Infrastructure.Storage;
using static XiaoLou.ControlApi.Modules.Auth.AuthHelpers;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddWindowsService();
builder.Services.AddXiaoLouPostgres(builder.Configuration);
builder.Services.Configure<ObjectStorageOptions>(builder.Configuration.GetSection("ObjectStorage"));
builder.Services.Configure<InternalApiOptions>(builder.Configuration.GetSection("InternalApi"));
builder.Services.Configure<ClientApiOptions>(builder.Configuration.GetSection("ClientApi"));
builder.Services.Configure<PaymentCallbackOptions>(builder.Configuration.GetSection("Payments"));
builder.Services.AddXiaoLouPublicAccessGuard(builder.Configuration);
builder.Services.AddResponseCompression(options =>
{
    options.EnableForHttps = true;
    options.Providers.Add<BrotliCompressionProvider>();
    options.Providers.Add<GzipCompressionProvider>();
    options.MimeTypes = new[]
    {
        "application/json",
        "application/problem+json",
    };
});
builder.Services.Configure<BrotliCompressionProviderOptions>(options =>
{
    options.Level = CompressionLevel.Fastest;
});
builder.Services.Configure<GzipCompressionProviderOptions>(options =>
{
    options.Level = CompressionLevel.Fastest;
});
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

app.UseXiaoLouPublicAccessGuard();

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
    var isAnonymousIdentityRequest = IsAnonymousIdentityRequest(context);
    var clientApiOptions = context.RequestServices.GetRequiredService<IOptions<ClientApiOptions>>().Value;
    var clientAuth = isPublicClientRequest && !isAnonymousIdentityRequest
        ? AuthenticateClientRequest(context, clientApiOptions)
        : ClientAuthenticationResult.Allowed(null);
    if (isPublicClientRequest && !clientAuth.IsAllowed)
    {
        await AuthErrorEnvelopeResponses.WriteClientAuthenticationFailureAsync(context, clientAuth);
        return;
    }

    if (isPublicClientRequest)
    {
        context.Items[ClientPrincipal.ItemKey] = clientAuth.Principal;
    }

    if (isPublicClientRequest && !isAnonymousIdentityRequest && !IsClientPermissionAllowed(context, clientApiOptions))
    {
        await AuthErrorEnvelopeResponses.WriteClientPermissionFailureAsync(
            context,
            GetRequiredClientPermission(context));
        return;
    }

    await next();
});

app.UseWhen(PublicResponsePolicy.IsStableMetadataRequest, branch =>
{
    branch.UseResponseCompression();
});

app.MapHealthMetricsEndpoints();

app.MapPost("/api/schema/apply", async (PostgresSchemaMigrator migrator, CancellationToken ct) =>
{
    await migrator.ApplyAsync(ct);
    return Results.Ok(new { applied = true });
});

app.MapAccountsAuthEndpoints();

app.MapPlaygroundEndpoints();

app.MapToolboxEndpoints();

app.MapAdminEndpoints();

app.MapInternalJobsEndpoints();

app.MapPaymentEndpoints();

app.MapMediaEndpoints();

app.MapProjectEndpoints();

app.MapAgentCanvasChatEndpoints();

app.MapAgentCanvasLocalImageEditEndpoints();

app.MapOperationalEndpoints();

app.Run();

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

internal sealed class InternalApiOptions
{
    public string? Token { get; init; }
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
