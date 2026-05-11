using System.Text.Json;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using XiaoLou.ClosedApiWorker.Storage;
using XiaoLou.ClosedApiWorker.Vertex;
using XiaoLou.Domain;
using XiaoLou.Infrastructure.Postgres;

namespace XiaoLou.ClosedApiWorker;

internal sealed class ClosedApiWorkerService(
    PostgresJobQueue jobs,
    PostgresJobNotificationListener listener,
    IOptions<ClosedApiWorkerOptions> options,
    VertexGeminiImageClient vertexImages,
    VertexVeoVideoClient vertexVideos,
    LocalObjectStorageWriter storageWriter,
    ILogger<ClosedApiWorkerService> logger,
    IHostApplicationLifetime lifetime) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var worker = options.Value;
        logger.LogInformation(
            "Starting XiaoLou closed API worker {WorkerId} for lane {Lane} provider route {ProviderRoute} in {ExecutionMode} mode.",
            worker.WorkerId,
            worker.Lane,
            worker.ProviderRoute,
            ClosedApiWorkerOptions.ExecutionMode);

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
            if (ClosedApiJobPayload.PayloadRequestsFailure(job))
            {
                const string message = "forced closed API worker failure requested by job payload";
                logger.LogInformation(
                    "Closed API worker intentionally failed job {JobId} for negative-path verification.",
                    jobId);
                await jobs.FailOrRetryAsync(jobId, message, retry: true, retryDelaySeconds: null, cancellationToken);
                return;
            }

            if (ClosedApiJobPayload.TryReadImageJob(job, out var imageRequest)
                && VertexModelRouting.IsVertexImageModel(imageRequest.Model))
            {
                await CompleteVertexImageJobAsync(jobId, worker, imageRequest, cancellationToken);
                return;
            }

            if (ClosedApiJobPayload.TryReadVideoJob(job, out var videoRequest)
                && VertexModelRouting.IsVertexVideoModel(videoRequest.Model))
            {
                await CompleteVertexVideoJobAsync(jobId, worker, videoRequest, cancellationToken);
                return;
            }

            await CompleteCompatibilityStubAsync(jobId, worker, job, cancellationToken);
        }
        catch (VertexProviderException ex)
        {
            logger.LogWarning(ex, "Closed API Vertex adapter failed job {JobId}. Retry={Retry}", jobId, ex.Retry);
            await jobs.FailOrRetryAsync(jobId, ex.Message, retry: ex.Retry, retryDelaySeconds: null, cancellationToken);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Closed API worker failed job {JobId}.", jobId);
            await jobs.FailOrRetryAsync(jobId, ex.Message, retry: true, retryDelaySeconds: null, cancellationToken);
        }
    }

    private async Task CompleteVertexImageJobAsync(
        Guid jobId,
        ClosedApiWorkerOptions worker,
        ClosedApiImageJobRequest imageRequest,
        CancellationToken cancellationToken)
    {
        logger.LogInformation(
            "Generating Vertex image for job {JobId} with model {Model}.",
            jobId,
            imageRequest.Model);

        var generated = await vertexImages.GenerateImageAsync(imageRequest, cancellationToken);
        var stored = await storageWriter.WriteGeneratedMediaAsync(
            jobId,
            imageRequest.Model,
            generated.MimeType,
            generated.Bytes,
            cancellationToken);

        await jobs.SucceedAsync(
            jobId,
            JsonSerializer.Serialize(new
            {
                worker = worker.WorkerId,
                kind = "closed-api",
                provider = "google-vertex",
                providerRoute = worker.ProviderRoute,
                status = "succeeded",
                executionMode = ClosedApiWorkerOptions.ExecutionMode,
                runtimeBoundary = ClosedApiWorkerOptions.RuntimeBoundary,
                adapterStatus = ClosedApiWorkerOptions.AdapterStatus,
                isStubbed = false,
                isSimulated = false,
                model = imageRequest.Model,
                rawModel = VertexModelRouting.StripVertexPrefix(imageRequest.Model),
                prompt = imageRequest.Prompt,
                aspectRatio = imageRequest.AspectRatio,
                resolution = imageRequest.Resolution,
                referenceImageUrls = imageRequest.ReferenceImageUrls,
                imageUrl = stored.Url,
                resultUrl = stored.Url,
                mimeType = stored.MimeType,
                bucket = stored.Bucket,
                objectKey = stored.ObjectKey,
                urlExpiresAt = stored.ExpiresAt,
                outputSummary = generated.TextSummary,
                completedAt = DateTimeOffset.UtcNow,
            }),
            cancellationToken);
    }

    private async Task CompleteVertexVideoJobAsync(
        Guid jobId,
        ClosedApiWorkerOptions worker,
        ClosedApiVideoJobRequest videoRequest,
        CancellationToken cancellationToken)
    {
        logger.LogInformation(
            "Generating Vertex Veo video for job {JobId} with model {Model}.",
            jobId,
            videoRequest.Model);

        var generated = await vertexVideos.GenerateVideoAsync(
            videoRequest,
            token => jobs.HeartbeatAsync(jobId, worker.WorkerId, worker.LeaseSeconds, token),
            cancellationToken);
        var stored = await storageWriter.WriteGeneratedMediaAsync(
            jobId,
            videoRequest.Model,
            generated.MimeType,
            generated.Bytes,
            cancellationToken);

        var thumbnailUrl = !string.IsNullOrWhiteSpace(videoRequest.FirstFrameUrl)
            ? videoRequest.FirstFrameUrl
            : videoRequest.ReferenceImageUrls.FirstOrDefault()
                ?? videoRequest.MultiReferenceImages.Values.SelectMany(value => value).FirstOrDefault();

        await jobs.SucceedAsync(
            jobId,
            JsonSerializer.Serialize(new
            {
                worker = worker.WorkerId,
                kind = "closed-api",
                provider = "google-vertex",
                providerRoute = worker.ProviderRoute,
                status = "succeeded",
                executionMode = ClosedApiWorkerOptions.ExecutionMode,
                runtimeBoundary = ClosedApiWorkerOptions.RuntimeBoundary,
                adapterStatus = "vertex_veo_video_connected",
                isStubbed = false,
                isSimulated = false,
                jobType = videoRequest.JobType,
                model = videoRequest.Model,
                rawModel = VertexModelRouting.StripVertexPrefix(videoRequest.Model),
                prompt = videoRequest.Prompt,
                duration = videoRequest.Duration,
                aspectRatio = videoRequest.AspectRatio,
                resolution = videoRequest.Resolution,
                generateAudio = videoRequest.GenerateAudio,
                videoMode = videoRequest.VideoMode,
                firstFrameUrl = videoRequest.FirstFrameUrl,
                lastFrameUrl = videoRequest.LastFrameUrl,
                motionReferenceVideoUrl = videoRequest.MotionReferenceVideoUrl,
                referenceImageUrls = videoRequest.ReferenceImageUrls,
                referenceImages = videoRequest.ReferenceImages.Select(reference => new
                {
                    source = reference.Source,
                    referenceType = reference.ReferenceType,
                }),
                multiReferenceImages = videoRequest.MultiReferenceImages,
                referenceVideoUrls = videoRequest.ReferenceVideoUrls,
                referenceAudioUrls = videoRequest.ReferenceAudioUrls,
                vertexOperationName = generated.OperationName,
                vertexGcsUri = generated.GcsUri,
                raiMediaFilteredCount = generated.RaiMediaFilteredCount,
                raiMediaFilteredReasons = generated.RaiMediaFilteredReasons,
                videoUrl = stored.Url,
                resultUrl = stored.Url,
                thumbnailUrl,
                mimeType = stored.MimeType,
                bucket = stored.Bucket,
                objectKey = stored.ObjectKey,
                urlExpiresAt = stored.ExpiresAt,
                outputSummary = "Vertex Veo video generation completed.",
                completedAt = DateTimeOffset.UtcNow,
            }),
            cancellationToken);
    }

    private async Task CompleteCompatibilityStubAsync(
        Guid jobId,
        ClosedApiWorkerOptions worker,
        Dictionary<string, object?> job,
        CancellationToken cancellationToken)
    {
        await jobs.SucceedAsync(
            jobId,
            JsonSerializer.Serialize(new
            {
                worker = worker.WorkerId,
                kind = "closed-api",
                providerRoute = worker.ProviderRoute,
                status = "stubbed",
                executionMode = ClosedApiWorkerOptions.ExecutionMode,
                runtimeBoundary = ClosedApiWorkerOptions.RuntimeBoundary,
                adapterStatus = "unsupported_job_stubbed",
                isStubbed = true,
                isSimulated = true,
                jobType = job.TryGetValue("job_type", out var jobType) ? jobType?.ToString() : null,
                contract = "ClosedApiWorker now executes Vertex image jobs and Vertex Veo video jobs. Other closed-api jobs remain stubbed until their provider adapters are implemented.",
                requiredForRealExecution = new[]
                {
                    "provider_adapter_for_job_type",
                    "credentialed_vendor_route",
                    "object_storage_media_outputs",
                },
                completedAt = DateTimeOffset.UtcNow,
            }),
            cancellationToken);
    }
}
