using System.Text.Json;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Hosting.WindowsServices;
using XiaoLou.Domain;
using XiaoLou.Infrastructure.Postgres;
using XiaoLou.Infrastructure.Storage;

var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddWindowsService();
builder.Services.AddXiaoLouPostgres(builder.Configuration);
builder.Services.Configure<ObjectStorageOptions>(builder.Configuration.GetSection("ObjectStorage"));
builder.Services.Configure<ClosedApiWorkerOptions>(builder.Configuration.GetSection("Worker"));
builder.Services.AddSingleton<IObjectStorageSigner, ObjectStorageSigner>();
builder.Services.AddHostedService<ClosedApiWorkerService>();

var host = builder.Build();
await host.RunAsync();

internal sealed class ClosedApiWorkerOptions
{
    public string WorkerId { get; init; } = "closed-api-worker-1";
    public string Lane { get; init; } = AccountLanes.Media;
    public string ProviderRoute { get; init; } = "closed-api";
    public int BatchSize { get; init; } = 2;
    public int LeaseSeconds { get; init; } = 300;
    public int PollSeconds { get; init; } = 5;
    public bool RunOnce { get; init; }
}

internal sealed class ClosedApiWorkerService(
    PostgresJobQueue jobs,
    PostgresJobNotificationListener listener,
    IOptions<ClosedApiWorkerOptions> options,
    ILogger<ClosedApiWorkerService> logger,
    IHostApplicationLifetime lifetime) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var worker = options.Value;
        logger.LogInformation(
            "Starting XiaoLou closed API worker {WorkerId} for lane {Lane} provider route {ProviderRoute}.",
            worker.WorkerId,
            worker.Lane,
            worker.ProviderRoute);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var leased = await jobs.LeaseJobsAsync(
                    new LeaseJobsRequest
                    {
                        Lane = worker.Lane,
                        ProviderRoute = worker.ProviderRoute,
                        WorkerId = worker.WorkerId,
                        BatchSize = worker.BatchSize,
                        LeaseSeconds = worker.LeaseSeconds,
                    },
                    stoppingToken);

                if (leased.Count == 0)
                {
                    if (worker.RunOnce)
                    {
                        logger.LogInformation("Run-once mode found no closed API jobs to process.");
                        lifetime.StopApplication();
                        return;
                    }

                    await listener.WaitForJobSignalAsync(TimeSpan.FromSeconds(worker.PollSeconds), stoppingToken);
                    continue;
                }

                foreach (var job in leased)
                {
                    await ProcessJobAsync(job, worker, stoppingToken);
                    if (worker.RunOnce)
                    {
                        lifetime.StopApplication();
                        return;
                    }
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Closed API worker loop failed.");
                await Task.Delay(TimeSpan.FromSeconds(worker.PollSeconds), stoppingToken);
            }
        }
    }

    private async Task ProcessJobAsync(
        Dictionary<string, object?> job,
        ClosedApiWorkerOptions worker,
        CancellationToken cancellationToken)
    {
        var jobId = (Guid)job["id"]!;
        await jobs.MarkRunningAsync(jobId, worker.WorkerId, cancellationToken);

        try
        {
            if (PayloadRequestsFailure(job))
            {
                const string message = "forced closed API worker failure requested by job payload";
                logger.LogInformation(
                    "Closed API worker intentionally failed job {JobId} for negative-path verification.",
                    jobId);
                await jobs.FailOrRetryAsync(jobId, message, retry: true, retryDelaySeconds: null, cancellationToken);
                return;
            }

            // P0 worker skeleton: real provider calls are added behind provider router.
            // The important behavior now is durable PostgreSQL state transitions.
            await jobs.SucceedAsync(
                jobId,
                JsonSerializer.Serialize(new
                {
                    worker = worker.WorkerId,
                    kind = "closed-api",
                    providerRoute = worker.ProviderRoute,
                    status = "stubbed",
                    completedAt = DateTimeOffset.UtcNow,
                }),
                cancellationToken);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Closed API worker failed job {JobId}.", jobId);
            await jobs.FailOrRetryAsync(jobId, ex.Message, retry: true, retryDelaySeconds: null, cancellationToken);
        }
    }

    private static bool PayloadRequestsFailure(Dictionary<string, object?> job)
    {
        if (!job.TryGetValue("payload", out var payload) || payload is null)
        {
            return false;
        }

        if (payload is JsonDocument document)
        {
            return ElementRequestsFailure(document.RootElement);
        }

        if (payload is JsonElement element)
        {
            return ElementRequestsFailure(element);
        }

        var text = payload.ToString();
        if (string.IsNullOrWhiteSpace(text))
        {
            return false;
        }

        using var parsed = JsonDocument.Parse(text);
        return ElementRequestsFailure(parsed.RootElement);
    }

    private static bool ElementRequestsFailure(JsonElement element)
    {
        return element.ValueKind == JsonValueKind.Object
            && element.TryGetProperty("forceFail", out var forceFail)
            && forceFail.ValueKind == JsonValueKind.True;
    }
}
