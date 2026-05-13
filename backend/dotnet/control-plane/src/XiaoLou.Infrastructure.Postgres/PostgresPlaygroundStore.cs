using System.Text.Json;
using System.Text.Json.Nodes;
using XiaoLou.Domain;
using Npgsql;
using NpgsqlTypes;

namespace XiaoLou.Infrastructure.Postgres;

public sealed class PostgresPlaygroundStore(
    NpgsqlDataSource dataSource,
    PostgresAccountStore accounts,
    PostgresJobQueue jobs)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private const string DefaultModelId = "qwen-plus";

    private static readonly IReadOnlyList<Dictionary<string, object?>> DefaultModels =
    [
        new()
        {
            ["id"] = "qwen-plus",
            ["name"] = "Qwen Plus",
            ["provider"] = "canonical-control-api",
            ["description"] = "Default Windows-native text playground model routed through canonical jobs.",
            ["configured"] = true,
            ["default"] = true,
        },
        new()
        {
            ["id"] = "doubao-pro",
            ["name"] = "Doubao Pro",
            ["provider"] = "canonical-control-api",
            ["description"] = "Alternative text playground model routed through canonical jobs.",
            ["configured"] = true,
            ["default"] = false,
        },
    ];

    public Dictionary<string, object?> ListModels()
    {
        return new Dictionary<string, object?>
        {
            ["defaultModel"] = DefaultModelId,
            ["items"] = DefaultModels,
        };
    }

    public async Task<Dictionary<string, object?>> GetConfigAsync(AccountScope scope, CancellationToken cancellationToken)
    {
        return new Dictionary<string, object?>
        {
            ["defaultModel"] = DefaultModelId,
            ["models"] = DefaultModels,
            ["memory"] = await GetMemoryPreferenceAsync(scope, cancellationToken),
        };
    }

    public async Task<IReadOnlyList<Dictionary<string, object?>>> ListConversationsAsync(
        AccountScope scope,
        string? search,
        int limit,
        CancellationToken cancellationToken)
    {
        var accountId = await EnsureAccountIdAsync(scope, cancellationToken);
        var normalizedSearch = NormalizeBlank(search);

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT
              pc.*,
              a.legacy_owner_type AS account_owner_type,
              a.legacy_owner_id AS account_owner_id,
              pc.data::text AS data_json
            FROM playground_conversations pc
            JOIN accounts a ON a.id = pc.account_id
            WHERE pc.account_id = @accountId
              AND pc.archived = false
              AND (
                @search IS NULL
                OR pc.title ILIKE '%' || @search || '%'
                OR pc.model ILIKE '%' || @search || '%'
              )
            ORDER BY COALESCE(
              CASE WHEN pc.last_message_at::text ~ '^\d{4}-\d{2}-\d{2}' THEN pc.last_message_at::text::timestamptz END,
              CASE WHEN pc.updated_at::text ~ '^\d{4}-\d{2}-\d{2}' THEN pc.updated_at::text::timestamptz END,
              CASE WHEN pc.created_at::text ~ '^\d{4}-\d{2}-\d{2}' THEN pc.created_at::text::timestamptz END,
              '-infinity'::timestamptz
            ) DESC,
            CASE WHEN pc.created_at::text ~ '^\d{4}-\d{2}-\d{2}' THEN pc.created_at::text::timestamptz END DESC NULLS LAST
            LIMIT @limit
            """,
            connection);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("search", NpgsqlDbType.Text, (object?)normalizedSearch ?? DBNull.Value);
        command.Parameters.AddWithValue("limit", NpgsqlDbType.Integer, Math.Clamp(limit, 1, 200));

        return (await PostgresRows.ReadManyAsync(command, cancellationToken))
            .Select(MapConversation)
            .ToArray();
    }

    public async Task<Dictionary<string, object?>> CreateConversationAsync(
        AccountScope scope,
        string actorId,
        PlaygroundConversationRequest request,
        CancellationToken cancellationToken)
    {
        var accountId = await EnsureAccountIdAsync(scope, cancellationToken);
        var id = NormalizeId(request.Id) ?? CreateId("playground-conversation");
        var title = NormalizeBlank(request.Title) ?? "Untitled chat";
        var model = NormalizeModel(request.Model);
        var actor = NormalizeActorId(actorId);
        var data = JsonSerializer.Serialize(new Dictionary<string, object?>
        {
            ["source"] = "control_api_canonical",
        }, JsonOptions);

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO playground_conversations (
              id, account_id, actor_id, title, model, data, created_at, updated_at
            )
            VALUES (@id, @accountId, @actorId, @title, @model, @data::jsonb, now(), now())
            ON CONFLICT (id) DO UPDATE SET
              title = EXCLUDED.title,
              model = EXCLUDED.model,
              actor_id = EXCLUDED.actor_id,
              updated_at = now()
            WHERE playground_conversations.account_id = @accountId
            RETURNING *, data::text AS data_json
            """,
            connection);
        command.Parameters.AddWithValue("id", NpgsqlDbType.Text, id);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("actorId", NpgsqlDbType.Text, actor);
        command.Parameters.AddWithValue("title", NpgsqlDbType.Text, title);
        command.Parameters.AddWithValue("model", NpgsqlDbType.Text, model);
        command.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, data);

        var row = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        if (row is null)
        {
            throw new UnauthorizedAccessException("Playground conversation is owned by another account.");
        }

        return MapConversation(row);
    }

    public async Task<Dictionary<string, object?>?> GetConversationAsync(
        AccountScope scope,
        string conversationId,
        CancellationToken cancellationToken)
    {
        var accountId = await EnsureAccountIdAsync(scope, cancellationToken);
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT
              pc.*,
              a.legacy_owner_type AS account_owner_type,
              a.legacy_owner_id AS account_owner_id,
              pc.data::text AS data_json
            FROM playground_conversations pc
            JOIN accounts a ON a.id = pc.account_id
            WHERE pc.account_id = @accountId
              AND pc.id = @conversationId
              AND pc.archived = false
            """,
            connection);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("conversationId", NpgsqlDbType.Text, conversationId);

        var row = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        return row is null ? null : MapConversation(row);
    }

    public async Task<Dictionary<string, object?>?> UpdateConversationAsync(
        AccountScope scope,
        string conversationId,
        PlaygroundConversationRequest request,
        CancellationToken cancellationToken)
    {
        var accountId = await EnsureAccountIdAsync(scope, cancellationToken);
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            UPDATE playground_conversations
            SET title = COALESCE(@title, title),
                model = COALESCE(@model, model),
                updated_at = now()
            WHERE account_id = @accountId
              AND id = @conversationId
              AND archived = false
            RETURNING *, data::text AS data_json
            """,
            connection);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("conversationId", NpgsqlDbType.Text, conversationId);
        command.Parameters.AddWithValue("title", NpgsqlDbType.Text, (object?)NormalizeBlank(request.Title) ?? DBNull.Value);
        command.Parameters.AddWithValue("model", NpgsqlDbType.Text, (object?)NormalizeBlank(request.Model) ?? DBNull.Value);

        var row = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        return row is null ? null : MapConversation(row);
    }

    public async Task<bool> DeleteConversationAsync(
        AccountScope scope,
        string conversationId,
        CancellationToken cancellationToken)
    {
        var accountId = await EnsureAccountIdAsync(scope, cancellationToken);
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            "DELETE FROM playground_conversations WHERE account_id = @accountId AND id = @conversationId",
            connection);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("conversationId", NpgsqlDbType.Text, conversationId);
        return await command.ExecuteNonQueryAsync(cancellationToken) > 0;
    }

    public async Task<IReadOnlyList<Dictionary<string, object?>>> ListMessagesAsync(
        AccountScope scope,
        string conversationId,
        CancellationToken cancellationToken)
    {
        var accountId = await EnsureAccountIdAsync(scope, cancellationToken);
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT pm.*, pm.metadata::text AS metadata_json
            FROM playground_messages pm
            JOIN playground_conversations pc ON pc.id = pm.conversation_id
            WHERE pm.account_id = @accountId
              AND pm.conversation_id = @conversationId
              AND pc.account_id = @accountId
              AND pc.archived = false
            ORDER BY pm.created_at ASC, pm.id ASC
            LIMIT 500
            """,
            connection);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("conversationId", NpgsqlDbType.Text, conversationId);

        return (await PostgresRows.ReadManyAsync(command, cancellationToken))
            .Select(MapMessage)
            .ToArray();
    }

    public async Task<Dictionary<string, object?>> StartChatJobAsync(
        AccountScope scope,
        string actorId,
        PlaygroundChatRequest request,
        CancellationToken cancellationToken)
    {
        var message = NormalizeBlank(request.Message);
        if (message is null)
        {
            throw new ArgumentException("Playground message is required.", nameof(request));
        }

        var model = NormalizeModel(request.Model);
        var actor = NormalizeActorId(actorId);
        var now = DateTimeOffset.UtcNow;
        var conversationId = NormalizeId(request.ConversationId) ?? CreateId("playground-conversation");
        var userMessageId = CreateId("playground-message");
        var assistantMessageId = CreateId("playground-message");
        Dictionary<string, object?> conversation;
        Dictionary<string, object?> userMessage;
        Dictionary<string, object?> assistantMessage;

        await using (var connection = await dataSource.OpenConnectionAsync(cancellationToken))
        await using (var transaction = await connection.BeginTransactionAsync(cancellationToken))
        {
            var accountId = await accounts.EnsureAccountAsync(connection, transaction, scope, cancellationToken);
            await PostgresAccountStore.LockAccountLaneAsync(
                connection,
                transaction,
                accountId,
                AccountLanes.Control,
                cancellationToken);

            await UpsertChatConversationAsync(
                connection,
                transaction,
                accountId,
                actor,
                conversationId,
                message,
                model,
                now,
                cancellationToken);

            userMessage = await InsertMessageAsync(
                connection,
                transaction,
                accountId,
                actor,
                conversationId,
                userMessageId,
                "user",
                message,
                model,
                "succeeded",
                new Dictionary<string, object?> { ["source"] = "control_api_canonical" },
                now,
                cancellationToken);

            assistantMessage = await InsertMessageAsync(
                connection,
                transaction,
                accountId,
                actor,
                conversationId,
                assistantMessageId,
                "assistant",
                "",
                model,
                "queued",
                new Dictionary<string, object?> { ["queuedThrough"] = "canonical-control-api" },
                now,
                cancellationToken);

            await UpdateConversationCountersAsync(connection, transaction, accountId, conversationId, now, cancellationToken);
            conversation = await SelectConversationAsync(connection, transaction, accountId, conversationId, cancellationToken)
                ?? throw new InvalidOperationException("Failed to reload playground conversation.");
            await transaction.CommitAsync(cancellationToken);
        }

        var payload = new Dictionary<string, object?>
        {
            ["conversationId"] = conversationId,
            ["userMessageId"] = userMessageId,
            ["assistantMessageId"] = assistantMessageId,
            ["message"] = message,
            ["model"] = model,
            ["type"] = "playground_chat",
            ["jobType"] = "playground_chat",
            ["domain"] = "playground",
            ["actionCode"] = "playground_chat",
            ["inputSummary"] = message,
        };
        var job = await jobs.CreateJobAsync(new CreateJobRequest
        {
            AccountOwnerType = scope.AccountOwnerType,
            AccountOwnerId = scope.AccountOwnerId,
            RegionCode = scope.RegionCode,
            Currency = scope.Currency,
            Lane = AccountLanes.Control,
            JobType = "playground_chat",
            ProviderRoute = "closed-api",
            IdempotencyKey = $"playground:{conversationId}:{userMessageId}",
            CreatedByUserId = actor,
            MaxAttempts = 3,
            TimeoutSeconds = 1800,
            Payload = JsonSerializer.SerializeToElement(payload, JsonOptions),
        }, cancellationToken) ?? throw new InvalidOperationException("Failed to create playground chat job.");

        assistantMessage = await AttachJobToAssistantMessageAsync(scope, conversationId, assistantMessageId, job["id"]?.ToString(), cancellationToken)
            ?? assistantMessage;

        return new Dictionary<string, object?>
        {
            ["job"] = MapPlaygroundJob(job),
            ["conversation"] = conversation,
            ["userMessage"] = userMessage,
            ["assistantMessage"] = assistantMessage,
        };
    }

    public async Task<IReadOnlyList<Dictionary<string, object?>>> ListChatJobsAsync(
        AccountScope scope,
        string? conversationId,
        bool activeOnly,
        string? status,
        int limit,
        CancellationToken cancellationToken)
    {
        var accountId = await EnsureAccountIdAsync(scope, cancellationToken);
        var normalizedConversationId = NormalizeBlank(conversationId);
        var normalizedStatus = NormalizeJobStatus(status);

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand { Connection = connection };
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("limit", NpgsqlDbType.Integer, Math.Clamp(limit, 1, 200));
        var filters = new List<string>
        {
            "j.account_id = @accountId",
            "j.job_type = 'playground_chat'",
        };

        if (normalizedConversationId is not null)
        {
            filters.Add("j.payload->>'conversationId' = @conversationId");
            command.Parameters.AddWithValue("conversationId", NpgsqlDbType.Text, normalizedConversationId);
        }

        if (normalizedStatus is not null)
        {
            filters.Add("j.status = CAST(@status AS job_status)");
            command.Parameters.AddWithValue("status", NpgsqlDbType.Text, normalizedStatus);
        }
        else if (activeOnly)
        {
            filters.Add("j.status IN ('queued', 'leased', 'running', 'retry_waiting')");
        }

        command.CommandText =
            $"""
            SELECT
              j.*,
              a.legacy_owner_type AS account_owner_type,
              a.legacy_owner_id AS account_owner_id,
              j.payload::text AS payload_json,
              j.result::text AS result_json
            FROM jobs j
            JOIN accounts a ON a.id = j.account_id
            WHERE {string.Join(" AND ", filters)}
            ORDER BY j.created_at DESC
            LIMIT @limit
            """;

        return (await PostgresRows.ReadManyAsync(command, cancellationToken))
            .Select(MapPlaygroundJob)
            .ToArray();
    }

    public async Task<Dictionary<string, object?>?> GetChatJobAsync(
        AccountScope scope,
        Guid jobId,
        CancellationToken cancellationToken)
    {
        var accountId = await EnsureAccountIdAsync(scope, cancellationToken);
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT
              j.*,
              a.legacy_owner_type AS account_owner_type,
              a.legacy_owner_id AS account_owner_id,
              j.payload::text AS payload_json,
              j.result::text AS result_json
            FROM jobs j
            JOIN accounts a ON a.id = j.account_id
            WHERE j.account_id = @accountId
              AND j.id = @jobId
              AND j.job_type = 'playground_chat'
            """,
            connection);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("jobId", NpgsqlDbType.Uuid, jobId);

        var row = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        return row is null ? null : MapPlaygroundJob(row);
    }

    public Task<Dictionary<string, object?>> ListMemoriesAsync(AccountScope scope, CancellationToken cancellationToken)
    {
        return ListMemoriesAsync(scope, search: null, enabled: null, limit: 200, offset: 0, cancellationToken);
    }

    public async Task<Dictionary<string, object?>> ListMemoriesAsync(
        AccountScope scope,
        string? search,
        bool? enabled,
        int limit,
        int offset,
        CancellationToken cancellationToken)
    {
        var accountId = await EnsureAccountIdAsync(scope, cancellationToken);
        var normalizedSearch = NormalizeBlank(search);
        var normalizedLimit = NormalizeLimit(limit, 1, 200);
        var normalizedOffset = NormalizeOffset(offset);

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand { Connection = connection };
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("limit", NpgsqlDbType.Integer, normalizedLimit + 1);
        command.Parameters.AddWithValue("offset", NpgsqlDbType.Integer, normalizedOffset);
        var filters = new List<string> { "account_id = @accountId" };

        if (normalizedSearch is not null)
        {
            filters.Add("(key ILIKE '%' || @search || '%' OR value ILIKE '%' || @search || '%' OR memory_key ILIKE '%' || @search || '%' OR memory_value ILIKE '%' || @search || '%')");
            command.Parameters.AddWithValue("search", NpgsqlDbType.Text, normalizedSearch);
        }

        if (enabled.HasValue)
        {
            filters.Add("enabled = @enabled");
            command.Parameters.AddWithValue("enabled", NpgsqlDbType.Boolean, enabled.Value);
        }

        command.CommandText =
            $"""
            SELECT *, data::text AS data_json
            FROM playground_memories
            WHERE {string.Join(" AND ", filters)}
            ORDER BY updated_at DESC, key ASC
            LIMIT @limit OFFSET @offset
            """;

        var rows = await PostgresRows.ReadManyAsync(command, cancellationToken);
        var items = rows.Take(normalizedLimit).Select(MapMemory).ToArray();

        return new Dictionary<string, object?>
        {
            ["preference"] = await GetMemoryPreferenceAsync(scope, cancellationToken),
            ["items"] = items,
            ["limit"] = normalizedLimit,
            ["offset"] = normalizedOffset,
            ["hasMore"] = rows.Count > normalizedLimit,
            ["filter"] = new Dictionary<string, object?>
            {
                ["search"] = normalizedSearch,
                ["enabled"] = enabled,
            },
        };
    }

    public async Task<Dictionary<string, object?>> UpdateMemoryPreferenceAsync(
        AccountScope scope,
        PlaygroundMemoryPreferenceRequest request,
        CancellationToken cancellationToken)
    {
        var accountId = await EnsureAccountIdAsync(scope, cancellationToken);
        var enabled = request.Enabled ?? true;
        var actorId = NormalizeActorId(scope.AccountOwnerId);
        var data = JsonSerializer.Serialize(new Dictionary<string, object?>
        {
            ["source"] = "control_api_canonical",
            ["actorId"] = actorId,
        }, JsonOptions);
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO playground_memory_preferences (account_id, actor_id, enabled, data, updated_at)
            VALUES (@accountId, @actorId, @enabled, @data::jsonb, now())
            ON CONFLICT (account_id) DO UPDATE SET
              actor_id = EXCLUDED.actor_id,
              enabled = EXCLUDED.enabled,
              data = playground_memory_preferences.data || EXCLUDED.data,
              updated_at = now()
            RETURNING enabled, updated_at
            """,
            connection);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("actorId", NpgsqlDbType.Text, actorId);
        command.Parameters.AddWithValue("enabled", NpgsqlDbType.Boolean, enabled);
        command.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, data);

        return MapMemoryPreference((await PostgresRows.ReadSingleAsync(command, cancellationToken))!);
    }

    public async Task<Dictionary<string, object?>> UpsertMemoryAsync(
        AccountScope scope,
        string key,
        PlaygroundMemoryRequest request,
        CancellationToken cancellationToken)
    {
        var accountId = await EnsureAccountIdAsync(scope, cancellationToken);
        var normalizedKey = NormalizeBlank(request.Key) ?? NormalizeBlank(key);
        if (normalizedKey is null)
        {
            throw new ArgumentException("Playground memory key is required.", nameof(key));
        }

        var data = BuildMemoryDataJson(request);
        var actorId = NormalizeActorId(scope.AccountOwnerId);
        var legacyId = $"{actorId}:{normalizedKey}";
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO playground_memories (
              account_id, id, actor_id, key, value, memory_key, memory_value, enabled,
              confidence, source_conversation_id, source_message_id, data, created_at, updated_at
            )
            VALUES (
              @accountId, @id, @actorId, @key, @value, @key, @value, @enabled,
              @confidence, @sourceConversationId, @sourceMessageId, @data::jsonb, now(), now()
            )
            ON CONFLICT (account_id, key) DO UPDATE SET
              id = EXCLUDED.id,
              actor_id = EXCLUDED.actor_id,
              value = EXCLUDED.value,
              memory_key = EXCLUDED.memory_key,
              memory_value = EXCLUDED.memory_value,
              enabled = EXCLUDED.enabled,
              confidence = COALESCE(EXCLUDED.confidence, playground_memories.confidence),
              source_conversation_id = COALESCE(EXCLUDED.source_conversation_id, playground_memories.source_conversation_id),
              source_message_id = COALESCE(EXCLUDED.source_message_id, playground_memories.source_message_id),
              data = playground_memories.data || EXCLUDED.data,
              updated_at = now()
            RETURNING *, data::text AS data_json
            """,
            connection);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("id", NpgsqlDbType.Text, legacyId);
        command.Parameters.AddWithValue("actorId", NpgsqlDbType.Text, actorId);
        command.Parameters.AddWithValue("key", NpgsqlDbType.Text, normalizedKey);
        command.Parameters.AddWithValue("value", NpgsqlDbType.Text, request.Value ?? "");
        command.Parameters.AddWithValue("enabled", NpgsqlDbType.Boolean, request.Enabled ?? true);
        command.Parameters.Add("confidence", NpgsqlDbType.Numeric).Value = (object?)NormalizeConfidence(request.Confidence) ?? DBNull.Value;
        command.Parameters.AddWithValue("sourceConversationId", NpgsqlDbType.Text, (object?)NormalizeBlank(request.SourceConversationId) ?? DBNull.Value);
        command.Parameters.AddWithValue("sourceMessageId", NpgsqlDbType.Text, (object?)NormalizeBlank(request.SourceMessageId) ?? DBNull.Value);
        command.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, data);

        return MapMemory((await PostgresRows.ReadSingleAsync(command, cancellationToken))!);
    }

    public async Task<Dictionary<string, object?>> GetMemoryVectorIndexAsync(
        AccountScope scope,
        CancellationToken cancellationToken)
    {
        var accountId = await EnsureAccountIdAsync(scope, cancellationToken);
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT
              COUNT(*) AS memory_count,
              COUNT(*) FILTER (WHERE enabled = true) AS enabled_memory_count,
              MAX(updated_at) AS last_memory_updated_at
            FROM playground_memories
            WHERE account_id = @accountId
            """,
            connection);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);

        var row = await PostgresRows.ReadSingleAsync(command, cancellationToken) ?? new Dictionary<string, object?>();
        return BuildMemoryVectorIndex(row);
    }

    public async Task<Dictionary<string, object?>> RebuildMemoryVectorIndexAsync(
        AccountScope scope,
        PlaygroundMemoryVectorRebuildRequest request,
        CancellationToken cancellationToken)
    {
        var vectorIndex = await GetMemoryVectorIndexAsync(scope, cancellationToken);
        return new Dictionary<string, object?>
        {
            ["accepted"] = false,
            ["status"] = "not_configured",
            ["mode"] = "keyword_fallback",
            ["force"] = request.Force == true,
            ["rebuiltAt"] = null,
            ["indexedCount"] = 0,
            ["skippedCount"] = Convert.ToInt64(vectorIndex["enabledMemoryCount"] ?? 0),
            ["diagnostics"] = MemoryVectorDiagnostics(),
            ["vectorIndex"] = vectorIndex,
        };
    }

    public async Task<Dictionary<string, object?>> RecallMemoriesAsync(
        AccountScope scope,
        PlaygroundMemoryRecallRequest request,
        CancellationToken cancellationToken)
    {
        var query = NormalizeBlank(request.Query);
        if (query is null)
        {
            throw new ArgumentException("Playground memory recall query is required.", nameof(request));
        }

        var accountId = await EnsureAccountIdAsync(scope, cancellationToken);
        var normalizedLimit = NormalizeLimit(request.Limit ?? 10, 1, 50);
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT *, data::text AS data_json
            FROM playground_memories
            WHERE account_id = @accountId
              AND (@includeDisabled = true OR enabled = true)
              AND (
                key ILIKE '%' || @query || '%'
                OR value ILIKE '%' || @query || '%'
                OR memory_key ILIKE '%' || @query || '%'
                OR memory_value ILIKE '%' || @query || '%'
              )
            ORDER BY updated_at DESC, key ASC
            LIMIT @limit
            """,
            connection);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("includeDisabled", NpgsqlDbType.Boolean, request.IncludeDisabled == true);
        command.Parameters.AddWithValue("query", NpgsqlDbType.Text, query);
        command.Parameters.AddWithValue("limit", NpgsqlDbType.Integer, normalizedLimit);

        var rows = await PostgresRows.ReadManyAsync(command, cancellationToken);
        var items = rows.Select(row => new Dictionary<string, object?>
        {
            ["memory"] = MapMemory(row),
            ["score"] = KeywordScore(row, query),
            ["reason"] = "keyword_match",
        }).ToArray();

        return new Dictionary<string, object?>
        {
            ["query"] = query,
            ["mode"] = "keyword_fallback",
            ["vectorIndexStatus"] = "not_configured",
            ["embeddingProvider"] = "none",
            ["limit"] = normalizedLimit,
            ["includeDisabled"] = request.IncludeDisabled == true,
            ["items"] = items,
            ["diagnostics"] = MemoryVectorDiagnostics(),
        };
    }

    public async Task<bool> DeleteMemoryAsync(
        AccountScope scope,
        string key,
        CancellationToken cancellationToken)
    {
        var accountId = await EnsureAccountIdAsync(scope, cancellationToken);
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            "DELETE FROM playground_memories WHERE account_id = @accountId AND key = @key",
            connection);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("key", NpgsqlDbType.Text, key);
        return await command.ExecuteNonQueryAsync(cancellationToken) > 0;
    }

    private async Task<Guid> EnsureAccountIdAsync(AccountScope scope, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var accountId = await accounts.EnsureAccountAsync(connection, transaction, scope, cancellationToken);
        await PostgresAccountStore.LockAccountLaneAsync(connection, transaction, accountId, AccountLanes.Control, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return accountId;
    }

    private async Task<Dictionary<string, object?>> GetMemoryPreferenceAsync(
        AccountScope scope,
        CancellationToken cancellationToken)
    {
        var accountId = await EnsureAccountIdAsync(scope, cancellationToken);
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            "SELECT enabled, updated_at FROM playground_memory_preferences WHERE account_id = @accountId",
            connection);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);

        var row = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        return row is null
            ? new Dictionary<string, object?> { ["enabled"] = true, ["updatedAt"] = null }
            : MapMemoryPreference(row);
    }

    private static async Task UpsertChatConversationAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid accountId,
        string actorId,
        string conversationId,
        string message,
        string model,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var data = JsonSerializer.Serialize(new Dictionary<string, object?>
        {
            ["source"] = "control_api_canonical",
        }, JsonOptions);
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO playground_conversations (
              id, account_id, actor_id, title, model, data, last_message_at, created_at, updated_at
            )
            VALUES (@id, @accountId, @actorId, @title, @model, @data::jsonb, @now, @now, @now)
            ON CONFLICT (id) DO UPDATE SET
              model = EXCLUDED.model,
              actor_id = EXCLUDED.actor_id,
              title = COALESCE(NULLIF(playground_conversations.title, ''), EXCLUDED.title),
              last_message_at = EXCLUDED.last_message_at,
              updated_at = EXCLUDED.updated_at
            WHERE playground_conversations.account_id = @accountId
            RETURNING id
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("id", NpgsqlDbType.Text, conversationId);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("actorId", NpgsqlDbType.Text, actorId);
        command.Parameters.AddWithValue("title", NpgsqlDbType.Text, FirstLineTitle(message));
        command.Parameters.AddWithValue("model", NpgsqlDbType.Text, model);
        command.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, data);
        command.Parameters.AddWithValue("now", NpgsqlDbType.TimestampTz, now);

        if (await command.ExecuteScalarAsync(cancellationToken) is null)
        {
            throw new UnauthorizedAccessException("Playground conversation is owned by another account.");
        }
    }

    private static async Task<Dictionary<string, object?>> InsertMessageAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid accountId,
        string actorId,
        string conversationId,
        string messageId,
        string role,
        string content,
        string model,
        string status,
        Dictionary<string, object?> metadata,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO playground_messages (
              id, conversation_id, account_id, actor_id, role, content, model, status, metadata, data, created_at, updated_at
            )
            VALUES (
              @id, @conversationId, @accountId, @actorId, @role, @content, @model, @status, @metadata::jsonb, @metadata::jsonb, @now, @now
            )
            RETURNING *, metadata::text AS metadata_json
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("id", NpgsqlDbType.Text, messageId);
        command.Parameters.AddWithValue("conversationId", NpgsqlDbType.Text, conversationId);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("actorId", NpgsqlDbType.Text, actorId);
        command.Parameters.AddWithValue("role", NpgsqlDbType.Text, role);
        command.Parameters.AddWithValue("content", NpgsqlDbType.Text, content);
        command.Parameters.AddWithValue("model", NpgsqlDbType.Text, model);
        command.Parameters.AddWithValue("status", NpgsqlDbType.Text, status);
        command.Parameters.AddWithValue("metadata", NpgsqlDbType.Jsonb, JsonSerializer.Serialize(metadata, JsonOptions));
        command.Parameters.AddWithValue("now", NpgsqlDbType.TimestampTz, now);

        return MapMessage((await PostgresRows.ReadSingleAsync(command, cancellationToken))!);
    }

    private static async Task UpdateConversationCountersAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid accountId,
        string conversationId,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            """
            UPDATE playground_conversations
            SET message_count = (
                  SELECT COUNT(*)
                  FROM playground_messages
                  WHERE conversation_id = @conversationId
                    AND account_id = @accountId
                ),
                last_message_at = @now,
                updated_at = @now
            WHERE id = @conversationId
              AND account_id = @accountId
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("conversationId", NpgsqlDbType.Text, conversationId);
        command.Parameters.AddWithValue("now", NpgsqlDbType.TimestampTz, now);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task<Dictionary<string, object?>?> SelectConversationAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid accountId,
        string conversationId,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            """
            SELECT *, data::text AS data_json
            FROM playground_conversations
            WHERE account_id = @accountId
              AND id = @conversationId
              AND archived = false
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("conversationId", NpgsqlDbType.Text, conversationId);
        var row = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        return row is null ? null : MapConversation(row);
    }

    private async Task<Dictionary<string, object?>?> AttachJobToAssistantMessageAsync(
        AccountScope scope,
        string conversationId,
        string assistantMessageId,
        string? jobId,
        CancellationToken cancellationToken)
    {
        var accountId = await EnsureAccountIdAsync(scope, cancellationToken);
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            UPDATE playground_messages
            SET metadata = metadata || @metadata::jsonb,
                updated_at = now()
            WHERE account_id = @accountId
              AND conversation_id = @conversationId
              AND id = @messageId
            RETURNING *, metadata::text AS metadata_json
            """,
            connection);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("conversationId", NpgsqlDbType.Text, conversationId);
        command.Parameters.AddWithValue("messageId", NpgsqlDbType.Text, assistantMessageId);
        command.Parameters.AddWithValue("metadata", NpgsqlDbType.Jsonb, JsonSerializer.Serialize(new Dictionary<string, object?>
        {
            ["jobId"] = jobId,
        }, JsonOptions));

        var row = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        return row is null ? null : MapMessage(row);
    }

    private static Dictionary<string, object?> MapConversation(Dictionary<string, object?> row)
    {
        return new Dictionary<string, object?>
        {
            ["id"] = AsString(row, "id") ?? "",
            ["actorId"] = AsString(row, "actor_id") ?? "guest",
            ["title"] = AsString(row, "title") ?? "Untitled chat",
            ["model"] = AsString(row, "model") ?? DefaultModelId,
            ["messageCount"] = AsInt(row, "message_count"),
            ["archived"] = AsBool(row, "archived"),
            ["data"] = ParseJsonObject(AsString(row, "data_json") ?? AsString(row, "data")),
            ["createdAt"] = ToIso(row.TryGetValue("created_at", out var createdAt) ? createdAt : null),
            ["updatedAt"] = ToIso(row.TryGetValue("updated_at", out var updatedAt) ? updatedAt : null),
            ["lastMessageAt"] = ToIso(row.TryGetValue("last_message_at", out var lastMessageAt) ? lastMessageAt : null),
            ["accountId"] = AsString(row, "account_id"),
            ["accountOwnerType"] = AsString(row, "account_owner_type"),
            ["accountOwnerId"] = AsString(row, "account_owner_id"),
        };
    }

    private static Dictionary<string, object?> MapMessage(Dictionary<string, object?> row)
    {
        return new Dictionary<string, object?>
        {
            ["id"] = AsString(row, "id") ?? "",
            ["conversationId"] = AsString(row, "conversation_id") ?? "",
            ["actorId"] = AsString(row, "actor_id") ?? "guest",
            ["role"] = AsString(row, "role") ?? "assistant",
            ["content"] = AsString(row, "content") ?? "",
            ["model"] = AsString(row, "model"),
            ["status"] = AsString(row, "status") ?? "succeeded",
            ["metadata"] = ParseJsonObject(AsString(row, "metadata_json") ?? AsString(row, "metadata")),
            ["createdAt"] = ToIso(row.TryGetValue("created_at", out var createdAt) ? createdAt : null),
            ["updatedAt"] = ToIso(row.TryGetValue("updated_at", out var updatedAt) ? updatedAt : null),
        };
    }

    private static Dictionary<string, object?> MapMemory(Dictionary<string, object?> row)
    {
        return new Dictionary<string, object?>
        {
            ["key"] = AsString(row, "key") ?? AsString(row, "memory_key") ?? "",
            ["value"] = AsString(row, "value") ?? AsString(row, "memory_value") ?? "",
            ["enabled"] = AsBool(row, "enabled", true),
            ["confidence"] = AsDecimal(row, "confidence"),
            ["sourceConversationId"] = AsString(row, "source_conversation_id"),
            ["sourceMessageId"] = AsString(row, "source_message_id"),
            ["data"] = ParseJsonObject(AsString(row, "data_json") ?? AsString(row, "data")),
            ["createdAt"] = ToIso(row.TryGetValue("created_at", out var createdAt) ? createdAt : null),
            ["updatedAt"] = ToIso(row.TryGetValue("updated_at", out var updatedAt) ? updatedAt : null),
        };
    }

    private static Dictionary<string, object?> MapMemoryPreference(Dictionary<string, object?> row)
    {
        return new Dictionary<string, object?>
        {
            ["enabled"] = AsBool(row, "enabled", true),
            ["updatedAt"] = ToIso(row.TryGetValue("updated_at", out var updatedAt) ? updatedAt : null),
        };
    }

    private static Dictionary<string, object?> MapPlaygroundJob(Dictionary<string, object?> row)
    {
        var payload = ParseJsonObject(AsString(row, "payload_json") ?? AsString(row, "payload"));
        var result = ParseJsonObject(AsString(row, "result_json") ?? AsString(row, "result"));
        var status = AsString(row, "status") ?? "queued";
        return new Dictionary<string, object?>
        {
            ["id"] = AsString(row, "id") ?? "",
            ["actorId"] = AsString(row, "created_by_user_id") ?? ReadJsonString(payload, "actorId") ?? "guest",
            ["conversationId"] = ReadJsonString(payload, "conversationId") ?? "",
            ["userMessageId"] = ReadJsonString(payload, "userMessageId"),
            ["assistantMessageId"] = ReadJsonString(payload, "assistantMessageId"),
            ["model"] = ReadJsonString(payload, "model") ?? DefaultModelId,
            ["status"] = NormalizePlaygroundJobStatus(status),
            ["progress"] = ProgressForStatus(status),
            ["request"] = payload,
            ["result"] = result.Count == 0 ? null : result,
            ["error"] = BuildJobError(row, status),
            ["createdAt"] = ToIso(row.TryGetValue("created_at", out var createdAt) ? createdAt : null),
            ["startedAt"] = ToIso(row.TryGetValue("started_at", out var startedAt) ? startedAt : null),
            ["finishedAt"] = ToIso(row.TryGetValue("completed_at", out var completedAt) ? completedAt : null),
            ["updatedAt"] = ToIso(row.TryGetValue("updated_at", out var updatedAt) ? updatedAt : null),
            ["accountId"] = AsString(row, "account_id"),
            ["accountOwnerType"] = AsString(row, "account_owner_type"),
            ["accountOwnerId"] = AsString(row, "account_owner_id"),
        };
    }

    private static Dictionary<string, object?>? BuildJobError(Dictionary<string, object?> row, string status)
    {
        var error = AsString(row, "last_error");
        if (string.IsNullOrWhiteSpace(error) && status is not ("failed" or "cancelled"))
        {
            return null;
        }

        return new Dictionary<string, object?>
        {
            ["message"] = error ?? status,
        };
    }

    private static string NormalizeModel(string? model)
    {
        return NormalizeBlank(model) ?? DefaultModelId;
    }

    private static string NormalizeActorId(string? actorId)
    {
        return NormalizeBlank(actorId) ?? "guest";
    }

    private static string? NormalizeId(string? value)
    {
        var normalized = NormalizeBlank(value);
        return normalized is null ? null : normalized[..Math.Min(normalized.Length, 160)];
    }

    private static string? NormalizeBlank(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    private static string FirstLineTitle(string message)
    {
        var firstLine = message.Replace('\r', '\n').Split('\n', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()
            ?? "Untitled chat";
        return firstLine[..Math.Min(firstLine.Length, 48)];
    }

    private static string CreateId(string prefix)
    {
        return $"{prefix}-{Guid.NewGuid():N}";
    }

    private static string? NormalizeJobStatus(string? status)
    {
        var normalized = NormalizeBlank(status)?.ToLowerInvariant();
        return normalized is "queued" or "leased" or "running" or "succeeded" or "failed" or "cancelled" or "retry_waiting"
            ? normalized
            : null;
    }

    private static string NormalizePlaygroundJobStatus(string status)
    {
        return status is "running" or "succeeded" or "failed" or "cancelled" ? status : "queued";
    }

    private static int ProgressForStatus(string status)
    {
        return status switch
        {
            "succeeded" or "failed" or "cancelled" => 100,
            "running" => 60,
            "leased" => 35,
            "retry_waiting" => 20,
            _ => 0,
        };
    }

    private static string BuildMemoryDataJson(PlaygroundMemoryRequest request)
    {
        var data = new JsonObject();
        if (request.Data.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in request.Data.EnumerateObject())
            {
                data[property.Name] = JsonNode.Parse(property.Value.GetRawText());
            }
        }
        else if (request.Data.ValueKind != JsonValueKind.Undefined && request.Data.ValueKind != JsonValueKind.Null)
        {
            data["payload"] = JsonNode.Parse(request.Data.GetRawText());
        }

        data["source"] = "control_api_canonical";
        data["contractOwner"] = "dotnet-playground-memory";
        return data.ToJsonString(JsonOptions);
    }

    private static Dictionary<string, object?> BuildMemoryVectorIndex(Dictionary<string, object?> row)
    {
        var memoryCount = AsLong(row, "memory_count");
        var enabledMemoryCount = AsLong(row, "enabled_memory_count");
        return new Dictionary<string, object?>
        {
            ["available"] = false,
            ["status"] = "not_configured",
            ["mode"] = "keyword_fallback",
            ["embeddingProvider"] = "none",
            ["dimensions"] = null,
            ["memoryCount"] = memoryCount,
            ["enabledMemoryCount"] = enabledMemoryCount,
            ["indexedCount"] = 0,
            ["staleCount"] = enabledMemoryCount,
            ["lastMemoryUpdatedAt"] = ToIso(row.TryGetValue("last_memory_updated_at", out var updatedAt) ? updatedAt : null),
            ["lastIndexedAt"] = null,
            ["diagnostics"] = MemoryVectorDiagnostics(),
        };
    }

    private static Dictionary<string, object?> MemoryVectorDiagnostics()
    {
        return new Dictionary<string, object?>
        {
            ["code"] = "PLAYGROUND_MEMORY_VECTOR_INDEX_NOT_CONFIGURED",
            ["message"] = "Playground memory vector routes are owned by the .NET contract; no embedding provider or vector index is configured yet.",
            ["fallback"] = "keyword",
        };
    }

    private static decimal KeywordScore(Dictionary<string, object?> row, string query)
    {
        var key = AsString(row, "key") ?? AsString(row, "memory_key") ?? "";
        var value = AsString(row, "value") ?? AsString(row, "memory_value") ?? "";
        if (string.Equals(key, query, StringComparison.OrdinalIgnoreCase))
        {
            return 1m;
        }

        if (key.Contains(query, StringComparison.OrdinalIgnoreCase))
        {
            return 0.85m;
        }

        return value.Contains(query, StringComparison.OrdinalIgnoreCase) ? 0.65m : 0.25m;
    }

    private static int NormalizeLimit(int limit, int min, int max)
    {
        return Math.Clamp(limit, min, max);
    }

    private static int NormalizeOffset(int offset)
    {
        return Math.Max(0, offset);
    }

    private static decimal? NormalizeConfidence(decimal? confidence)
    {
        return confidence.HasValue ? Math.Clamp(confidence.Value, 0m, 1m) : null;
    }

    private static string? AsString(Dictionary<string, object?> row, string key)
    {
        return row.TryGetValue(key, out var value) && value is not null
            ? value switch
            {
                DateTimeOffset dateTimeOffset => dateTimeOffset.ToString("O"),
                DateTime dateTime => DateTime.SpecifyKind(dateTime, DateTimeKind.Utc).ToString("O"),
                JsonElement element => element.GetRawText(),
                _ => Convert.ToString(value),
            }
            : null;
    }

    private static int AsInt(Dictionary<string, object?> row, string key)
    {
        return row.TryGetValue(key, out var value) && value is not null
            ? Convert.ToInt32(value)
            : 0;
    }

    private static long AsLong(Dictionary<string, object?> row, string key)
    {
        return row.TryGetValue(key, out var value) && value is not null
            ? Convert.ToInt64(value)
            : 0L;
    }

    private static bool AsBool(Dictionary<string, object?> row, string key, bool fallback = false)
    {
        if (!row.TryGetValue(key, out var value) || value is null)
        {
            return fallback;
        }

        return value switch
        {
            bool boolValue => boolValue,
            JsonElement { ValueKind: JsonValueKind.True } => true,
            JsonElement { ValueKind: JsonValueKind.False } => false,
            _ => bool.TryParse(Convert.ToString(value), out var parsed) ? parsed : fallback,
        };
    }

    private static decimal? AsDecimal(Dictionary<string, object?> row, string key)
    {
        return row.TryGetValue(key, out var value) && value is not null
            ? Convert.ToDecimal(value)
            : null;
    }

    private static JsonObject ParseJsonObject(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return new JsonObject();
        }

        try
        {
            return JsonNode.Parse(raw)?.AsObject() ?? new JsonObject();
        }
        catch (JsonException)
        {
            return new JsonObject();
        }
    }

    private static string? ReadJsonString(JsonObject source, string key)
    {
        return source.TryGetPropertyValue(key, out var value) && value is not null
            ? NormalizeBlank(value.ToString())
            : null;
    }

    private static string? ToIso(object? value)
    {
        return value switch
        {
            null => null,
            DateTimeOffset dateTimeOffset => dateTimeOffset.ToString("O"),
            DateTime dateTime => DateTime.SpecifyKind(dateTime, DateTimeKind.Utc).ToString("O"),
            _ => Convert.ToString(value),
        };
    }
}
