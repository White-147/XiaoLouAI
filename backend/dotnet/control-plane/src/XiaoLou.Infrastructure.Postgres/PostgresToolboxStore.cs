using System.Text.Json;
using XiaoLou.Domain;
using Npgsql;
using NpgsqlTypes;

namespace XiaoLou.Infrastructure.Postgres;

public sealed class PostgresToolboxStore(
    NpgsqlDataSource dataSource,
    PostgresAccountStore accounts,
    PostgresJobQueue jobs)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly Dictionary<string, string> JobTypesByAction = new(StringComparer.Ordinal)
    {
        ["character_replace"] = "character_replace",
        ["motion_transfer"] = "motion_transfer",
        ["upscale_restore"] = "upscale_restore",
        ["video_reverse_prompt"] = "video_reverse_prompt_requested",
        ["storyboard_grid25"] = "storyboard_grid25_generate",
        ["translate_text"] = "text_translate",
    };

    public async Task<Dictionary<string, object?>> GetCapabilitiesAsync(CancellationToken cancellationToken)
    {
        return new Dictionary<string, object?>
        {
            ["items"] = await ListCapabilitiesAsync(cancellationToken),
            ["stagingArea"] = new[]
            {
                "video_reverse_prompt",
                "storyboard_grid25",
                "translate_text",
            },
        };
    }

    public async Task<Dictionary<string, object?>> GetSystemCapabilitiesAsync(CancellationToken cancellationToken)
    {
        var capabilities = await ListCapabilitiesAsync(cancellationToken);
        return new Dictionary<string, object?>
        {
            ["service"] = "xiaolou-control-api",
            ["mode"] = "windows-native",
            ["implementedDomains"] = new[]
            {
                "jobs",
                "media",
                "wallet",
                "projects",
                "canvas",
                "create",
                "identity",
                "admin",
                "playground",
                "toolbox",
            },
            ["toolbox"] = capabilities,
        };
    }

    public async Task<IReadOnlyList<Dictionary<string, object?>>> ListCapabilitiesAsync(CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT code, name, status, queue, description, data::text AS data_json
            FROM toolbox_capabilities
            ORDER BY sort_order ASC, code ASC
            """,
            connection);

        return (await PostgresRows.ReadManyAsync(command, cancellationToken))
            .Select(MapCapability)
            .ToArray();
    }

    public async Task<Dictionary<string, object?>> QueueCapabilityRunAsync(
        AccountScope scope,
        string actorId,
        string actionCode,
        ToolboxRunRequest request,
        CancellationToken cancellationToken)
    {
        if (!JobTypesByAction.TryGetValue(actionCode, out var jobType))
        {
            throw new ArgumentException($"Unsupported toolbox capability: {actionCode}", nameof(actionCode));
        }

        var actor = NormalizeActorId(actorId);
        var payload = BuildPayload(actionCode, jobType, request);
        var payloadElement = JsonSerializer.SerializeToElement(payload, JsonOptions);
        var job = await jobs.CreateJobAsync(new CreateJobRequest
        {
            AccountOwnerType = scope.AccountOwnerType,
            AccountOwnerId = scope.AccountOwnerId,
            RegionCode = scope.RegionCode,
            Currency = scope.Currency,
            Lane = AccountLanes.Control,
            JobType = jobType,
            ProviderRoute = "closed-api",
            IdempotencyKey = NormalizeBlank(request.IdempotencyKey) ??
                $"toolbox:{NormalizeBlank(scope.AccountOwnerType) ?? "user"}:{NormalizeBlank(scope.AccountOwnerId) ?? "guest"}:{actionCode}:{Guid.NewGuid():N}",
            CreatedByUserId = actor,
            MaxAttempts = 3,
            TimeoutSeconds = 1800,
            Payload = payloadElement,
        }, cancellationToken) ?? throw new InvalidOperationException("Failed to create toolbox job.");

        var run = await UpsertRunAsync(scope, actor, actionCode, payload, job, cancellationToken);
        return BuildAcceptedResult(actionCode, request, job, run);
    }

    private async Task<Dictionary<string, object?>?> UpsertRunAsync(
        AccountScope scope,
        string actorId,
        string actionCode,
        Dictionary<string, object?> payload,
        Dictionary<string, object?> job,
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(job["id"]?.ToString(), out var jobId))
        {
            return null;
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var accountId = await accounts.EnsureAccountAsync(connection, transaction, scope, cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO toolbox_runs (
              account_id, job_id, actor_id, capability_code, input_summary,
              status, payload, created_at, updated_at
            )
            VALUES (
              @accountId, @jobId, @actorId, @capabilityCode, @inputSummary,
              'queued', @payload::jsonb, now(), now()
            )
            ON CONFLICT (job_id) DO UPDATE SET
              actor_id = EXCLUDED.actor_id,
              input_summary = EXCLUDED.input_summary,
              payload = EXCLUDED.payload,
              updated_at = now()
            RETURNING *, payload::text AS payload_json
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("jobId", NpgsqlDbType.Uuid, jobId);
        command.Parameters.AddWithValue("actorId", NpgsqlDbType.Text, actorId);
        command.Parameters.AddWithValue("capabilityCode", NpgsqlDbType.Text, actionCode);
        command.Parameters.AddWithValue("inputSummary", NpgsqlDbType.Text, payload["inputSummary"]?.ToString() ?? actionCode);
        command.Parameters.AddWithValue("payload", NpgsqlDbType.Jsonb, JsonSerializer.Serialize(payload, JsonOptions));

        var run = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return run;
    }

    private static Dictionary<string, object?> BuildAcceptedResult(
        string actionCode,
        ToolboxRunRequest request,
        Dictionary<string, object?> job,
        Dictionary<string, object?>? run)
    {
        var taskId = job["id"]?.ToString() ?? "";
        var result = new Dictionary<string, object?>
        {
            ["taskId"] = taskId,
            ["status"] = job["status"]?.ToString() ?? JobStatuses.Queued,
            ["capability"] = actionCode,
            ["job"] = job,
            ["run"] = run,
        };

        if (actionCode == "video_reverse_prompt")
        {
            result["prompt"] = NormalizeBlank(request.Prompt) ?? $"Reverse prompt job queued: {taskId}";
            result["model"] = NormalizeBlank(request.Model) ?? "canonical-job";
        }
        else if (actionCode == "storyboard_grid25")
        {
            result["imageUrl"] = "";
            result["model"] = NormalizeBlank(request.Model) ?? "canonical-job";
        }
        else if (actionCode == "translate_text")
        {
            result["text"] = NormalizeBlank(request.Text) ?? "";
            result["targetLang"] = NormalizeBlank(request.TargetLang) ?? "zh";
        }

        return result;
    }

    private static Dictionary<string, object?> BuildPayload(
        string actionCode,
        string jobType,
        ToolboxRunRequest request)
    {
        var payload = new Dictionary<string, object?>
        {
            ["type"] = jobType,
            ["jobType"] = jobType,
            ["domain"] = "toolbox",
            ["actionCode"] = actionCode,
            ["inputSummary"] = BuildInputSummary(actionCode, request),
        };

        AddIfPresent(payload, "projectId", request.ProjectId);
        AddIfPresent(payload, "storyboardId", request.StoryboardId);
        AddIfPresent(payload, "target", request.Target);
        AddIfPresent(payload, "note", request.Note);
        AddIfPresent(payload, "text", request.Text);
        AddIfPresent(payload, "targetLang", request.TargetLang);
        AddIfPresent(payload, "videoUrl", request.VideoUrl);
        AddIfPresent(payload, "prompt", request.Prompt);
        AddIfPresent(payload, "model", request.Model);
        AddIfPresent(payload, "plotText", request.PlotText);
        AddJsonIfPresent(payload, "references", request.References);
        AddJsonIfPresent(payload, "payload", request.Payload);
        return payload;
    }

    private static string BuildInputSummary(string actionCode, ToolboxRunRequest request)
    {
        return NormalizeBlank(request.Note)
            ?? NormalizeBlank(request.Target)
            ?? NormalizeBlank(request.Prompt)
            ?? NormalizeBlank(request.PlotText)
            ?? NormalizeBlank(request.Text)
            ?? NormalizeBlank(request.VideoUrl)
            ?? NormalizeBlank(request.StoryboardId)
            ?? NormalizeBlank(request.ProjectId)
            ?? actionCode;
    }

    private static Dictionary<string, object?> MapCapability(Dictionary<string, object?> row)
    {
        var mapped = new Dictionary<string, object?>
        {
            ["code"] = row["code"]?.ToString() ?? "",
            ["name"] = row["name"]?.ToString() ?? "",
            ["status"] = row["status"]?.ToString() ?? "",
            ["queue"] = row["queue"]?.ToString() ?? "",
            ["description"] = row["description"]?.ToString() ?? "",
        };

        if (NormalizeBlank(row["data_json"]?.ToString()) is { } dataJson)
        {
            mapped["data"] = JsonSerializer.Deserialize<Dictionary<string, object?>>(dataJson, JsonOptions);
        }

        return mapped;
    }

    private static void AddIfPresent(Dictionary<string, object?> payload, string key, string? value)
    {
        if (NormalizeBlank(value) is { } normalized)
        {
            payload[key] = normalized;
        }
    }

    private static void AddJsonIfPresent(Dictionary<string, object?> payload, string key, JsonElement value)
    {
        if (value.ValueKind is not JsonValueKind.Undefined and not JsonValueKind.Null)
        {
            payload[key] = value;
        }
    }

    private static string NormalizeActorId(string? actorId)
    {
        return NormalizeBlank(actorId) ?? "guest";
    }

    private static string? NormalizeBlank(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }
}
