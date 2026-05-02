using System.Text.Json;

namespace XiaoLou.Domain;

public static class AccountLanes
{
    public const string Finance = "account-finance";
    public const string Control = "account-control";
    public const string Media = "account-media";

    private static readonly HashSet<string> Known = new(StringComparer.Ordinal)
    {
        Finance,
        Control,
        Media,
    };

    public static string Normalize(string? lane, string fallback = Media)
    {
        var value = string.IsNullOrWhiteSpace(lane) ? fallback : lane.Trim();
        if (!Known.Contains(value))
        {
            throw new ArgumentOutOfRangeException(nameof(lane), $"Unsupported account lane: {value}");
        }

        return value;
    }
}

public static class JobStatuses
{
    public const string Queued = "queued";
    public const string Leased = "leased";
    public const string Running = "running";
    public const string Succeeded = "succeeded";
    public const string Failed = "failed";
    public const string Cancelled = "cancelled";
    public const string RetryWaiting = "retry_waiting";
}

public record AccountScope
{
    public string? AccountId { get; init; }
    public string? AccountOwnerType { get; init; }
    public string? AccountOwnerId { get; init; }
    public string? RegionCode { get; init; }
    public string? Currency { get; init; }
}

public sealed record EnsureAccountRequest : AccountScope;

public sealed record CreateJobRequest : AccountScope
{
    public string? Lane { get; init; }
    public string? JobType { get; init; }
    public string? ProviderRoute { get; init; }
    public string? IdempotencyKey { get; init; }
    public JsonElement Payload { get; init; }
    public int Priority { get; init; }
    public int MaxAttempts { get; init; } = 3;
    public int TimeoutSeconds { get; init; } = 1800;
    public DateTimeOffset? RunAfter { get; init; }
    public string? CreatedByUserId { get; init; }
}

public sealed record LeaseJobsRequest
{
    public string? Lane { get; init; }
    public string? ProviderRoute { get; init; }
    public string? WorkerId { get; init; }
    public int BatchSize { get; init; } = 1;
    public int LeaseSeconds { get; init; } = 300;
}

public sealed record MarkJobRunningRequest
{
    public string? WorkerId { get; init; }
}

public sealed record JobHeartbeatRequest
{
    public string? WorkerId { get; init; }
    public int LeaseSeconds { get; init; } = 300;
}

public sealed record CompleteJobRequest
{
    public JsonElement Result { get; init; }
}

public sealed record FailJobRequest
{
    public string? Error { get; init; }
    public bool Retry { get; init; } = true;
    public int? RetryDelaySeconds { get; init; }
}

public sealed record CancelJobRequest : AccountScope
{
    public string? Reason { get; init; }
}

public sealed record ProjectRequest : AccountScope
{
    public string? Id { get; init; }
    public string? Title { get; init; }
    public string? Summary { get; init; }
    public string? Status { get; init; }
    public string? CoverUrl { get; init; }
    public string? OrganizationId { get; init; }
    public string? OwnerType { get; init; }
    public string? OwnerId { get; init; }
    public string? CurrentStep { get; init; }
    public decimal? ProgressPercent { get; init; }
    public decimal? BudgetCredits { get; init; }
    public decimal? BudgetLimitCredits { get; init; }
    public decimal? BudgetUsedCredits { get; init; }
    public string? BillingWalletType { get; init; }
    public string? BillingPolicy { get; init; }
    public string? DirectorAgentName { get; init; }
    public JsonElement Data { get; init; }
}

public sealed record ProjectSettingsRequest : AccountScope
{
    public JsonElement Data { get; init; }
}

public sealed record ProjectScriptRequest : AccountScope
{
    public string? Content { get; init; }
    public string? Title { get; init; }
}

public sealed record ProjectTimelineRequest : AccountScope
{
    public int? Version { get; init; }
    public decimal? TotalDurationSeconds { get; init; }
    public JsonElement Tracks { get; init; }
    public JsonElement Data { get; init; }
}

public sealed record CanvasProjectRequest : AccountScope
{
    public string? Id { get; init; }
    public string? Title { get; init; }
    public string? ThumbnailUrl { get; init; }
    public JsonElement CanvasData { get; init; }
    public JsonElement AgentContext { get; init; }
}

public sealed record PaymentCallbackRequest : AccountScope
{
    public string Provider { get; init; } = "";
    public string? EventId { get; init; }
    public string? MerchantOrderNo { get; init; }
    public string? ProviderTradeNo { get; init; }
    public string? Signature { get; init; }
    public bool SignatureValid { get; init; }
    public long AmountCents { get; init; }
    public decimal CreditAmount { get; init; }
    public new string Currency { get; init; } = "CNY";
    public DateTimeOffset? PaidAt { get; init; }
    public JsonElement Data { get; init; }
    public string RawBody { get; init; } = "";
}

public sealed record UploadBeginRequest : AccountScope
{
    public string IdempotencyKey { get; init; } = "";
    public string Bucket { get; init; } = "";
    public string ObjectKey { get; init; } = "";
    public string MediaType { get; init; } = "file";
    public string? ContentType { get; init; }
    public long? ByteSize { get; init; }
    public string? ChecksumSha256 { get; init; }
    public string DataSensitivity { get; init; } = "normal";
    public int ExpiresInSeconds { get; init; } = 900;
    public JsonElement Data { get; init; }
}

public sealed record UploadCompleteRequest : AccountScope
{
    public Guid UploadSessionId { get; init; }
    public Guid MediaObjectId { get; init; }
    public string? ChecksumSha256 { get; init; }
    public long? ByteSize { get; init; }
}

public sealed record SignedReadUrlRequest : AccountScope
{
    public Guid MediaObjectId { get; init; }
    public int ExpiresInSeconds { get; init; } = 900;
}

public sealed record MoveTempToPermanentRequest : AccountScope
{
    public Guid MediaObjectId { get; init; }
    public string PermanentObjectKey { get; init; } = "";
    public string Reason { get; init; } = "job-result";
}

public sealed record ProviderHealthRequest
{
    public string Provider { get; init; } = "";
    public string RegionCode { get; init; } = "global";
    public string ModelFamily { get; init; } = "default";
    public string Status { get; init; } = "unknown";
    public decimal? SuccessRate { get; init; }
    public int? P95LatencyMs { get; init; }
    public decimal? CostScore { get; init; }
    public string? LastError { get; init; }
}

public sealed record OutboxLeaseRequest
{
    public string? WorkerId { get; init; }
    public int BatchSize { get; init; } = 25;
    public int LeaseSeconds { get; init; } = 120;
}

public sealed record OutboxCompleteRequest
{
    public bool Published { get; init; } = true;
    public string? Error { get; init; }
    public int RetryDelaySeconds { get; init; } = 60;
}
