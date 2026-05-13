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

public static class JobProviderRoutes
{
    public const string ClosedApi = "closed-api";
    public const string ClosedApiVertex = "closed-api-vertex";

    public static string? NormalizeForCreateJob(string? requestedRoute, string? jobType, JsonElement payload)
    {
        if (IsVertexVeoCreateVideoJob(jobType, payload))
        {
            return ClosedApiVertex;
        }

        return string.IsNullOrWhiteSpace(requestedRoute) ? null : requestedRoute.Trim();
    }

    public static bool IsVertexVeoCreateVideoJob(string? jobType, JsonElement payload)
    {
        return string.Equals(jobType?.Trim(), "create_video_generate", StringComparison.Ordinal)
            && IsVertexVeoModel(FirstPayloadText(payload, "model", "videoModel", "video_model"));
    }

    public static bool IsVertexVeoModel(string? model)
    {
        return model?.Trim().StartsWith("vertex:veo-", StringComparison.OrdinalIgnoreCase) == true;
    }

    private static string? FirstPayloadText(JsonElement payload, params string[] propertyNames)
    {
        if (payload.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        foreach (var propertyName in propertyNames)
        {
            if (payload.TryGetProperty(propertyName, out var property) &&
                property.ValueKind == JsonValueKind.String)
            {
                var value = property.GetString();
                if (!string.IsNullOrWhiteSpace(value))
                {
                    return value.Trim();
                }
            }
        }

        return null;
    }
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
    public Dictionary<string, string>? EpisodeScripts { get; init; }
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

public sealed record AgentCanvasChatRequest
{
    public string? SessionId { get; init; }
    public string? ProjectId { get; init; }
    public string? Message { get; init; }
    public string? Mode { get; init; }
    public string? Model { get; init; }
    public string? ModelLabel { get; init; }
    public string? ToolId { get; init; }
    public string? ToolType { get; init; }
    public string? PreferredImageToolId { get; init; }
    public string? PreferredVideoToolId { get; init; }
    public IReadOnlyList<string>? AllowedImageToolIds { get; init; }
    public IReadOnlyList<string>? AllowedVideoToolIds { get; init; }
    public bool? AutoModelPreference { get; init; }
    public string? Instruction { get; init; }
    public string? SkillId { get; init; }
    public string? SkillTitle { get; init; }
    public string? SkillInstruction { get; init; }
    public int? MaxTokens { get; init; }
    public AgentCanvasChatToolsRequest? Tools { get; init; }
    public JsonElement Canvas { get; init; }
    public IReadOnlyList<AgentCanvasChatAttachment>? Attachments { get; init; }
}

public sealed record AgentCanvasChatToolsRequest
{
    public bool? WebSearch { get; init; }
    public bool? CanvasFiles { get; init; }
}

public sealed record AgentCanvasChatAttachment
{
    public string? Type { get; init; }
    public string? Url { get; init; }
    public string? NodeId { get; init; }
    public string? Base64 { get; init; }
}

public sealed record AgentCanvasChatResponse
{
    public string? Response { get; init; }
    public IReadOnlyList<JsonElement> Actions { get; init; } = Array.Empty<JsonElement>();
    public IReadOnlyList<string> Warnings { get; init; } = Array.Empty<string>();
    public string? Topic { get; init; }
    public string? SessionId { get; init; }
    public string? Provider { get; init; }
    public string? Model { get; init; }
    public string? FallbackFrom { get; init; }
}

public sealed record LocalImageEditRequest : AccountScope
{
    public string? ProjectId { get; init; }
    public string? NodeId { get; init; }
    public string? Operation { get; init; }
    public string? ImageUrl { get; init; }
    public string? DataUrl { get; init; }
    public string? MaskDataUrl { get; init; }
    public int? LongEdge { get; init; }
    public string? FaceEnhance { get; init; }
    public bool? RefineMask { get; init; }
    public string? Sam2Size { get; init; }
    public string? InpaintEngine { get; init; }
    public int? InpaintSteps { get; init; }
    public double? InpaintGuidance { get; init; }
    public double? InpaintStrength { get; init; }
    public int? InpaintSize { get; init; }
    public int? MaskGrow { get; init; }
    public int? MaskDilate { get; init; }
    public int? MaskFeather { get; init; }
    public int? MaskClose { get; init; }
    public int? CropPadding { get; init; }
    public bool? FallbackToLama { get; init; }
    public string? InpaintPrompt { get; init; }
    public string? InpaintNegativePrompt { get; init; }
    public LocalImageEditOffset? Offset { get; init; }
    public double? Rotation { get; init; }
    public double? DisplayWidth { get; init; }
    public double? DisplayHeight { get; init; }
    public string? RefineBackend { get; init; }
    public int? BackgroundDilate { get; init; }
    public int? BackgroundFeather { get; init; }
    public int? BackgroundClose { get; init; }
    public int? EdgeGrow { get; init; }
    public int? EdgeFeather { get; init; }
    public string? Device { get; init; }
    public int? Seed { get; init; }
    public double? IpAdapterScale { get; init; }
    public double? RotationDegrees { get; init; }
    public double? Tilt { get; init; }
    public double? Zoom { get; init; }
    public string? Mode { get; init; }
    public string? Repair { get; init; }
    public JsonElement Options { get; init; }
}

public sealed record LocalImageEditOffset
{
    public double X { get; init; }
    public double Y { get; init; }
}

public sealed record PlaygroundConversationRequest : AccountScope
{
    public string? Id { get; init; }
    public string? Title { get; init; }
    public string? Model { get; init; }
}

public sealed record PlaygroundChatRequest : AccountScope
{
    public string? ConversationId { get; init; }
    public string? Message { get; init; }
    public string? Model { get; init; }
}

public sealed record PlaygroundMemoryPreferenceRequest : AccountScope
{
    public bool? Enabled { get; init; }
}

public sealed record PlaygroundMemoryRequest : AccountScope
{
    public string? Key { get; init; }
    public string? Value { get; init; }
    public bool? Enabled { get; init; }
}

public sealed record ToolboxRunRequest : AccountScope
{
    public string? ProjectId { get; init; }
    public string? StoryboardId { get; init; }
    public string? Target { get; init; }
    public string? Note { get; init; }
    public string? Text { get; init; }
    public string? TargetLang { get; init; }
    public string? VideoUrl { get; init; }
    public string? Prompt { get; init; }
    public string? Model { get; init; }
    public string? PlotText { get; init; }
    public string? IdempotencyKey { get; init; }
    public JsonElement References { get; init; }
    public JsonElement Payload { get; init; }
}

public sealed record LoginRequest
{
    public string? Email { get; init; }
    public string? Password { get; init; }
}

public sealed record BootstrapPlatformPasswordRequest
{
    public string? Email { get; init; }
    public string? Password { get; init; }
}

public sealed record ChangePasswordRequest
{
    public string? CurrentPassword { get; init; }
    public string? NewPassword { get; init; }
}

public sealed record AdminResetPasswordRequest
{
    public string? Email { get; init; }
    public string? NewPassword { get; init; }
}

public sealed record RequestPasswordResetRequest
{
    public string? Email { get; init; }
}

public sealed record CompletePasswordResetRequest
{
    public string? ResetToken { get; init; }
    public string? NewPassword { get; init; }
}

public sealed record RegisterPersonalRequest
{
    public string? DisplayName { get; init; }
    public string? Email { get; init; }
    public string? Phone { get; init; }
    public string? Password { get; init; }
}

public sealed record RegisterEnterpriseAdminRequest
{
    public string? CompanyName { get; init; }
    public string? AdminName { get; init; }
    public string? Email { get; init; }
    public string? Phone { get; init; }
    public string? Password { get; init; }
    public string? LicenseNo { get; init; }
    public string? Industry { get; init; }
    public string? TeamSize { get; init; }
}

public sealed record EnterpriseApplicationRequest
{
    public string? CompanyName { get; init; }
    public string? ContactName { get; init; }
    public string? ContactPhone { get; init; }
    public string? Phone { get; init; }
    public string? Email { get; init; }
    public string? LicenseNo { get; init; }
    public string? Industry { get; init; }
    public string? TeamSize { get; init; }
    public string? Note { get; init; }
    public JsonElement Data { get; init; }
}

public sealed record EnterpriseApplicationReviewRequest
{
    public string? Status { get; init; }
    public string? Decision { get; init; }
    public string? Note { get; init; }
}

public sealed record EnterpriseApplicationStatusUpdateRequest
{
    public string? Status { get; init; }
    public string? Decision { get; init; }
    public string? Note { get; init; }
}

public sealed record EnterpriseApplicationReviewDecisionRequest
{
    public string? Status { get; init; }
    public string? Decision { get; init; }
    public string? Note { get; init; }
}

public sealed record PricingRuleRequest
{
    public string? ActionCode { get; init; }
    public string? Label { get; init; }
    public decimal? BaseCredits { get; init; }
    public decimal? Credits { get; init; }
    public string? UnitLabel { get; init; }
    public string? Description { get; init; }
    public JsonElement Data { get; init; }
}

public sealed record AdminPricingRuleUpsertRequest
{
    public string? ActionCode { get; init; }
    public string? Label { get; init; }
    public decimal? BaseCredits { get; init; }
    public decimal? Credits { get; init; }
    public string? UnitLabel { get; init; }
    public string? Description { get; init; }
    public JsonElement Data { get; init; }
}

public sealed record UpdateMeRequest
{
    public string? DisplayName { get; init; }
    public string? Avatar { get; init; }
    public string? Phone { get; init; }
    public string? DefaultOrganizationId { get; init; }
}

public sealed record CreateOrganizationMemberRequest
{
    public string? DisplayName { get; init; }
    public string? Email { get; init; }
    public string? Phone { get; init; }
    public string? Department { get; init; }
    public string? Password { get; init; }
    public string? MembershipRole { get; init; }
    public bool? CanUseOrganizationWallet { get; init; }
}

public sealed record OrganizationMemberPasswordResetRequest
{
    public string? NewPassword { get; init; }
}

public sealed record UpdateOrganizationMemberAccountRequest
{
    public string? DisplayName { get; init; }
    public string? Email { get; init; }
    public string? Phone { get; init; }
    public string? Department { get; init; }
    public string? MembershipRole { get; init; }
    public bool? CanUseOrganizationWallet { get; init; }
    public string? NewPassword { get; init; }
}

public sealed record UpdatePlatformAccountRequest
{
    public string? DisplayName { get; init; }
    public string? Email { get; init; }
    public string? Phone { get; init; }
    public string? PlatformRole { get; init; }
    public string? NewPassword { get; init; }
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
