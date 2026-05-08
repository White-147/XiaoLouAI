using XiaoLou.Domain;

namespace XiaoLou.ClosedApiWorker;

internal sealed class ClosedApiWorkerOptions
{
    public const string ExecutionMode = "vertex-image-adapter";
    public const string RuntimeBoundary = "canonical-queue-worker";
    public const string AdapterStatus = "vertex_image_connected";

    public string WorkerId { get; init; } = "closed-api-worker-1";
    public string Lane { get; init; } = AccountLanes.Media;
    public string ProviderRoute { get; init; } = "closed-api";
    public int BatchSize { get; init; } = 2;
    public int LeaseSeconds { get; init; } = 300;
    public int PollSeconds { get; init; } = 5;
    public bool RunOnce { get; init; }
}
