using System.Text.Json;
using XiaoLou.Domain;
using Npgsql;
using NpgsqlTypes;

namespace XiaoLou.Infrastructure.Postgres;

public sealed class PostgresProjectSurfaceStore(NpgsqlDataSource dataSource, PostgresAccountStore accounts)
{
    public async Task<Dictionary<string, object?>> CreateProjectAsync(
        ProjectRequest request,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var accountId = await accounts.EnsureAccountAsync(connection, transaction, request, cancellationToken);
        await PostgresAccountStore.LockAccountLaneAsync(connection, transaction, accountId, AccountLanes.Control, cancellationToken);

        var now = NowIso();
        var title = NormalizeBlank(request.Title) ?? "Untitled project";
        var projectId = NormalizeBlank(request.Id) ?? CreateId("proj");
        var projectOwnerType = NormalizeProjectOwnerType(request.OwnerType, request.OrganizationId);
        var projectOwnerId = NormalizeBlank(request.OwnerId)
            ?? (projectOwnerType == "organization" ? NormalizeBlank(request.OrganizationId) : NormalizeBlank(request.AccountOwnerId))
            ?? "guest";
        var summary = NormalizeBlank(request.Summary) ?? "New project waiting for settings and script input.";
        var billingWalletType = NormalizeBlank(request.BillingWalletType)
            ?? (projectOwnerType == "organization" ? "organization" : "personal");
        var billingPolicy = NormalizeBlank(request.BillingPolicy)
            ?? (projectOwnerType == "organization" ? "organization_only" : "personal_only");

        await using var command = new NpgsqlCommand(
            """
            INSERT INTO projects (
              id, account_id, owner_type, owner_id, title, summary, status, cover_url,
              organization_id, current_step, progress_percent, budget_credits,
              budget_limit_credits, budget_used_credits, billing_wallet_type,
              billing_policy, created_by_user_id, director_agent_name, data,
              created_at, updated_at
            )
            VALUES (
              @id, @accountId, @ownerType, @ownerId, @title, @summary, @status, @coverUrl,
              @organizationId, @currentStep, @progressPercent, @budgetCredits,
              @budgetLimitCredits, @budgetUsedCredits, @billingWalletType,
              @billingPolicy, @createdByUserId, @directorAgentName, CAST(@data AS jsonb),
              @now, @now
            )
            ON CONFLICT (id) DO UPDATE SET
              account_id = EXCLUDED.account_id,
              owner_type = EXCLUDED.owner_type,
              owner_id = EXCLUDED.owner_id,
              title = EXCLUDED.title,
              summary = EXCLUDED.summary,
              status = EXCLUDED.status,
              cover_url = EXCLUDED.cover_url,
              organization_id = EXCLUDED.organization_id,
              current_step = EXCLUDED.current_step,
              progress_percent = EXCLUDED.progress_percent,
              budget_credits = EXCLUDED.budget_credits,
              budget_limit_credits = EXCLUDED.budget_limit_credits,
              budget_used_credits = EXCLUDED.budget_used_credits,
              billing_wallet_type = EXCLUDED.billing_wallet_type,
              billing_policy = EXCLUDED.billing_policy,
              created_by_user_id = EXCLUDED.created_by_user_id,
              director_agent_name = EXCLUDED.director_agent_name,
              data = projects.data || EXCLUDED.data,
              updated_at = EXCLUDED.updated_at
            RETURNING
              projects.*,
              (SELECT legacy_owner_type FROM accounts WHERE id = projects.account_id) AS account_owner_type,
              (SELECT legacy_owner_id FROM accounts WHERE id = projects.account_id) AS account_owner_id
            """,
            connection,
            transaction);
        AddProjectParameters(command, request, accountId, projectId, title, summary, projectOwnerType, projectOwnerId, now, billingWalletType, billingPolicy);
        var project = await PostgresRows.ReadSingleAsync(command, cancellationToken)
            ?? throw new InvalidOperationException("Failed to create project.");

        await EnsureProjectDefaultsAsync(connection, transaction, projectId, title, now, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return ToProject(project);
    }

    public async Task<IReadOnlyList<Dictionary<string, object?>>> ListProjectsAsync(
        AccountScope scope,
        int page,
        int pageSize,
        CancellationToken cancellationToken)
    {
        var accountId = await EnsureAccountIdAsync(scope, cancellationToken);
        var normalizedPage = Math.Max(1, page);
        var normalizedPageSize = Math.Clamp(pageSize, 1, 100);
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT
              p.*,
              a.legacy_owner_type AS account_owner_type,
              a.legacy_owner_id AS account_owner_id,
              count(*) OVER() AS total_count
            FROM projects p
            JOIN accounts a ON a.id = p.account_id
            WHERE p.account_id = @accountId
            ORDER BY p.updated_at DESC, p.created_at DESC
            LIMIT @limit OFFSET @offset
            """,
            connection);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("limit", NpgsqlDbType.Integer, normalizedPageSize);
        command.Parameters.AddWithValue("offset", NpgsqlDbType.Integer, (normalizedPage - 1) * normalizedPageSize);
        return (await PostgresRows.ReadManyAsync(command, cancellationToken)).Select(ToProject).ToArray();
    }

    public async Task<Dictionary<string, object?>?> GetProjectAsync(string projectId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT
              p.*,
              a.legacy_owner_type AS account_owner_type,
              a.legacy_owner_id AS account_owner_id
            FROM projects p
            JOIN accounts a ON a.id = p.account_id
            WHERE p.id = @id
            """,
            connection);
        command.Parameters.AddWithValue("id", NpgsqlDbType.Text, projectId);
        var row = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        return row is null ? null : ToProject(row);
    }

    public async Task<Dictionary<string, object?>?> UpdateProjectAsync(
        string projectId,
        ProjectRequest request,
        CancellationToken cancellationToken)
    {
        var now = NowIso();
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            UPDATE projects
            SET title = COALESCE(@title, title),
                summary = COALESCE(@summary, summary),
                status = COALESCE(@status, status),
                cover_url = COALESCE(@coverUrl, cover_url),
                organization_id = COALESCE(@organizationId, organization_id),
                owner_type = COALESCE(@ownerType, owner_type),
                owner_id = COALESCE(@ownerId, owner_id),
                current_step = COALESCE(@currentStep, current_step),
                progress_percent = COALESCE(@progressPercent, progress_percent),
                budget_credits = COALESCE(@budgetCredits, budget_credits),
                budget_limit_credits = COALESCE(@budgetLimitCredits, budget_limit_credits),
                budget_used_credits = COALESCE(@budgetUsedCredits, budget_used_credits),
                billing_wallet_type = COALESCE(@billingWalletType, billing_wallet_type),
                billing_policy = COALESCE(@billingPolicy, billing_policy),
                director_agent_name = COALESCE(@directorAgentName, director_agent_name),
                data = data || CAST(@data AS jsonb),
                updated_at = @now
            WHERE id = @id
            RETURNING
              projects.*,
              (SELECT legacy_owner_type FROM accounts WHERE id = projects.account_id) AS account_owner_type,
              (SELECT legacy_owner_id FROM accounts WHERE id = projects.account_id) AS account_owner_id
            """,
            connection);
        command.Parameters.AddWithValue("id", NpgsqlDbType.Text, projectId);
        command.Parameters.AddWithValue("title", NpgsqlDbType.Text, DbNullable(NormalizeBlank(request.Title)));
        command.Parameters.AddWithValue("summary", NpgsqlDbType.Text, DbNullable(NormalizeBlank(request.Summary)));
        command.Parameters.AddWithValue("status", NpgsqlDbType.Text, DbNullable(NormalizeBlank(request.Status)));
        command.Parameters.AddWithValue("coverUrl", NpgsqlDbType.Text, DbNullable(NormalizeBlank(request.CoverUrl)));
        command.Parameters.AddWithValue("organizationId", NpgsqlDbType.Text, DbNullable(NormalizeBlank(request.OrganizationId)));
        command.Parameters.AddWithValue("ownerType", NpgsqlDbType.Text, DbNullable(NormalizeBlank(request.OwnerType)));
        command.Parameters.AddWithValue("ownerId", NpgsqlDbType.Text, DbNullable(NormalizeBlank(request.OwnerId)));
        command.Parameters.AddWithValue("currentStep", NpgsqlDbType.Text, DbNullable(NormalizeBlank(request.CurrentStep)));
        command.Parameters.AddWithValue("progressPercent", NpgsqlDbType.Numeric, DbNullable(request.ProgressPercent));
        command.Parameters.AddWithValue("budgetCredits", NpgsqlDbType.Numeric, DbNullable(request.BudgetCredits));
        command.Parameters.AddWithValue("budgetLimitCredits", NpgsqlDbType.Numeric, DbNullable(request.BudgetLimitCredits));
        command.Parameters.AddWithValue("budgetUsedCredits", NpgsqlDbType.Numeric, DbNullable(request.BudgetUsedCredits));
        command.Parameters.AddWithValue("billingWalletType", NpgsqlDbType.Text, DbNullable(NormalizeBlank(request.BillingWalletType)));
        command.Parameters.AddWithValue("billingPolicy", NpgsqlDbType.Text, DbNullable(NormalizeBlank(request.BillingPolicy)));
        command.Parameters.AddWithValue("directorAgentName", NpgsqlDbType.Text, DbNullable(NormalizeBlank(request.DirectorAgentName)));
        command.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, Jsonb.From(request.Data));
        command.Parameters.AddWithValue("now", NpgsqlDbType.Text, now);
        var row = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        return row is null ? null : ToProject(row);
    }

    public async Task<Dictionary<string, object?>?> GetProjectOverviewAsync(string projectId, CancellationToken cancellationToken)
    {
        var project = await GetProjectAsync(projectId, cancellationToken);
        if (project is null)
        {
            return null;
        }

        var assets = await ListAssetsAsync(projectId, null, cancellationToken);
        var storyboards = await ListStoryboardsAsync(projectId, null, cancellationToken);
        var videos = await ListVideosAsync(projectId, cancellationToken);
        var dubbings = await ListDubbingsAsync(projectId, cancellationToken);

        return new Dictionary<string, object?>
        {
            ["project"] = new Dictionary<string, object?>(project)
            {
                ["settings"] = await GetSettingsAsync(projectId, cancellationToken),
                ["script"] = await GetScriptAsync(projectId, cancellationToken),
                ["assetCount"] = assets.Count,
                ["storyboardCount"] = storyboards.Count,
                ["videoCount"] = videos.Count,
                ["dubbingCount"] = dubbings.Count,
            },
            ["settings"] = await GetSettingsAsync(projectId, cancellationToken),
            ["script"] = await GetScriptAsync(projectId, cancellationToken),
            ["assets"] = assets,
            ["storyboards"] = storyboards,
            ["videos"] = videos,
            ["dubbings"] = dubbings,
            ["timeline"] = await GetTimelineAsync(projectId, cancellationToken),
            ["tasks"] = Array.Empty<object>(),
        };
    }

    public async Task<Dictionary<string, object?>> GetSettingsAsync(string projectId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            "SELECT project_id, data::text AS data_json, updated_at FROM project_settings WHERE project_id = @projectId",
            connection);
        command.Parameters.AddWithValue("projectId", NpgsqlDbType.Text, projectId);
        var row = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        return row is null ? DefaultSettings(projectId, NowIso()) : ToSettings(row);
    }

    public async Task<Dictionary<string, object?>> UpsertSettingsAsync(
        string projectId,
        ProjectSettingsRequest request,
        CancellationToken cancellationToken)
    {
        var now = NowIso();
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO project_settings (project_id, data, updated_at)
            VALUES (@projectId, CAST(@data AS jsonb), @now)
            ON CONFLICT (project_id) DO UPDATE SET
              data = project_settings.data || EXCLUDED.data,
              updated_at = EXCLUDED.updated_at
            RETURNING project_id, data::text AS data_json, updated_at
            """,
            connection);
        command.Parameters.AddWithValue("projectId", NpgsqlDbType.Text, projectId);
        command.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, Jsonb.From(request.Data));
        command.Parameters.AddWithValue("now", NpgsqlDbType.Text, now);
        return ToSettings(await PostgresRows.ReadSingleAsync(command, cancellationToken)
            ?? throw new InvalidOperationException("Failed to update settings."));
    }

    public async Task<Dictionary<string, object?>> GetScriptAsync(string projectId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            "SELECT id, project_id, title, version, data::text AS data_json, updated_at FROM project_scripts WHERE project_id = @projectId ORDER BY version DESC LIMIT 1",
            connection);
        command.Parameters.AddWithValue("projectId", NpgsqlDbType.Text, projectId);
        var row = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        return row is null ? DefaultScript(projectId, "Draft script", NowIso()) : ToScript(row);
    }

    public async Task<Dictionary<string, object?>> UpsertScriptAsync(
        string projectId,
        ProjectScriptRequest request,
        CancellationToken cancellationToken)
    {
        var now = NowIso();
        var current = await GetScriptAsync(projectId, cancellationToken);
        var version = Convert.ToInt32(current["version"] ?? 1) + 1;
        var title = NormalizeBlank(request.Title) ?? current["title"]?.ToString() ?? "Draft script";
        var content = request.Content ?? "";
        var data = JsonSerializer.Serialize(new Dictionary<string, object?>
        {
            ["id"] = current["id"] ?? $"{projectId}:script",
            ["projectId"] = projectId,
            ["version"] = version,
            ["title"] = title,
            ["content"] = content,
            ["updatedAt"] = now,
        });

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO project_scripts (id, project_id, title, version, data, created_at, updated_at)
            VALUES (@id, @projectId, @title, @version, CAST(@data AS jsonb), @now, @now)
            ON CONFLICT (id) DO UPDATE SET
              title = EXCLUDED.title,
              version = EXCLUDED.version,
              data = EXCLUDED.data,
              updated_at = EXCLUDED.updated_at
            RETURNING id, project_id, title, version, data::text AS data_json, updated_at
            """,
            connection);
        command.Parameters.AddWithValue("id", NpgsqlDbType.Text, current["id"]?.ToString() ?? $"{projectId}:script");
        command.Parameters.AddWithValue("projectId", NpgsqlDbType.Text, projectId);
        command.Parameters.AddWithValue("title", NpgsqlDbType.Text, title);
        command.Parameters.AddWithValue("version", NpgsqlDbType.Integer, version);
        command.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, data);
        command.Parameters.AddWithValue("now", NpgsqlDbType.Text, now);
        return ToScript(await PostgresRows.ReadSingleAsync(command, cancellationToken)
            ?? throw new InvalidOperationException("Failed to update script."));
    }

    public async Task<Dictionary<string, object?>> GetTimelineAsync(string projectId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            "SELECT project_id, version, data::text AS data_json, updated_at FROM project_timelines WHERE project_id = @projectId",
            connection);
        command.Parameters.AddWithValue("projectId", NpgsqlDbType.Text, projectId);
        var row = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        return row is null ? DefaultTimeline(projectId, NowIso()) : ToTimeline(row);
    }

    public async Task<Dictionary<string, object?>> UpsertTimelineAsync(
        string projectId,
        ProjectTimelineRequest request,
        CancellationToken cancellationToken)
    {
        var now = NowIso();
        var version = Math.Max(1, request.Version ?? 1);
        var tracks = request.Tracks.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null
            ? "[]"
            : request.Tracks.GetRawText();
        var baseData = request.Data.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null
            ? new Dictionary<string, object?>()
            : JsonSerializer.Deserialize<Dictionary<string, object?>>(request.Data.GetRawText()) ?? new Dictionary<string, object?>();
        baseData["projectId"] = projectId;
        baseData["version"] = version;
        baseData["totalDurationSeconds"] = request.TotalDurationSeconds ?? 0;
        baseData["tracks"] = JsonSerializer.Deserialize<JsonElement>(tracks);
        baseData["updatedAt"] = now;

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO project_timelines (project_id, version, data, updated_at)
            VALUES (@projectId, @version, CAST(@data AS jsonb), @now)
            ON CONFLICT (project_id) DO UPDATE SET
              version = EXCLUDED.version,
              data = EXCLUDED.data,
              updated_at = EXCLUDED.updated_at
            RETURNING project_id, version, data::text AS data_json, updated_at
            """,
            connection);
        command.Parameters.AddWithValue("projectId", NpgsqlDbType.Text, projectId);
        command.Parameters.AddWithValue("version", NpgsqlDbType.Integer, version);
        command.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, JsonSerializer.Serialize(baseData));
        command.Parameters.AddWithValue("now", NpgsqlDbType.Text, now);
        return ToTimeline(await PostgresRows.ReadSingleAsync(command, cancellationToken)
            ?? throw new InvalidOperationException("Failed to update timeline."));
    }

    public async Task<IReadOnlyList<Dictionary<string, object?>>> ListAssetsAsync(
        string projectId,
        string? assetType,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand
        {
            Connection = connection,
            CommandText =
                """
                SELECT
                  *,
                  data::text AS data_json,
                  source_metadata::text AS source_metadata_json,
                  reference_image_urls::text AS reference_image_urls_json
                FROM project_assets
                WHERE project_id = @projectId
                """,
        };
        command.Parameters.AddWithValue("projectId", NpgsqlDbType.Text, projectId);
        if (!string.IsNullOrWhiteSpace(assetType))
        {
            command.CommandText += " AND asset_type = @assetType";
            command.Parameters.AddWithValue("assetType", NpgsqlDbType.Text, assetType.Trim());
        }
        command.CommandText += " ORDER BY updated_at DESC, created_at DESC LIMIT 500";
        return (await PostgresRows.ReadManyAsync(command, cancellationToken)).Select(ToAsset).ToArray();
    }

    public async Task<Dictionary<string, object?>?> GetAssetAsync(
        string projectId,
        string assetId,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT
              *,
              data::text AS data_json,
              source_metadata::text AS source_metadata_json,
              reference_image_urls::text AS reference_image_urls_json
            FROM project_assets
            WHERE project_id = @projectId AND id = @id
            """,
            connection);
        command.Parameters.AddWithValue("projectId", NpgsqlDbType.Text, projectId);
        command.Parameters.AddWithValue("id", NpgsqlDbType.Text, assetId);
        var row = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        return row is null ? null : ToAsset(row);
    }

    public async Task<Dictionary<string, object?>?> UpsertAssetAsync(
        string projectId,
        string? assetId,
        JsonElement request,
        CancellationToken cancellationToken)
    {
        var now = NowIso();
        var id = NormalizeBlank(assetId) ?? JsonText(request, "id") ?? CreateId("asset");
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO project_assets (
              id, project_id, asset_type, name, description, preview_url,
              media_kind, media_url, source_task_id, source_module, source_metadata,
              generation_prompt, reference_image_urls, image_status, image_model,
              aspect_ratio, negative_prompt, scope, data, created_at, updated_at
            )
            VALUES (
              @id, @projectId, @assetType, @name, @description, @previewUrl,
              @mediaKind, @mediaUrl, @sourceTaskId, @sourceModule, CAST(@sourceMetadata AS jsonb),
              @generationPrompt, CAST(@referenceImageUrls AS jsonb), @imageStatus, @imageModel,
              @aspectRatio, @negativePrompt, @scope, CAST(@data AS jsonb), @now, @now
            )
            ON CONFLICT (id) DO UPDATE SET
              asset_type = COALESCE(EXCLUDED.asset_type, project_assets.asset_type),
              name = COALESCE(EXCLUDED.name, project_assets.name),
              description = COALESCE(EXCLUDED.description, project_assets.description),
              preview_url = COALESCE(EXCLUDED.preview_url, project_assets.preview_url),
              media_kind = COALESCE(EXCLUDED.media_kind, project_assets.media_kind),
              media_url = COALESCE(EXCLUDED.media_url, project_assets.media_url),
              source_task_id = COALESCE(EXCLUDED.source_task_id, project_assets.source_task_id),
              source_module = COALESCE(EXCLUDED.source_module, project_assets.source_module),
              source_metadata = COALESCE(EXCLUDED.source_metadata, project_assets.source_metadata),
              generation_prompt = COALESCE(EXCLUDED.generation_prompt, project_assets.generation_prompt),
              reference_image_urls = COALESCE(EXCLUDED.reference_image_urls, project_assets.reference_image_urls),
              image_status = COALESCE(EXCLUDED.image_status, project_assets.image_status),
              image_model = COALESCE(EXCLUDED.image_model, project_assets.image_model),
              aspect_ratio = COALESCE(EXCLUDED.aspect_ratio, project_assets.aspect_ratio),
              negative_prompt = COALESCE(EXCLUDED.negative_prompt, project_assets.negative_prompt),
              scope = COALESCE(EXCLUDED.scope, project_assets.scope),
              data = project_assets.data || EXCLUDED.data,
              updated_at = EXCLUDED.updated_at
            WHERE project_assets.project_id = @projectId
            RETURNING
              *,
              data::text AS data_json,
              source_metadata::text AS source_metadata_json,
              reference_image_urls::text AS reference_image_urls_json
            """,
            connection);
        command.Parameters.AddWithValue("id", NpgsqlDbType.Text, id);
        command.Parameters.AddWithValue("projectId", NpgsqlDbType.Text, projectId);
        command.Parameters.AddWithValue("assetType", NpgsqlDbType.Text, DbNullable(JsonText(request, "assetType")));
        command.Parameters.AddWithValue("name", NpgsqlDbType.Text, DbNullable(JsonText(request, "name")));
        command.Parameters.AddWithValue("description", NpgsqlDbType.Text, DbNullable(JsonText(request, "description")));
        command.Parameters.AddWithValue("previewUrl", NpgsqlDbType.Text, DbNullable(JsonText(request, "previewUrl")));
        command.Parameters.AddWithValue("mediaKind", NpgsqlDbType.Text, DbNullable(JsonText(request, "mediaKind")));
        command.Parameters.AddWithValue("mediaUrl", NpgsqlDbType.Text, DbNullable(JsonText(request, "mediaUrl")));
        command.Parameters.AddWithValue("sourceTaskId", NpgsqlDbType.Text, DbNullable(JsonText(request, "sourceTaskId")));
        command.Parameters.AddWithValue("sourceModule", NpgsqlDbType.Text, DbNullable(JsonText(request, "sourceModule")));
        command.Parameters.AddWithValue("sourceMetadata", NpgsqlDbType.Jsonb, DbNullable(JsonRawOrNull(request, "sourceMetadata")));
        command.Parameters.AddWithValue("generationPrompt", NpgsqlDbType.Text, DbNullable(JsonText(request, "generationPrompt")));
        command.Parameters.AddWithValue("referenceImageUrls", NpgsqlDbType.Jsonb, DbNullable(JsonRawOrNull(request, "referenceImageUrls")));
        command.Parameters.AddWithValue("imageStatus", NpgsqlDbType.Text, DbNullable(JsonText(request, "imageStatus")));
        command.Parameters.AddWithValue("imageModel", NpgsqlDbType.Text, DbNullable(JsonText(request, "imageModel")));
        command.Parameters.AddWithValue("aspectRatio", NpgsqlDbType.Text, DbNullable(JsonText(request, "aspectRatio")));
        command.Parameters.AddWithValue("negativePrompt", NpgsqlDbType.Text, DbNullable(JsonText(request, "negativePrompt")));
        command.Parameters.AddWithValue("scope", NpgsqlDbType.Text, DbNullable(JsonText(request, "scope")));
        command.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, JsonData(request));
        command.Parameters.AddWithValue("now", NpgsqlDbType.Text, now);
        var row = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        return row is null ? null : ToAsset(row);
    }

    public async Task<IReadOnlyList<Dictionary<string, object?>>> ListStoryboardsAsync(
        string projectId,
        int? episodeNo,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand
        {
            Connection = connection,
            CommandText =
                """
                SELECT *, data::text AS data_json, asset_ids::text AS asset_ids_json
                FROM project_storyboards
                WHERE project_id = @projectId
                """,
        };
        command.Parameters.AddWithValue("projectId", NpgsqlDbType.Text, projectId);
        if (episodeNo is not null)
        {
            command.CommandText += " AND episode_no = @episodeNo";
            command.Parameters.AddWithValue("episodeNo", NpgsqlDbType.Integer, episodeNo.Value);
        }
        command.CommandText += " ORDER BY COALESCE(episode_no, 0), COALESCE(shot_no, 0), updated_at DESC LIMIT 500";
        return (await PostgresRows.ReadManyAsync(command, cancellationToken)).Select(ToStoryboard).ToArray();
    }

    public async Task<Dictionary<string, object?>?> GetStoryboardAsync(
        string projectId,
        string storyboardId,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT *, data::text AS data_json, asset_ids::text AS asset_ids_json
            FROM project_storyboards
            WHERE project_id = @projectId AND id = @id
            """,
            connection);
        command.Parameters.AddWithValue("projectId", NpgsqlDbType.Text, projectId);
        command.Parameters.AddWithValue("id", NpgsqlDbType.Text, storyboardId);
        var row = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        return row is null ? null : ToStoryboard(row);
    }

    public async Task<Dictionary<string, object?>?> UpsertStoryboardAsync(
        string projectId,
        string storyboardId,
        JsonElement request,
        CancellationToken cancellationToken)
    {
        var now = NowIso();
        var id = NormalizeBlank(storyboardId) ?? JsonText(request, "id") ?? CreateId("story");
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO project_storyboards (
              id, project_id, shot_no, episode_no, title, script, image_status,
              video_status, duration_seconds, prompt_summary, image_url,
              asset_ids, data, created_at, updated_at
            )
            VALUES (
              @id, @projectId, @shotNo, @episodeNo, @title, @script, @imageStatus,
              @videoStatus, @durationSeconds, @promptSummary, @imageUrl,
              CAST(@assetIds AS jsonb), CAST(@data AS jsonb), @now, @now
            )
            ON CONFLICT (id) DO UPDATE SET
              shot_no = COALESCE(EXCLUDED.shot_no, project_storyboards.shot_no),
              episode_no = COALESCE(EXCLUDED.episode_no, project_storyboards.episode_no),
              title = COALESCE(EXCLUDED.title, project_storyboards.title),
              script = COALESCE(EXCLUDED.script, project_storyboards.script),
              image_status = COALESCE(EXCLUDED.image_status, project_storyboards.image_status),
              video_status = COALESCE(EXCLUDED.video_status, project_storyboards.video_status),
              duration_seconds = COALESCE(EXCLUDED.duration_seconds, project_storyboards.duration_seconds),
              prompt_summary = COALESCE(EXCLUDED.prompt_summary, project_storyboards.prompt_summary),
              image_url = COALESCE(EXCLUDED.image_url, project_storyboards.image_url),
              asset_ids = COALESCE(EXCLUDED.asset_ids, project_storyboards.asset_ids),
              data = project_storyboards.data || EXCLUDED.data,
              updated_at = EXCLUDED.updated_at
            WHERE project_storyboards.project_id = @projectId
            RETURNING *, data::text AS data_json, asset_ids::text AS asset_ids_json
            """,
            connection);
        command.Parameters.AddWithValue("id", NpgsqlDbType.Text, id);
        command.Parameters.AddWithValue("projectId", NpgsqlDbType.Text, projectId);
        command.Parameters.AddWithValue("shotNo", NpgsqlDbType.Integer, DbNullable(JsonInt(request, "shotNo")));
        command.Parameters.AddWithValue("episodeNo", NpgsqlDbType.Integer, DbNullable(JsonInt(request, "episodeNo")));
        command.Parameters.AddWithValue("title", NpgsqlDbType.Text, DbNullable(JsonText(request, "title")));
        command.Parameters.AddWithValue("script", NpgsqlDbType.Text, DbNullable(JsonText(request, "script")));
        command.Parameters.AddWithValue("imageStatus", NpgsqlDbType.Text, DbNullable(JsonText(request, "imageStatus")));
        command.Parameters.AddWithValue("videoStatus", NpgsqlDbType.Text, DbNullable(JsonText(request, "videoStatus")));
        command.Parameters.AddWithValue("durationSeconds", NpgsqlDbType.Numeric, DbNullable(JsonDecimal(request, "durationSeconds")));
        command.Parameters.AddWithValue("promptSummary", NpgsqlDbType.Text, DbNullable(JsonText(request, "promptSummary")));
        command.Parameters.AddWithValue("imageUrl", NpgsqlDbType.Text, DbNullable(JsonText(request, "imageUrl")));
        command.Parameters.AddWithValue("assetIds", NpgsqlDbType.Jsonb, DbNullable(JsonRawOrNull(request, "assetIds")));
        command.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, JsonData(request));
        command.Parameters.AddWithValue("now", NpgsqlDbType.Text, now);
        var row = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        return row is null ? null : ToStoryboard(row);
    }

    public async Task<IReadOnlyList<Dictionary<string, object?>>> ListVideosAsync(
        string projectId,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT *, data::text AS data_json
            FROM project_videos
            WHERE project_id = @projectId
            ORDER BY updated_at DESC, created_at DESC
            LIMIT 500
            """,
            connection);
        command.Parameters.AddWithValue("projectId", NpgsqlDbType.Text, projectId);
        return (await PostgresRows.ReadManyAsync(command, cancellationToken)).Select(ToVideo).ToArray();
    }

    public async Task<Dictionary<string, object?>?> UpsertVideoAsync(
        string projectId,
        string videoId,
        JsonElement request,
        CancellationToken cancellationToken)
    {
        var now = NowIso();
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO project_videos (
              id, project_id, storyboard_id, version, status, duration_seconds,
              video_url, thumbnail_url, data, created_at, updated_at
            )
            VALUES (
              @id, @projectId, @storyboardId, @version, @status, @durationSeconds,
              @videoUrl, @thumbnailUrl, CAST(@data AS jsonb), @now, @now
            )
            ON CONFLICT (id) DO UPDATE SET
              storyboard_id = COALESCE(EXCLUDED.storyboard_id, project_videos.storyboard_id),
              version = COALESCE(EXCLUDED.version, project_videos.version),
              status = COALESCE(EXCLUDED.status, project_videos.status),
              duration_seconds = COALESCE(EXCLUDED.duration_seconds, project_videos.duration_seconds),
              video_url = COALESCE(EXCLUDED.video_url, project_videos.video_url),
              thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, project_videos.thumbnail_url),
              data = project_videos.data || EXCLUDED.data,
              updated_at = EXCLUDED.updated_at
            WHERE project_videos.project_id = @projectId
            RETURNING *, data::text AS data_json
            """,
            connection);
        command.Parameters.AddWithValue("id", NpgsqlDbType.Text, NormalizeBlank(videoId) ?? JsonText(request, "id") ?? CreateId("video"));
        command.Parameters.AddWithValue("projectId", NpgsqlDbType.Text, projectId);
        command.Parameters.AddWithValue("storyboardId", NpgsqlDbType.Text, DbNullable(JsonText(request, "storyboardId")));
        command.Parameters.AddWithValue("version", NpgsqlDbType.Integer, DbNullable(JsonInt(request, "version")));
        command.Parameters.AddWithValue("status", NpgsqlDbType.Text, DbNullable(JsonText(request, "status")));
        command.Parameters.AddWithValue("durationSeconds", NpgsqlDbType.Numeric, DbNullable(JsonDecimal(request, "durationSeconds")));
        command.Parameters.AddWithValue("videoUrl", NpgsqlDbType.Text, DbNullable(JsonText(request, "videoUrl")));
        command.Parameters.AddWithValue("thumbnailUrl", NpgsqlDbType.Text, DbNullable(JsonText(request, "thumbnailUrl")));
        command.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, JsonData(request));
        command.Parameters.AddWithValue("now", NpgsqlDbType.Text, now);
        var row = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        return row is null ? null : ToVideo(row);
    }

    public async Task<IReadOnlyList<Dictionary<string, object?>>> ListDubbingsAsync(
        string projectId,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT *, data::text AS data_json
            FROM project_dubbings
            WHERE project_id = @projectId
            ORDER BY updated_at DESC, created_at DESC
            LIMIT 500
            """,
            connection);
        command.Parameters.AddWithValue("projectId", NpgsqlDbType.Text, projectId);
        return (await PostgresRows.ReadManyAsync(command, cancellationToken)).Select(ToDubbing).ToArray();
    }

    public async Task<Dictionary<string, object?>?> UpsertDubbingAsync(
        string projectId,
        string dubbingId,
        JsonElement request,
        CancellationToken cancellationToken)
    {
        var now = NowIso();
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO project_dubbings (
              id, project_id, storyboard_id, speaker_name, voice_preset,
              text_content, status, audio_url, data, created_at, updated_at
            )
            VALUES (
              @id, @projectId, @storyboardId, @speakerName, @voicePreset,
              @textContent, @status, @audioUrl, CAST(@data AS jsonb), @now, @now
            )
            ON CONFLICT (id) DO UPDATE SET
              storyboard_id = COALESCE(EXCLUDED.storyboard_id, project_dubbings.storyboard_id),
              speaker_name = COALESCE(EXCLUDED.speaker_name, project_dubbings.speaker_name),
              voice_preset = COALESCE(EXCLUDED.voice_preset, project_dubbings.voice_preset),
              text_content = COALESCE(EXCLUDED.text_content, project_dubbings.text_content),
              status = COALESCE(EXCLUDED.status, project_dubbings.status),
              audio_url = COALESCE(EXCLUDED.audio_url, project_dubbings.audio_url),
              data = project_dubbings.data || EXCLUDED.data,
              updated_at = EXCLUDED.updated_at
            WHERE project_dubbings.project_id = @projectId
            RETURNING *, data::text AS data_json
            """,
            connection);
        command.Parameters.AddWithValue("id", NpgsqlDbType.Text, NormalizeBlank(dubbingId) ?? JsonText(request, "id") ?? CreateId("dub"));
        command.Parameters.AddWithValue("projectId", NpgsqlDbType.Text, projectId);
        command.Parameters.AddWithValue("storyboardId", NpgsqlDbType.Text, DbNullable(JsonText(request, "storyboardId")));
        command.Parameters.AddWithValue("speakerName", NpgsqlDbType.Text, DbNullable(JsonText(request, "speakerName")));
        command.Parameters.AddWithValue("voicePreset", NpgsqlDbType.Text, DbNullable(JsonText(request, "voicePreset")));
        command.Parameters.AddWithValue("textContent", NpgsqlDbType.Text, DbNullable(JsonText(request, "text")));
        command.Parameters.AddWithValue("status", NpgsqlDbType.Text, DbNullable(JsonText(request, "status")));
        command.Parameters.AddWithValue("audioUrl", NpgsqlDbType.Text, DbNullable(JsonText(request, "audioUrl")));
        command.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, JsonData(request));
        command.Parameters.AddWithValue("now", NpgsqlDbType.Text, now);
        var row = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        return row is null ? null : ToDubbing(row);
    }

    public async Task<IReadOnlyList<Dictionary<string, object?>>> ListExportsAsync(
        string projectId,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT *, data::text AS data_json
            FROM project_exports
            WHERE project_id = @projectId
            ORDER BY updated_at DESC, created_at DESC
            LIMIT 100
            """,
            connection);
        command.Parameters.AddWithValue("projectId", NpgsqlDbType.Text, projectId);
        return (await PostgresRows.ReadManyAsync(command, cancellationToken)).Select(ToExport).ToArray();
    }

    public async Task<Dictionary<string, object?>?> CreateExportAsync(
        string projectId,
        JsonElement request,
        Guid? jobId,
        CancellationToken cancellationToken)
    {
        var now = NowIso();
        var id = JsonText(request, "id") ?? CreateId("export");
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO project_exports (id, project_id, format, status, job_id, output_url, data, created_at, updated_at)
            VALUES (@id, @projectId, @format, @status, @jobId, @outputUrl, CAST(@data AS jsonb), @now, @now)
            ON CONFLICT (id) DO UPDATE SET
              format = COALESCE(EXCLUDED.format, project_exports.format),
              status = COALESCE(EXCLUDED.status, project_exports.status),
              job_id = COALESCE(EXCLUDED.job_id, project_exports.job_id),
              output_url = COALESCE(EXCLUDED.output_url, project_exports.output_url),
              data = project_exports.data || EXCLUDED.data,
              updated_at = EXCLUDED.updated_at
            WHERE project_exports.project_id = @projectId
            RETURNING *, data::text AS data_json
            """,
            connection);
        command.Parameters.AddWithValue("id", NpgsqlDbType.Text, id);
        command.Parameters.AddWithValue("projectId", NpgsqlDbType.Text, projectId);
        command.Parameters.AddWithValue("format", NpgsqlDbType.Text, JsonText(request, "format") ?? "mp4");
        command.Parameters.AddWithValue("status", NpgsqlDbType.Text, JsonText(request, "status") ?? "queued");
        command.Parameters.AddWithValue("jobId", NpgsqlDbType.Uuid, DbNullable(jobId));
        command.Parameters.AddWithValue("outputUrl", NpgsqlDbType.Text, DbNullable(JsonText(request, "outputUrl")));
        command.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, JsonData(request));
        command.Parameters.AddWithValue("now", NpgsqlDbType.Text, now);
        var row = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        return row is null ? null : ToExport(row);
    }

    public async Task<bool> DeleteProjectItemAsync(
        string tableName,
        string projectId,
        string itemId,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            $"DELETE FROM {tableName} WHERE project_id = @projectId AND id = @id",
            connection);
        command.Parameters.AddWithValue("projectId", NpgsqlDbType.Text, projectId);
        command.Parameters.AddWithValue("id", NpgsqlDbType.Text, itemId);
        return await command.ExecuteNonQueryAsync(cancellationToken) > 0;
    }

    public async Task<IReadOnlyList<Dictionary<string, object?>>> ListCanvasProjectsAsync(
        string tableName,
        AccountScope scope,
        bool agentCanvas,
        CancellationToken cancellationToken)
    {
        var accountId = await EnsureAccountIdAsync(scope, cancellationToken);
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            $"""
            SELECT
              c.*,
              c.data::text AS data_json,
              c.canvas_data::text AS canvas_data_json,
              c.agent_context::text AS agent_context_json,
              a.legacy_owner_type AS account_owner_type,
              a.legacy_owner_id AS account_owner_id
            FROM {tableName} c
            JOIN accounts a ON a.id = c.account_id
            WHERE c.account_id = @accountId
            ORDER BY c.updated_at DESC, c.created_at DESC
            LIMIT 100
            """,
            connection);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        return (await PostgresRows.ReadManyAsync(command, cancellationToken))
            .Select(row => ToCanvasProject(row, agentCanvas, summaryOnly: true))
            .ToArray();
    }

    public async Task<Dictionary<string, object?>?> GetCanvasProjectAsync(
        string tableName,
        string projectId,
        bool agentCanvas,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            $"""
            SELECT
              c.*,
              c.data::text AS data_json,
              c.canvas_data::text AS canvas_data_json,
              c.agent_context::text AS agent_context_json,
              a.legacy_owner_type AS account_owner_type,
              a.legacy_owner_id AS account_owner_id
            FROM {tableName} c
            JOIN accounts a ON a.id = c.account_id
            WHERE c.id = @id
            """,
            connection);
        command.Parameters.AddWithValue("id", NpgsqlDbType.Text, projectId);
        var row = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        return row is null ? null : ToCanvasProject(row, agentCanvas, summaryOnly: false);
    }

    public async Task<Dictionary<string, object?>?> UpsertCanvasProjectAsync(
        string tableName,
        AccountScope scope,
        CanvasProjectRequest request,
        bool agentCanvas,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var accountId = await accounts.EnsureAccountAsync(connection, transaction, scope, cancellationToken);
        await PostgresAccountStore.LockAccountLaneAsync(connection, transaction, accountId, AccountLanes.Control, cancellationToken);

        var now = NowIso();
        var actorId = NormalizeBlank(scope.AccountOwnerId) ?? "guest";
        var id = NormalizeBlank(request.Id) ?? CreateId(agentCanvas ? "agent_canvas" : "canvas");
        var title = NormalizeBlank(request.Title) ?? (agentCanvas ? "Untitled agent canvas" : "Untitled canvas");
        var canvasData = request.CanvasData.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null
            ? "null"
            : request.CanvasData.GetRawText();
        var agentContext = request.AgentContext.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null
            ? "null"
            : request.AgentContext.GetRawText();
        var data = BuildCanvasProjectData(id, actorId, title, request.ThumbnailUrl, canvasData, agentContext, now, agentCanvas);

        await using var command = new NpgsqlCommand(
            $"""
            INSERT INTO {tableName} (
              id, account_id, actor_id, title, thumbnail_url, canvas_data, agent_context, data, created_at, updated_at
            )
            VALUES (
              @id, @accountId, @actorId, @title, @thumbnailUrl, CAST(@canvasData AS jsonb), CAST(@agentContext AS jsonb),
              CAST(@data AS jsonb), @now, @now
            )
            ON CONFLICT (id) DO UPDATE SET
              title = EXCLUDED.title,
              thumbnail_url = EXCLUDED.thumbnail_url,
              canvas_data = EXCLUDED.canvas_data,
              agent_context = EXCLUDED.agent_context,
              data = {tableName}.data || EXCLUDED.data,
              updated_at = EXCLUDED.updated_at
            WHERE {tableName}.account_id = @accountId
            RETURNING
              {tableName}.*,
              {tableName}.data::text AS data_json,
              {tableName}.canvas_data::text AS canvas_data_json,
              {tableName}.agent_context::text AS agent_context_json,
              (SELECT legacy_owner_type FROM accounts WHERE id = {tableName}.account_id) AS account_owner_type,
              (SELECT legacy_owner_id FROM accounts WHERE id = {tableName}.account_id) AS account_owner_id
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("id", NpgsqlDbType.Text, id);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("actorId", NpgsqlDbType.Text, actorId);
        command.Parameters.AddWithValue("title", NpgsqlDbType.Text, title);
        command.Parameters.AddWithValue("thumbnailUrl", NpgsqlDbType.Text, DbNullable(NormalizeBlank(request.ThumbnailUrl)));
        command.Parameters.AddWithValue("canvasData", NpgsqlDbType.Jsonb, canvasData);
        command.Parameters.AddWithValue("agentContext", NpgsqlDbType.Jsonb, agentContext);
        command.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, data);
        command.Parameters.AddWithValue("now", NpgsqlDbType.Text, now);
        var row = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return row is null ? null : ToCanvasProject(row, agentCanvas, summaryOnly: false);
    }

    public async Task<bool> DeleteCanvasProjectAsync(
        string tableName,
        AccountScope scope,
        string projectId,
        CancellationToken cancellationToken)
    {
        var accountId = await EnsureAccountIdAsync(scope, cancellationToken);
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            $"DELETE FROM {tableName} WHERE id = @id AND account_id = @accountId",
            connection);
        command.Parameters.AddWithValue("id", NpgsqlDbType.Text, projectId);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        return await command.ExecuteNonQueryAsync(cancellationToken) > 0;
    }

    public async Task<IReadOnlyList<Dictionary<string, object?>>> ListCreateResultsAsync(
        AccountScope scope,
        string kind,
        CancellationToken cancellationToken)
    {
        var accountId = await EnsureAccountIdAsync(scope, cancellationToken);
        var jobType = kind == "video" ? "create_video_generate" : "create_image_generate";
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT
              j.id,
              j.job_type,
              j.payload::text AS payload_json,
              j.result::text AS result_json,
              j.created_at,
              j.updated_at
            FROM jobs j
            WHERE j.account_id = @accountId
              AND j.job_type = @jobType
              AND j.status = 'succeeded'
              AND NOT EXISTS (
                SELECT 1
                FROM create_studio_result_deletions d
                WHERE d.account_id = j.account_id
                  AND d.result_kind = @kind
                  AND d.result_id = j.id::text
              )
            ORDER BY COALESCE(j.completed_at, j.updated_at, j.created_at) DESC
            LIMIT 100
            """,
            connection);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("jobType", NpgsqlDbType.Text, jobType);
        command.Parameters.AddWithValue("kind", NpgsqlDbType.Text, kind);
        return (await PostgresRows.ReadManyAsync(command, cancellationToken))
            .Select(row => ToCreateResult(row, kind))
            .Where(row => row.Count > 0)
            .ToArray();
    }

    public async Task<Dictionary<string, object?>> DeleteCreateResultAsync(
        AccountScope scope,
        string kind,
        string resultId,
        CancellationToken cancellationToken)
    {
        var accountId = await EnsureAccountIdAsync(scope, cancellationToken);
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO create_studio_result_deletions (account_id, result_kind, result_id, deleted_at)
            VALUES (@accountId, @kind, @resultId, @deletedAt)
            ON CONFLICT (account_id, result_kind, result_id) DO UPDATE SET deleted_at = EXCLUDED.deleted_at
            """,
            connection);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("kind", NpgsqlDbType.Text, kind);
        command.Parameters.AddWithValue("resultId", NpgsqlDbType.Text, resultId);
        command.Parameters.AddWithValue("deletedAt", NpgsqlDbType.TimestampTz, DateTimeOffset.UtcNow);
        await command.ExecuteNonQueryAsync(cancellationToken);
        return new Dictionary<string, object?>
        {
            ["deleted"] = true,
            ["id"] = resultId,
        };
    }

    private async Task<Guid> EnsureAccountIdAsync(AccountScope scope, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var accountId = await accounts.EnsureAccountAsync(connection, transaction, scope, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return accountId;
    }

    private async Task EnsureProjectDefaultsAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        string projectId,
        string title,
        string now,
        CancellationToken cancellationToken)
    {
        var settings = JsonSerializer.Serialize(DefaultSettings(projectId, now));
        await using var settingsCommand = new NpgsqlCommand(
            """
            INSERT INTO project_settings (project_id, data, updated_at)
            VALUES (@projectId, CAST(@settings AS jsonb), @now)
            ON CONFLICT (project_id) DO NOTHING
            """,
            connection,
            transaction);
        settingsCommand.Parameters.AddWithValue("projectId", NpgsqlDbType.Text, projectId);
        settingsCommand.Parameters.AddWithValue("settings", NpgsqlDbType.Jsonb, settings);
        settingsCommand.Parameters.AddWithValue("now", NpgsqlDbType.Text, now);
        await settingsCommand.ExecuteNonQueryAsync(cancellationToken);

        var script = JsonSerializer.Serialize(DefaultScript(projectId, $"{title} Draft", now));
        await using var scriptCommand = new NpgsqlCommand(
            """
            INSERT INTO project_scripts (id, project_id, title, version, data, created_at, updated_at)
            VALUES (@id, @projectId, @title, 1, CAST(@script AS jsonb), @now, @now)
            ON CONFLICT (id) DO NOTHING
            """,
            connection,
            transaction);
        scriptCommand.Parameters.AddWithValue("id", NpgsqlDbType.Text, $"{projectId}:script");
        scriptCommand.Parameters.AddWithValue("projectId", NpgsqlDbType.Text, projectId);
        scriptCommand.Parameters.AddWithValue("title", NpgsqlDbType.Text, $"{title} Draft");
        scriptCommand.Parameters.AddWithValue("script", NpgsqlDbType.Jsonb, script);
        scriptCommand.Parameters.AddWithValue("now", NpgsqlDbType.Text, now);
        await scriptCommand.ExecuteNonQueryAsync(cancellationToken);

        var timeline = JsonSerializer.Serialize(DefaultTimeline(projectId, now));
        await using var timelineCommand = new NpgsqlCommand(
            """
            INSERT INTO project_timelines (project_id, version, data, updated_at)
            VALUES (@projectId, 1, CAST(@timeline AS jsonb), @now)
            ON CONFLICT (project_id) DO NOTHING
            """,
            connection,
            transaction);
        timelineCommand.Parameters.AddWithValue("projectId", NpgsqlDbType.Text, projectId);
        timelineCommand.Parameters.AddWithValue("timeline", NpgsqlDbType.Jsonb, timeline);
        timelineCommand.Parameters.AddWithValue("now", NpgsqlDbType.Text, now);
        await timelineCommand.ExecuteNonQueryAsync(cancellationToken);
    }

    private static void AddProjectParameters(
        NpgsqlCommand command,
        ProjectRequest request,
        Guid accountId,
        string projectId,
        string title,
        string summary,
        string ownerType,
        string ownerId,
        string now,
        string billingWalletType,
        string billingPolicy)
    {
        command.Parameters.AddWithValue("id", NpgsqlDbType.Text, projectId);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("ownerType", NpgsqlDbType.Text, ownerType);
        command.Parameters.AddWithValue("ownerId", NpgsqlDbType.Text, ownerId);
        command.Parameters.AddWithValue("title", NpgsqlDbType.Text, title);
        command.Parameters.AddWithValue("summary", NpgsqlDbType.Text, summary);
        command.Parameters.AddWithValue("status", NpgsqlDbType.Text, NormalizeBlank(request.Status) ?? "draft");
        command.Parameters.AddWithValue("coverUrl", NpgsqlDbType.Text, DbNullable(NormalizeBlank(request.CoverUrl)));
        command.Parameters.AddWithValue("organizationId", NpgsqlDbType.Text, DbNullable(NormalizeBlank(request.OrganizationId)));
        command.Parameters.AddWithValue("currentStep", NpgsqlDbType.Text, NormalizeBlank(request.CurrentStep) ?? "global");
        command.Parameters.AddWithValue("progressPercent", NpgsqlDbType.Numeric, request.ProgressPercent ?? 0);
        command.Parameters.AddWithValue("budgetCredits", NpgsqlDbType.Numeric, request.BudgetCredits ?? 0);
        command.Parameters.AddWithValue("budgetLimitCredits", NpgsqlDbType.Numeric, request.BudgetLimitCredits ?? 0);
        command.Parameters.AddWithValue("budgetUsedCredits", NpgsqlDbType.Numeric, request.BudgetUsedCredits ?? 0);
        command.Parameters.AddWithValue("billingWalletType", NpgsqlDbType.Text, billingWalletType);
        command.Parameters.AddWithValue("billingPolicy", NpgsqlDbType.Text, billingPolicy);
        command.Parameters.AddWithValue("createdByUserId", NpgsqlDbType.Text, DbNullable(NormalizeBlank(request.AccountOwnerId)));
        command.Parameters.AddWithValue("directorAgentName", NpgsqlDbType.Text, NormalizeBlank(request.DirectorAgentName) ?? "Unassigned");
        command.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, Jsonb.From(request.Data));
        command.Parameters.AddWithValue("now", NpgsqlDbType.Text, now);
    }

    private static Dictionary<string, object?> ToProject(Dictionary<string, object?> row)
    {
        return new Dictionary<string, object?>
        {
            ["id"] = Text(row, "id") ?? "",
            ["account_id"] = row.GetValueOrDefault("account_id"),
            ["account_owner_type"] = Text(row, "account_owner_type") ?? "user",
            ["account_owner_id"] = Text(row, "account_owner_id"),
            ["title"] = Text(row, "title") ?? "Untitled project",
            ["summary"] = Text(row, "summary") ?? "",
            ["status"] = Text(row, "status") ?? "draft",
            ["coverUrl"] = Text(row, "cover_url"),
            ["organizationId"] = Text(row, "organization_id"),
            ["ownerType"] = Text(row, "owner_type") ?? "personal",
            ["ownerId"] = Text(row, "owner_id"),
            ["currentStep"] = Text(row, "current_step") ?? "global",
            ["progressPercent"] = Number(row, "progress_percent"),
            ["budgetCredits"] = Number(row, "budget_credits"),
            ["budgetLimitCredits"] = Number(row, "budget_limit_credits"),
            ["budgetUsedCredits"] = Number(row, "budget_used_credits"),
            ["billingWalletType"] = Text(row, "billing_wallet_type"),
            ["billingPolicy"] = Text(row, "billing_policy"),
            ["createdBy"] = Text(row, "created_by_user_id"),
            ["directorAgentName"] = Text(row, "director_agent_name") ?? "Unassigned",
            ["createdAt"] = Text(row, "created_at") ?? NowIso(),
            ["updatedAt"] = Text(row, "updated_at") ?? NowIso(),
        };
    }

    private static Dictionary<string, object?> ToSettings(Dictionary<string, object?> row)
    {
        var projectId = Text(row, "project_id") ?? "";
        var updatedAt = Text(row, "updated_at") ?? NowIso();
        var data = JsonDict(row, "data_json");
        var settings = DefaultSettings(projectId, updatedAt);
        foreach (var item in data)
        {
            settings[item.Key] = item.Value;
        }
        settings["projectId"] = projectId;
        settings["updatedAt"] = updatedAt;
        return settings;
    }

    private static Dictionary<string, object?> ToScript(Dictionary<string, object?> row)
    {
        var projectId = Text(row, "project_id") ?? "";
        var updatedAt = Text(row, "updated_at") ?? NowIso();
        var data = JsonDict(row, "data_json");
        var script = DefaultScript(projectId, Text(row, "title") ?? "Draft script", updatedAt);
        foreach (var item in data)
        {
            script[item.Key] = item.Value;
        }
        script["id"] = Text(row, "id") ?? script["id"];
        script["projectId"] = projectId;
        script["title"] = Text(row, "title") ?? script["title"];
        script["version"] = Convert.ToInt32(row.GetValueOrDefault("version") ?? script["version"] ?? 1);
        script["updatedAt"] = updatedAt;
        return script;
    }

    private static Dictionary<string, object?> ToTimeline(Dictionary<string, object?> row)
    {
        var projectId = Text(row, "project_id") ?? "";
        var updatedAt = Text(row, "updated_at") ?? NowIso();
        var data = JsonDict(row, "data_json");
        var timeline = DefaultTimeline(projectId, updatedAt);
        foreach (var item in data)
        {
            timeline[item.Key] = item.Value;
        }
        timeline["projectId"] = projectId;
        timeline["version"] = Convert.ToInt32(row.GetValueOrDefault("version") ?? timeline["version"] ?? 1);
        timeline["updatedAt"] = updatedAt;
        return timeline;
    }

    private static Dictionary<string, object?> ToAsset(Dictionary<string, object?> row)
    {
        var data = JsonDict(row, "data_json");
        var result = new Dictionary<string, object?>(data)
        {
            ["id"] = Text(row, "id") ?? FirstText(data, "id") ?? "",
            ["projectId"] = Text(row, "project_id") ?? FirstText(data, "projectId") ?? "",
            ["assetType"] = Text(row, "asset_type") ?? FirstText(data, "assetType") ?? "asset",
            ["name"] = Text(row, "name") ?? FirstText(data, "name") ?? "Project asset",
            ["description"] = Text(row, "description") ?? FirstText(data, "description") ?? "",
            ["previewUrl"] = Text(row, "preview_url") ?? FirstText(data, "previewUrl", "mediaUrl"),
            ["mediaKind"] = Text(row, "media_kind") ?? FirstText(data, "mediaKind"),
            ["mediaUrl"] = Text(row, "media_url") ?? FirstText(data, "mediaUrl", "previewUrl"),
            ["sourceTaskId"] = Text(row, "source_task_id") ?? FirstText(data, "sourceTaskId"),
            ["sourceModule"] = Text(row, "source_module") ?? FirstText(data, "sourceModule"),
            ["sourceMetadata"] = JsonValue(row, "source_metadata_json") ?? data.GetValueOrDefault("sourceMetadata"),
            ["generationPrompt"] = Text(row, "generation_prompt") ?? FirstText(data, "generationPrompt"),
            ["referenceImageUrls"] = JsonValue(row, "reference_image_urls_json") ?? data.GetValueOrDefault("referenceImageUrls"),
            ["imageStatus"] = Text(row, "image_status") ?? FirstText(data, "imageStatus"),
            ["imageModel"] = Text(row, "image_model") ?? FirstText(data, "imageModel"),
            ["aspectRatio"] = Text(row, "aspect_ratio") ?? FirstText(data, "aspectRatio"),
            ["negativePrompt"] = Text(row, "negative_prompt") ?? FirstText(data, "negativePrompt"),
            ["scope"] = Text(row, "scope") ?? FirstText(data, "scope") ?? "manual",
            ["createdAt"] = Text(row, "created_at") ?? FirstText(data, "createdAt") ?? NowIso(),
            ["updatedAt"] = Text(row, "updated_at") ?? FirstText(data, "updatedAt") ?? NowIso(),
        };
        return result;
    }

    private static Dictionary<string, object?> ToStoryboard(Dictionary<string, object?> row)
    {
        var data = JsonDict(row, "data_json");
        var result = new Dictionary<string, object?>(data)
        {
            ["id"] = Text(row, "id") ?? FirstText(data, "id") ?? "",
            ["projectId"] = Text(row, "project_id") ?? FirstText(data, "projectId") ?? "",
            ["shotNo"] = Number(row, "shot_no") == 0 ? NumberFromData(data, "shotNo", 1) : Number(row, "shot_no"),
            ["title"] = Text(row, "title") ?? FirstText(data, "title") ?? "Storyboard",
            ["script"] = Text(row, "script") ?? FirstText(data, "script") ?? "",
            ["imageStatus"] = Text(row, "image_status") ?? FirstText(data, "imageStatus") ?? "pending",
            ["videoStatus"] = Text(row, "video_status") ?? FirstText(data, "videoStatus") ?? "pending",
            ["durationSeconds"] = Number(row, "duration_seconds"),
            ["promptSummary"] = Text(row, "prompt_summary") ?? FirstText(data, "promptSummary") ?? "",
            ["imageUrl"] = Text(row, "image_url") ?? FirstText(data, "imageUrl"),
            ["assetIds"] = JsonValue(row, "asset_ids_json") ?? data.GetValueOrDefault("assetIds"),
            ["episodeNo"] = row.GetValueOrDefault("episode_no") is null ? data.GetValueOrDefault("episodeNo") : Number(row, "episode_no"),
            ["createdAt"] = Text(row, "created_at") ?? FirstText(data, "createdAt") ?? NowIso(),
            ["updatedAt"] = Text(row, "updated_at") ?? FirstText(data, "updatedAt") ?? NowIso(),
        };
        if ((decimal)result["durationSeconds"]! == 0)
        {
            result["durationSeconds"] = NumberFromData(data, "durationSeconds", 0);
        }
        return result;
    }

    private static Dictionary<string, object?> ToVideo(Dictionary<string, object?> row)
    {
        var data = JsonDict(row, "data_json");
        return new Dictionary<string, object?>(data)
        {
            ["id"] = Text(row, "id") ?? FirstText(data, "id") ?? "",
            ["projectId"] = Text(row, "project_id") ?? FirstText(data, "projectId") ?? "",
            ["storyboardId"] = Text(row, "storyboard_id") ?? FirstText(data, "storyboardId") ?? "",
            ["version"] = Number(row, "version") == 0 ? NumberFromData(data, "version", 1) : Number(row, "version"),
            ["status"] = Text(row, "status") ?? FirstText(data, "status") ?? "pending",
            ["durationSeconds"] = Number(row, "duration_seconds") == 0 ? NumberFromData(data, "durationSeconds", 0) : Number(row, "duration_seconds"),
            ["videoUrl"] = Text(row, "video_url") ?? FirstText(data, "videoUrl"),
            ["thumbnailUrl"] = Text(row, "thumbnail_url") ?? FirstText(data, "thumbnailUrl"),
            ["createdAt"] = Text(row, "created_at") ?? FirstText(data, "createdAt") ?? NowIso(),
            ["updatedAt"] = Text(row, "updated_at") ?? FirstText(data, "updatedAt") ?? NowIso(),
        };
    }

    private static Dictionary<string, object?> ToDubbing(Dictionary<string, object?> row)
    {
        var data = JsonDict(row, "data_json");
        return new Dictionary<string, object?>(data)
        {
            ["id"] = Text(row, "id") ?? FirstText(data, "id") ?? "",
            ["projectId"] = Text(row, "project_id") ?? FirstText(data, "projectId") ?? "",
            ["storyboardId"] = Text(row, "storyboard_id") ?? FirstText(data, "storyboardId") ?? "",
            ["speakerName"] = Text(row, "speaker_name") ?? FirstText(data, "speakerName") ?? "",
            ["voicePreset"] = Text(row, "voice_preset") ?? FirstText(data, "voicePreset") ?? "",
            ["text"] = Text(row, "text_content") ?? FirstText(data, "text") ?? "",
            ["status"] = Text(row, "status") ?? FirstText(data, "status") ?? "pending",
            ["audioUrl"] = Text(row, "audio_url") ?? FirstText(data, "audioUrl"),
            ["createdAt"] = Text(row, "created_at") ?? FirstText(data, "createdAt") ?? NowIso(),
            ["updatedAt"] = Text(row, "updated_at") ?? FirstText(data, "updatedAt") ?? NowIso(),
        };
    }

    private static Dictionary<string, object?> ToExport(Dictionary<string, object?> row)
    {
        var data = JsonDict(row, "data_json");
        return new Dictionary<string, object?>(data)
        {
            ["id"] = Text(row, "id") ?? FirstText(data, "id") ?? "",
            ["projectId"] = Text(row, "project_id") ?? FirstText(data, "projectId") ?? "",
            ["format"] = Text(row, "format") ?? FirstText(data, "format") ?? "mp4",
            ["status"] = Text(row, "status") ?? FirstText(data, "status") ?? "queued",
            ["jobId"] = Text(row, "job_id") ?? FirstText(data, "jobId"),
            ["outputUrl"] = Text(row, "output_url") ?? FirstText(data, "outputUrl"),
            ["createdAt"] = Text(row, "created_at") ?? FirstText(data, "createdAt") ?? NowIso(),
            ["updatedAt"] = Text(row, "updated_at") ?? FirstText(data, "updatedAt") ?? NowIso(),
        };
    }

    private static Dictionary<string, object?> ToCanvasProject(
        Dictionary<string, object?> row,
        bool agentCanvas,
        bool summaryOnly)
    {
        var data = JsonDict(row, "data_json");
        var result = new Dictionary<string, object?>
        {
            ["id"] = Text(row, "id") ?? "",
            ["account_id"] = row.GetValueOrDefault("account_id"),
            ["account_owner_type"] = Text(row, "account_owner_type") ?? "user",
            ["account_owner_id"] = Text(row, "account_owner_id"),
            ["actorId"] = Text(row, "actor_id") ?? data.GetValueOrDefault("actorId")?.ToString() ?? "guest",
            ["title"] = Text(row, "title") ?? data.GetValueOrDefault("title")?.ToString() ?? "Untitled canvas",
            ["thumbnailUrl"] = Text(row, "thumbnail_url") ?? data.GetValueOrDefault("thumbnailUrl")?.ToString(),
            ["createdAt"] = Text(row, "created_at") ?? data.GetValueOrDefault("createdAt")?.ToString() ?? NowIso(),
            ["updatedAt"] = Text(row, "updated_at") ?? data.GetValueOrDefault("updatedAt")?.ToString() ?? NowIso(),
        };
        if (agentCanvas)
        {
            result["kind"] = "agent_canvas";
        }
        if (!summaryOnly)
        {
            result["canvasData"] = JsonValue(row, "canvas_data_json") ?? data.GetValueOrDefault("canvasData");
            if (agentCanvas)
            {
                result["agentContext"] = JsonValue(row, "agent_context_json") ?? data.GetValueOrDefault("agentContext");
            }
        }
        return result;
    }

    private static Dictionary<string, object?> ToCreateResult(Dictionary<string, object?> row, string kind)
    {
        var payload = JsonDict(row, "payload_json");
        var result = JsonDict(row, "result_json");
        var url = FirstText(result, kind == "video"
            ? new[] { "videoUrl", "video_url", "resultUrl", "url" }
            : new[] { "imageUrl", "image_url", "resultUrl", "url" });
        if (string.IsNullOrWhiteSpace(url))
        {
            return new Dictionary<string, object?>();
        }

        var createdAt = Text(row, "created_at") ?? NowIso();
        if (kind == "video")
        {
            return new Dictionary<string, object?>
            {
                ["id"] = Text(row, "id") ?? "",
                ["taskId"] = Text(row, "id"),
                ["prompt"] = FirstText(payload, "prompt", "inputSummary", "input_summary") ?? "",
                ["model"] = FirstText(payload, "model") ?? FirstText(result, "model") ?? "canonical-job",
                ["duration"] = FirstText(payload, "duration") ?? "",
                ["aspectRatio"] = FirstText(payload, "aspectRatio", "aspect_ratio") ?? "16:9",
                ["resolution"] = FirstText(payload, "resolution") ?? "",
                ["referenceImageUrl"] = FirstText(payload, "referenceImageUrl", "reference_image_url"),
                ["firstFrameUrl"] = FirstText(payload, "firstFrameUrl", "first_frame_url"),
                ["lastFrameUrl"] = FirstText(payload, "lastFrameUrl", "last_frame_url"),
                ["videoMode"] = FirstText(payload, "videoMode", "video_mode"),
                ["thumbnailUrl"] = FirstText(result, "thumbnailUrl", "thumbnail_url", "posterUrl", "poster_url") ?? url,
                ["videoUrl"] = url,
                ["createdAt"] = createdAt,
            };
        }

        return new Dictionary<string, object?>
        {
            ["id"] = Text(row, "id") ?? "",
            ["taskId"] = Text(row, "id"),
            ["prompt"] = FirstText(payload, "prompt", "inputSummary", "input_summary") ?? "",
            ["model"] = FirstText(payload, "model") ?? FirstText(result, "model") ?? "canonical-job",
            ["style"] = FirstText(payload, "style") ?? "",
            ["aspectRatio"] = FirstText(payload, "aspectRatio", "aspect_ratio") ?? "1:1",
            ["resolution"] = FirstText(payload, "resolution") ?? "",
            ["referenceImageUrl"] = FirstText(payload, "referenceImageUrl", "reference_image_url"),
            ["imageUrl"] = url,
            ["createdAt"] = createdAt,
        };
    }

    private static Dictionary<string, object?> DefaultSettings(string projectId, string updatedAt)
    {
        return new Dictionary<string, object?>
        {
            ["projectId"] = projectId,
            ["tone"] = "cinematic",
            ["genre"] = "creative",
            ["targetDurationSeconds"] = 60,
            ["aspectRatio"] = "16:9",
            ["visualStyle"] = "film",
            ["audience"] = "general",
            ["modelProfile"] = "standard",
            ["language"] = "zh-CN",
            ["updatedAt"] = updatedAt,
        };
    }

    private static Dictionary<string, object?> DefaultScript(string projectId, string title, string updatedAt)
    {
        return new Dictionary<string, object?>
        {
            ["id"] = $"{projectId}:script",
            ["projectId"] = projectId,
            ["version"] = 1,
            ["title"] = title,
            ["content"] = "",
            ["updatedAt"] = updatedAt,
        };
    }

    private static Dictionary<string, object?> DefaultTimeline(string projectId, string updatedAt)
    {
        return new Dictionary<string, object?>
        {
            ["projectId"] = projectId,
            ["version"] = 1,
            ["totalDurationSeconds"] = 0,
            ["tracks"] = Array.Empty<object>(),
            ["updatedAt"] = updatedAt,
        };
    }

    private static string BuildCanvasProjectData(
        string id,
        string actorId,
        string title,
        string? thumbnailUrl,
        string canvasData,
        string agentContext,
        string now,
        bool agentCanvas)
    {
        using var canvasJson = JsonDocument.Parse(canvasData);
        using var agentJson = JsonDocument.Parse(agentContext);
        var data = new Dictionary<string, object?>
        {
            ["id"] = id,
            ["actorId"] = actorId,
            ["title"] = title,
            ["thumbnailUrl"] = NormalizeBlank(thumbnailUrl),
            ["canvasData"] = canvasJson.RootElement.Clone(),
            ["createdAt"] = now,
            ["updatedAt"] = now,
        };
        if (agentCanvas)
        {
            data["kind"] = "agent_canvas";
            data["agentContext"] = agentJson.RootElement.Clone();
        }
        return JsonSerializer.Serialize(data);
    }

    private static Dictionary<string, object?> JsonDict(Dictionary<string, object?> row, string key)
    {
        var value = JsonValue(row, key);
        if (value is JsonElement element && element.ValueKind == JsonValueKind.Object)
        {
            return JsonSerializer.Deserialize<Dictionary<string, object?>>(element.GetRawText()) ?? new Dictionary<string, object?>();
        }
        return new Dictionary<string, object?>();
    }

    private static object? JsonValue(Dictionary<string, object?> row, string key)
    {
        if (!row.TryGetValue(key, out var value) || value is null)
        {
            return null;
        }
        var raw = value.ToString();
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }
        try
        {
            using var document = JsonDocument.Parse(raw);
            return document.RootElement.Clone();
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string? Text(Dictionary<string, object?> row, string key)
    {
        return row.TryGetValue(key, out var value) && value is not null
            ? NormalizeBlank(value.ToString())
            : null;
    }

    private static decimal Number(Dictionary<string, object?> row, string key)
    {
        return row.TryGetValue(key, out var value) && value is not null && decimal.TryParse(value.ToString(), out var number)
            ? number
            : 0;
    }

    private static decimal NumberFromData(Dictionary<string, object?> data, string key, decimal fallback)
    {
        return data.TryGetValue(key, out var value) && value is not null && decimal.TryParse(value.ToString(), out var number)
            ? number
            : fallback;
    }

    private static string? FirstText(Dictionary<string, object?> row, params string[] keys)
    {
        foreach (var key in keys)
        {
            if (row.TryGetValue(key, out var value) && value is not null)
            {
                var text = NormalizeBlank(value.ToString());
                if (text is not null)
                {
                    return text;
                }
            }
        }
        return null;
    }

    private static string? JsonText(JsonElement element, string propertyName)
    {
        if (!TryGetJsonProperty(element, propertyName, out var value)
            || value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return null;
        }

        return value.ValueKind == JsonValueKind.String
            ? NormalizeBlank(value.GetString())
            : NormalizeBlank(value.ToString());
    }

    private static int? JsonInt(JsonElement element, string propertyName)
    {
        if (!TryGetJsonProperty(element, propertyName, out var value)
            || value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return null;
        }

        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number))
        {
            return number;
        }

        return int.TryParse(value.ToString(), out var parsed) ? parsed : null;
    }

    private static decimal? JsonDecimal(JsonElement element, string propertyName)
    {
        if (!TryGetJsonProperty(element, propertyName, out var value)
            || value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return null;
        }

        if (value.ValueKind == JsonValueKind.Number && value.TryGetDecimal(out var number))
        {
            return number;
        }

        return decimal.TryParse(value.ToString(), out var parsed) ? parsed : null;
    }

    private static string? JsonRawOrNull(JsonElement element, string propertyName)
    {
        return TryGetJsonProperty(element, propertyName, out var value)
            && value.ValueKind is not JsonValueKind.Null and not JsonValueKind.Undefined
            ? value.GetRawText()
            : null;
    }

    private static string JsonData(JsonElement element)
    {
        return element.ValueKind == JsonValueKind.Object ? element.GetRawText() : "{}";
    }

    private static bool TryGetJsonProperty(JsonElement element, string propertyName, out JsonElement value)
    {
        if (element.ValueKind == JsonValueKind.Object && element.TryGetProperty(propertyName, out value))
        {
            return true;
        }

        value = default;
        return false;
    }

    private static string? NormalizeBlank(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    private static string NormalizeProjectOwnerType(string? ownerType, string? organizationId)
    {
        return string.Equals(ownerType, "organization", StringComparison.OrdinalIgnoreCase)
            && !string.IsNullOrWhiteSpace(organizationId)
            ? "organization"
            : "personal";
    }

    private static string CreateId(string prefix)
    {
        return $"{prefix}_{Guid.NewGuid():N}"[..Math.Min(prefix.Length + 1 + 12, prefix.Length + 1 + 32)];
    }

    private static string NowIso()
    {
        return DateTimeOffset.UtcNow.ToString("O");
    }

    private static object DbNullable(object? value)
    {
        return value ?? DBNull.Value;
    }
}
