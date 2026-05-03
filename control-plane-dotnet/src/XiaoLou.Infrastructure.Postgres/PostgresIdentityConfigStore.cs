using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using XiaoLou.Domain;
using Npgsql;
using NpgsqlTypes;

namespace XiaoLou.Infrastructure.Postgres;

public sealed class PostgresIdentityConfigStore(NpgsqlDataSource dataSource, PostgresAccountStore accounts)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<Dictionary<string, object?>> GetPermissionContextAsync(
        string actorId,
        CancellationToken cancellationToken)
    {
        var normalizedActorId = NormalizeActorId(actorId);
        await EnsureDemoIdentityAsync(normalizedActorId, cancellationToken);
        var profile = await GetOrSeedUserAsync(normalizedActorId, null, null, null, cancellationToken);
        var organizations = await ListOrganizationSummariesAsync(normalizedActorId, cancellationToken);
        return BuildPermissionContext(profile, organizations);
    }

    public async Task<Dictionary<string, object?>> UpdateProfileAsync(
        string actorId,
        UpdateMeRequest request,
        CancellationToken cancellationToken)
    {
        var normalizedActorId = NormalizeActorId(actorId);
        var current = await GetOrSeedUserAsync(normalizedActorId, null, null, null, cancellationToken);
        var displayName = NormalizeBlank(request.DisplayName) ?? AsString(current, "displayName") ?? DefaultDisplayName(normalizedActorId);
        var avatar = request.Avatar is null ? AsString(current, "avatar") : NormalizeBlank(request.Avatar);
        await EnsureUserAsync(
            normalizedActorId,
            displayName,
            AsString(current, "email"),
            null,
            AsString(current, "platformRole") ?? InferPlatformRole(normalizedActorId),
            AsString(current, "defaultOrganizationId"),
            avatar,
            cancellationToken);

        return await GetPermissionContextAsync(normalizedActorId, cancellationToken);
    }

    public async Task<Dictionary<string, object?>> LoginWithEmailAsync(
        LoginRequest request,
        string mode,
        CancellationToken cancellationToken)
    {
        var email = NormalizeBlank(request.Email) ?? "user@xiaolou.local";
        var actorId = ActorIdFromEmail(email, mode);
        var displayName = mode == "ops_admin"
            ? "Ops Admin"
            : mode == "enterprise_admin"
                ? "Enterprise Admin"
                : EmailLocalPart(email);
        var platformRole = mode == "ops_admin" ? "ops_admin" : InferPlatformRole(actorId);
        await EnsureUserAsync(actorId, displayName, email, null, platformRole, null, null, cancellationToken);
        await EnsureDemoIdentityAsync(actorId, cancellationToken);
        return await GetPermissionContextAsync(actorId, cancellationToken);
    }

    public async Task<Dictionary<string, object?>> RegisterPersonalAsync(
        RegisterPersonalRequest request,
        CancellationToken cancellationToken)
    {
        var email = NormalizeBlank(request.Email) ?? "user@xiaolou.local";
        var actorId = ActorIdFromEmail(email, "personal");
        var displayName = NormalizeBlank(request.DisplayName) ?? EmailLocalPart(email);
        await EnsureUserAsync(actorId, displayName, email, request.Phone, "customer", null, null, cancellationToken);
        var permissionContext = await GetPermissionContextAsync(actorId, cancellationToken);
        return BuildRegistrationResult(actorId, permissionContext, "personal", null);
    }

    public async Task<Dictionary<string, object?>> RegisterEnterpriseAdminAsync(
        RegisterEnterpriseAdminRequest request,
        CancellationToken cancellationToken)
    {
        var email = NormalizeBlank(request.Email) ?? "admin@xiaolou.local";
        var actorId = ActorIdFromEmail(email, "enterprise_admin");
        var companyName = NormalizeBlank(request.CompanyName) ?? "XiaoLou Enterprise";
        var organizationId = OrganizationIdFromName(companyName);
        var adminName = NormalizeBlank(request.AdminName) ?? EmailLocalPart(email);
        await EnsureOrganizationAsync(organizationId, companyName, cancellationToken);
        await EnsureUserAsync(actorId, adminName, email, request.Phone, "customer", organizationId, null, cancellationToken);
        await EnsureMembershipAsync(
            organizationId,
            actorId,
            "enterprise_admin",
            new JsonObject
            {
                ["displayName"] = adminName,
                ["email"] = email,
                ["phone"] = NormalizeBlank(request.Phone),
                ["department"] = "Administration",
                ["membershipRole"] = "admin",
                ["canUseOrganizationWallet"] = true,
                ["licenseNo"] = NormalizeBlank(request.LicenseNo),
                ["industry"] = NormalizeBlank(request.Industry),
                ["teamSize"] = NormalizeBlank(request.TeamSize),
            },
            cancellationToken);

        var permissionContext = await GetPermissionContextAsync(actorId, cancellationToken);
        return BuildRegistrationResult(actorId, permissionContext, "enterprise_admin", null);
    }

    public async Task<IReadOnlyList<Dictionary<string, object?>>> ListOrganizationMembersAsync(
        string organizationId,
        CancellationToken cancellationToken)
    {
        await EnsureDemoOrganizationAsync(organizationId, cancellationToken);
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT
              om.legacy_organization_id,
              om.legacy_user_id,
              om.role,
              om.status,
              om.data::text AS membership_data_json,
              om.created_at,
              om.updated_at,
              u.email,
              u.display_name,
              u.data::text AS user_data_json
            FROM organization_memberships om
            JOIN accounts org_account ON org_account.id = om.organization_account_id
            JOIN accounts user_account ON user_account.id = om.user_account_id
            LEFT JOIN users u ON u.account_id = user_account.id
            WHERE org_account.legacy_owner_type = 'organization'
              AND org_account.legacy_owner_id = @organizationId
            ORDER BY om.updated_at DESC, om.created_at DESC
            LIMIT 200
            """,
            connection);
        command.Parameters.AddWithValue("organizationId", NpgsqlDbType.Text, organizationId);
        return (await PostgresRows.ReadManyAsync(command, cancellationToken)).Select(ToOrganizationMember).ToArray();
    }

    public async Task<Dictionary<string, object?>> CreateOrganizationMemberAsync(
        string organizationId,
        CreateOrganizationMemberRequest request,
        CancellationToken cancellationToken)
    {
        var normalizedOrganizationId = NormalizeOwnerId(organizationId, "org_demo_001");
        await EnsureDemoOrganizationAsync(normalizedOrganizationId, cancellationToken);
        var email = NormalizeBlank(request.Email) ?? "member@xiaolou.local";
        var membershipRole = string.Equals(request.MembershipRole, "admin", StringComparison.OrdinalIgnoreCase)
            ? "admin"
            : "member";
        var role = membershipRole == "admin" ? "enterprise_admin" : "enterprise_member";
        var actorMode = role == "enterprise_admin" ? "enterprise_admin" : "personal";
        var actorId = ActorIdFromEmail(email, actorMode);
        var displayName = NormalizeBlank(request.DisplayName) ?? EmailLocalPart(email);
        await EnsureUserAsync(actorId, displayName, email, request.Phone, "customer", normalizedOrganizationId, null, cancellationToken);
        await EnsureMembershipAsync(
            normalizedOrganizationId,
            actorId,
            role,
            new JsonObject
            {
                ["displayName"] = displayName,
                ["email"] = email,
                ["phone"] = NormalizeBlank(request.Phone),
                ["department"] = NormalizeBlank(request.Department),
                ["membershipRole"] = membershipRole,
                ["canUseOrganizationWallet"] = request.CanUseOrganizationWallet ?? true,
            },
            cancellationToken);

        var members = await ListOrganizationMembersAsync(normalizedOrganizationId, cancellationToken);
        var member = members.First(item => string.Equals(AsString(item, "userId"), actorId, StringComparison.Ordinal));
        var permissionContext = await GetPermissionContextAsync(actorId, cancellationToken);
        return BuildRegistrationResult(actorId, permissionContext, role, member);
    }

    public async Task<JsonObject> GetApiCenterConfigAsync(AccountScope scope, CancellationToken cancellationToken)
    {
        var accountId = await EnsureAccountIdAsync(scope, cancellationToken);
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            "SELECT data::text FROM api_center_configs WHERE account_id = @accountId",
            connection);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        var raw = await command.ExecuteScalarAsync(cancellationToken) as string;
        return EnsureApiCenterShape(ParseJsonObject(raw));
    }

    public async Task<JsonObject> UpdateApiCenterDefaultsAsync(
        AccountScope scope,
        JsonElement input,
        CancellationToken cancellationToken)
    {
        var config = await GetApiCenterConfigAsync(scope, cancellationToken);
        var defaults = config["defaults"] as JsonObject ?? new JsonObject();
        foreach (var property in input.EnumerateObject())
        {
            defaults[property.Name] = JsonNode.Parse(property.Value.GetRawText());
        }

        config["defaults"] = defaults;
        await SaveApiCenterConfigAsync(scope, config, cancellationToken);
        return defaults;
    }

    public async Task<JsonObject> SaveApiCenterVendorApiKeyAsync(
        AccountScope scope,
        string vendorId,
        string apiKey,
        CancellationToken cancellationToken)
    {
        var config = await GetApiCenterConfigAsync(scope, cancellationToken);
        var vendor = FindVendor(config, vendorId);
        var trimmedKey = apiKey.Trim();
        vendor["connected"] = trimmedKey.Length > 0;
        vendor["apiKeyConfigured"] = trimmedKey.Length > 0;
        vendor["lastCheckedAt"] = DateTimeOffset.UtcNow.ToString("O");
        vendor["apiKeyHash"] = trimmedKey.Length > 0 ? Sha256Hex(trimmedKey) : null;
        await SaveApiCenterConfigAsync(scope, config, cancellationToken);
        return SanitizeVendor(vendor);
    }

    public async Task<Dictionary<string, object?>> TestApiCenterVendorConnectionAsync(
        AccountScope scope,
        string vendorId,
        CancellationToken cancellationToken)
    {
        var config = await GetApiCenterConfigAsync(scope, cancellationToken);
        var vendor = FindVendor(config, vendorId);
        var checkedAt = DateTimeOffset.UtcNow.ToString("O");
        vendor["connected"] = true;
        vendor["lastCheckedAt"] = checkedAt;
        vendor["testedAt"] = checkedAt;
        await SaveApiCenterConfigAsync(scope, config, cancellationToken);
        var modelCount = vendor["models"] is JsonArray models ? models.Count : 0;
        return new Dictionary<string, object?>
        {
            ["vendor"] = SanitizeVendor(vendor),
            ["checkedAt"] = checkedAt,
            ["modelCount"] = modelCount,
        };
    }

    public async Task<JsonObject> UpdateApiVendorModelAsync(
        AccountScope scope,
        string vendorId,
        string modelId,
        JsonElement input,
        CancellationToken cancellationToken)
    {
        var config = await GetApiCenterConfigAsync(scope, cancellationToken);
        var vendor = FindVendor(config, vendorId);
        var models = vendor["models"] as JsonArray ?? new JsonArray();
        var model = models.OfType<JsonObject>()
            .FirstOrDefault(item => string.Equals(item["id"]?.GetValue<string>(), modelId, StringComparison.Ordinal));
        if (model is null)
        {
            throw new KeyNotFoundException("API model is not available in the canonical API center config.");
        }

        foreach (var property in input.EnumerateObject())
        {
            model[property.Name] = JsonNode.Parse(property.Value.GetRawText());
        }

        await SaveApiCenterConfigAsync(scope, config, cancellationToken);
        return model;
    }

    private async Task EnsureDemoIdentityAsync(string actorId, CancellationToken cancellationToken)
    {
        if (actorId is "user_demo_001" or "user_member_001")
        {
            await EnsureDemoOrganizationAsync("org_demo_001", cancellationToken);
            var isAdmin = actorId == "user_demo_001";
            await EnsureUserAsync(
                actorId,
                isAdmin ? "Enterprise Admin" : "Enterprise Member",
                isAdmin ? "admin@xiaolou.local" : "member@xiaolou.local",
                null,
                "customer",
                "org_demo_001",
                null,
                cancellationToken);
            await EnsureMembershipAsync(
                "org_demo_001",
                actorId,
                isAdmin ? "enterprise_admin" : "enterprise_member",
                new JsonObject
                {
                    ["displayName"] = isAdmin ? "Enterprise Admin" : "Enterprise Member",
                    ["email"] = isAdmin ? "admin@xiaolou.local" : "member@xiaolou.local",
                    ["membershipRole"] = isAdmin ? "admin" : "member",
                    ["canUseOrganizationWallet"] = true,
                },
                cancellationToken);
        }
        else if (actorId == "ops_demo_001")
        {
            await EnsureUserAsync(actorId, "Ops Admin", "ops@xiaolou.local", null, "ops_admin", null, null, cancellationToken);
        }
        else if (InferPlatformRole(actorId) == "super_admin")
        {
            await EnsureUserAsync(actorId, "Super Admin", "root@xiaolou.local", null, "super_admin", null, null, cancellationToken);
        }
    }

    private async Task EnsureDemoOrganizationAsync(string organizationId, CancellationToken cancellationToken)
    {
        if (organizationId == "org_demo_001")
        {
            await EnsureOrganizationAsync("org_demo_001", "XiaoLou Studio Demo", cancellationToken);
        }
    }

    private async Task<Dictionary<string, object?>> GetOrSeedUserAsync(
        string actorId,
        string? displayName,
        string? email,
        string? platformRole,
        CancellationToken cancellationToken)
    {
        var row = await GetUserAsync(actorId, cancellationToken);
        if (row is not null)
        {
            return row;
        }

        await EnsureUserAsync(
            actorId,
            displayName ?? DefaultDisplayName(actorId),
            email ?? DefaultEmail(actorId),
            null,
            platformRole ?? InferPlatformRole(actorId),
            null,
            null,
            cancellationToken);
        return await GetUserAsync(actorId, cancellationToken)
            ?? throw new InvalidOperationException("Failed to seed canonical user profile.");
    }

    private async Task<Dictionary<string, object?>?> GetUserAsync(string actorId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT
              user_account.id AS account_id,
              user_account.legacy_owner_id AS actor_id,
              u.email,
              u.display_name,
              u.status,
              u.data::text AS data_json
            FROM accounts user_account
            LEFT JOIN users u ON u.account_id = user_account.id
            WHERE user_account.legacy_owner_type = 'user'
              AND user_account.legacy_owner_id = @actorId
            LIMIT 1
            """,
            connection);
        command.Parameters.AddWithValue("actorId", NpgsqlDbType.Text, actorId);
        var row = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        return row is null ? null : ToUserProfile(row);
    }

    private async Task EnsureUserAsync(
        string actorId,
        string displayName,
        string? email,
        string? phone,
        string platformRole,
        string? defaultOrganizationId,
        string? avatar,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var accountId = await accounts.EnsureAccountAsync(
            connection,
            transaction,
            new AccountScope
            {
                AccountOwnerType = "user",
                AccountOwnerId = actorId,
                RegionCode = "CN",
                Currency = "CNY",
            },
            cancellationToken);
        var data = new JsonObject
        {
            ["actorId"] = actorId,
            ["platformRole"] = platformRole,
            ["defaultOrganizationId"] = NormalizeBlank(defaultOrganizationId),
            ["avatar"] = NormalizeBlank(avatar),
            ["phone"] = NormalizeBlank(phone),
        };

        await using var update = new NpgsqlCommand(
            """
            UPDATE users
            SET email = COALESCE(@email, email),
                phone_hash = COALESCE(@phoneHash, phone_hash),
                display_name = COALESCE(NULLIF(@displayName, ''), display_name),
                status = 'active',
                region_code = 'CN',
                data = data || CAST(@data AS jsonb),
                updated_at = now()
            WHERE account_id = @accountId
            """,
            connection,
            transaction);
        update.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        update.Parameters.AddWithValue("email", NpgsqlDbType.Text, DbNullable(email));
        update.Parameters.AddWithValue("phoneHash", NpgsqlDbType.Text, DbNullable(HashOptional(phone)));
        update.Parameters.AddWithValue("displayName", NpgsqlDbType.Text, displayName);
        update.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, data.ToJsonString(JsonOptions));
        var updated = await update.ExecuteNonQueryAsync(cancellationToken);
        if (updated == 0)
        {
            await using var insert = new NpgsqlCommand(
                """
                INSERT INTO users (account_id, email, phone_hash, display_name, status, region_code, data, created_at, updated_at)
                VALUES (@accountId, @email, @phoneHash, @displayName, 'active', 'CN', CAST(@data AS jsonb), now(), now())
                """,
                connection,
                transaction);
            insert.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
            insert.Parameters.AddWithValue("email", NpgsqlDbType.Text, DbNullable(email));
            insert.Parameters.AddWithValue("phoneHash", NpgsqlDbType.Text, DbNullable(HashOptional(phone)));
            insert.Parameters.AddWithValue("displayName", NpgsqlDbType.Text, displayName);
            insert.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, data.ToJsonString(JsonOptions));
            await insert.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
    }

    private async Task EnsureOrganizationAsync(
        string organizationId,
        string name,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var accountId = await accounts.EnsureAccountAsync(
            connection,
            transaction,
            new AccountScope
            {
                AccountOwnerType = "organization",
                AccountOwnerId = organizationId,
                RegionCode = "CN",
                Currency = "CNY",
            },
            cancellationToken);
        var data = new JsonObject
        {
            ["assetLibraryStatus"] = "active",
            ["organizationId"] = organizationId,
        };

        await using var update = new NpgsqlCommand(
            """
            UPDATE organizations
            SET name = COALESCE(NULLIF(@name, ''), name),
                status = 'active',
                region_code = 'CN',
                data = data || CAST(@data AS jsonb),
                updated_at = now()
            WHERE account_id = @accountId
            """,
            connection,
            transaction);
        update.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        update.Parameters.AddWithValue("name", NpgsqlDbType.Text, name);
        update.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, data.ToJsonString(JsonOptions));
        var updated = await update.ExecuteNonQueryAsync(cancellationToken);
        if (updated == 0)
        {
            await using var insert = new NpgsqlCommand(
                """
                INSERT INTO organizations (account_id, name, status, region_code, data, created_at, updated_at)
                VALUES (@accountId, @name, 'active', 'CN', CAST(@data AS jsonb), now(), now())
                """,
                connection,
                transaction);
            insert.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
            insert.Parameters.AddWithValue("name", NpgsqlDbType.Text, name);
            insert.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, data.ToJsonString(JsonOptions));
            await insert.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
    }

    private async Task EnsureMembershipAsync(
        string organizationId,
        string actorId,
        string role,
        JsonObject data,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var organizationAccountId = await accounts.EnsureAccountAsync(
            connection,
            transaction,
            new AccountScope
            {
                AccountOwnerType = "organization",
                AccountOwnerId = organizationId,
                RegionCode = "CN",
                Currency = "CNY",
            },
            cancellationToken);
        var userAccountId = await accounts.EnsureAccountAsync(
            connection,
            transaction,
            new AccountScope
            {
                AccountOwnerType = "user",
                AccountOwnerId = actorId,
                RegionCode = "CN",
                Currency = "CNY",
            },
            cancellationToken);

        await using var command = new NpgsqlCommand(
            """
            INSERT INTO organization_memberships (
              organization_account_id, user_account_id, legacy_organization_id,
              legacy_user_id, role, status, data, created_at, updated_at
            )
            VALUES (
              @organizationAccountId, @userAccountId, @organizationId,
              @actorId, @role, 'active', CAST(@data AS jsonb), now(), now()
            )
            ON CONFLICT (organization_account_id, user_account_id) DO UPDATE SET
              legacy_organization_id = EXCLUDED.legacy_organization_id,
              legacy_user_id = EXCLUDED.legacy_user_id,
              role = EXCLUDED.role,
              status = 'active',
              data = organization_memberships.data || EXCLUDED.data,
              updated_at = now()
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("organizationAccountId", NpgsqlDbType.Uuid, organizationAccountId);
        command.Parameters.AddWithValue("userAccountId", NpgsqlDbType.Uuid, userAccountId);
        command.Parameters.AddWithValue("organizationId", NpgsqlDbType.Text, organizationId);
        command.Parameters.AddWithValue("actorId", NpgsqlDbType.Text, actorId);
        command.Parameters.AddWithValue("role", NpgsqlDbType.Text, role);
        command.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, data.ToJsonString(JsonOptions));
        await command.ExecuteNonQueryAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    private async Task<IReadOnlyList<Dictionary<string, object?>>> ListOrganizationSummariesAsync(
        string actorId,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT
              org_account.legacy_owner_id AS organization_id,
              o.name,
              o.status,
              o.data::text AS organization_data_json,
              om.role,
              om.data::text AS membership_data_json
            FROM organization_memberships om
            JOIN accounts user_account ON user_account.id = om.user_account_id
            JOIN accounts org_account ON org_account.id = om.organization_account_id
            LEFT JOIN organizations o ON o.account_id = org_account.id
            WHERE user_account.legacy_owner_type = 'user'
              AND user_account.legacy_owner_id = @actorId
              AND om.status <> 'disabled'
            ORDER BY om.updated_at DESC, om.created_at DESC
            """,
            connection);
        command.Parameters.AddWithValue("actorId", NpgsqlDbType.Text, actorId);
        return (await PostgresRows.ReadManyAsync(command, cancellationToken)).Select(ToOrganizationSummary).ToArray();
    }

    private async Task<Guid> EnsureAccountIdAsync(AccountScope scope, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var accountId = await accounts.EnsureAccountAsync(connection, transaction, scope, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return accountId;
    }

    private async Task SaveApiCenterConfigAsync(
        AccountScope scope,
        JsonObject config,
        CancellationToken cancellationToken)
    {
        var accountId = await EnsureAccountIdAsync(scope, cancellationToken);
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO api_center_configs (account_id, data, updated_at)
            VALUES (@accountId, CAST(@data AS jsonb), now())
            ON CONFLICT (account_id) DO UPDATE SET
              data = EXCLUDED.data,
              updated_at = now()
            """,
            connection);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, config.ToJsonString(JsonOptions));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static Dictionary<string, object?> ToUserProfile(Dictionary<string, object?> row)
    {
        var data = ParseJsonObject(AsString(row, "data_json"));
        var actorId = AsString(row, "actor_id") ?? "guest";
        return new Dictionary<string, object?>
        {
            ["id"] = actorId,
            ["displayName"] = AsString(row, "display_name") ?? ReadJsonString(data, "displayName") ?? DefaultDisplayName(actorId),
            ["email"] = AsString(row, "email") ?? ReadJsonString(data, "email"),
            ["phone"] = ReadJsonString(data, "phone"),
            ["avatar"] = ReadJsonString(data, "avatar"),
            ["platformRole"] = ReadJsonString(data, "platformRole") ?? InferPlatformRole(actorId),
            ["status"] = AsString(row, "status") ?? "active",
            ["defaultOrganizationId"] = ReadJsonString(data, "defaultOrganizationId"),
        };
    }

    private static Dictionary<string, object?> ToOrganizationSummary(Dictionary<string, object?> row)
    {
        var organizationData = ParseJsonObject(AsString(row, "organization_data_json"));
        var membershipData = ParseJsonObject(AsString(row, "membership_data_json"));
        var role = NormalizeEnterpriseRole(AsString(row, "role"));
        return new Dictionary<string, object?>
        {
            ["id"] = AsString(row, "organization_id") ?? "org_demo_001",
            ["name"] = AsString(row, "name") ?? "XiaoLou Enterprise",
            ["role"] = role,
            ["membershipRole"] = role == "enterprise_admin" ? "admin" : ReadJsonString(membershipData, "membershipRole") ?? "member",
            ["status"] = AsString(row, "status") ?? "active",
            ["assetLibraryStatus"] = ReadJsonString(organizationData, "assetLibraryStatus") ?? "active",
        };
    }

    private static Dictionary<string, object?> ToOrganizationMember(Dictionary<string, object?> row)
    {
        var membershipData = ParseJsonObject(AsString(row, "membership_data_json"));
        var userData = ParseJsonObject(AsString(row, "user_data_json"));
        var organizationId = AsString(row, "legacy_organization_id") ?? "org_demo_001";
        var actorId = AsString(row, "legacy_user_id") ?? "user_demo_001";
        var role = NormalizeEnterpriseRole(AsString(row, "role"));
        return new Dictionary<string, object?>
        {
            ["id"] = $"{organizationId}:{actorId}",
            ["organizationId"] = organizationId,
            ["userId"] = actorId,
            ["displayName"] = ReadJsonString(membershipData, "displayName")
                ?? AsString(row, "display_name")
                ?? DefaultDisplayName(actorId),
            ["email"] = ReadJsonString(membershipData, "email") ?? AsString(row, "email"),
            ["phone"] = ReadJsonString(membershipData, "phone"),
            ["platformRole"] = ReadJsonString(userData, "platformRole") ?? "customer",
            ["role"] = role,
            ["membershipRole"] = role == "enterprise_admin" ? "admin" : ReadJsonString(membershipData, "membershipRole") ?? "member",
            ["department"] = ReadJsonString(membershipData, "department"),
            ["canUseOrganizationWallet"] = ReadJsonBool(membershipData, "canUseOrganizationWallet", true),
            ["status"] = AsString(row, "status") ?? "active",
            ["createdAt"] = ToIso(row.TryGetValue("created_at", out var createdAt) ? createdAt : null),
            ["updatedAt"] = ToIso(row.TryGetValue("updated_at", out var updatedAt) ? updatedAt : null),
            ["usageSummary"] = EmptyUsageSummary(),
        };
    }

    private static Dictionary<string, object?> BuildPermissionContext(
        Dictionary<string, object?> profile,
        IReadOnlyList<Dictionary<string, object?>> organizations)
    {
        var actorId = AsString(profile, "id") ?? "guest";
        var platformRole = AsString(profile, "platformRole") ?? InferPlatformRole(actorId);
        var currentOrganizationId = AsString(profile, "defaultOrganizationId")
            ?? organizations.FirstOrDefault()?["id"] as string;
        var currentOrganization = organizations.FirstOrDefault(item =>
            string.Equals(item["id"] as string, currentOrganizationId, StringComparison.Ordinal));
        var currentOrganizationRole = currentOrganization?["role"] as string;
        var isGuest = actorId == "guest" || platformRole == "guest";
        return new Dictionary<string, object?>
        {
            ["actor"] = new Dictionary<string, object?>
            {
                ["id"] = actorId,
                ["displayName"] = AsString(profile, "displayName") ?? DefaultDisplayName(actorId),
                ["email"] = AsString(profile, "email"),
                ["phone"] = AsString(profile, "phone"),
                ["avatar"] = AsString(profile, "avatar"),
                ["platformRole"] = platformRole,
                ["status"] = AsString(profile, "status") ?? "active",
                ["defaultOrganizationId"] = currentOrganizationId,
            },
            ["platformRole"] = platformRole,
            ["organizations"] = organizations,
            ["currentOrganizationId"] = currentOrganizationId,
            ["currentOrganizationRole"] = currentOrganizationRole,
            ["permissions"] = new Dictionary<string, object?>
            {
                ["canCreateProject"] = !isGuest && platformRole is not "ops_admin" and not "super_admin",
                ["canRecharge"] = !isGuest && platformRole is not "ops_admin" and not "super_admin",
                ["canUseEnterprise"] = organizations.Count > 0,
                ["canManageOrganization"] = organizations.Any(item => string.Equals(item["role"] as string, "enterprise_admin", StringComparison.Ordinal)),
                ["canManageOps"] = platformRole is "ops_admin" or "super_admin",
                ["canManageSystem"] = platformRole == "super_admin",
            },
        };
    }

    private static Dictionary<string, object?> BuildRegistrationResult(
        string actorId,
        Dictionary<string, object?> permissionContext,
        string mode,
        Dictionary<string, object?>? member)
    {
        var organizations = permissionContext.TryGetValue("organizations", out var value)
            ? value as IReadOnlyList<Dictionary<string, object?>>
            : null;
        var organization = organizations?.FirstOrDefault();
        var actor = permissionContext.TryGetValue("actor", out var actorValue)
            ? actorValue as Dictionary<string, object?>
            : null;
        return new Dictionary<string, object?>
        {
            ["actorId"] = actorId,
            ["permissionContext"] = permissionContext,
            ["wallets"] = Array.Empty<object>(),
            ["wallet"] = null,
            ["organization"] = organization is null
                ? null
                : new Dictionary<string, object?>
                {
                    ["id"] = organization["id"],
                    ["name"] = organization["name"],
                    ["status"] = organization["status"],
                    ["assetLibraryStatus"] = organization["assetLibraryStatus"],
                },
            ["member"] = member,
            ["onboarding"] = new Dictionary<string, object?>
            {
                ["mode"] = mode,
                ["title"] = mode == "personal" ? "Personal account ready" : "Enterprise account ready",
                ["detail"] = "Created in the Windows-native canonical identity surface.",
                ["tempPassword"] = null,
                ["generatedPassword"] = false,
            },
            ["displayName"] = actor?["displayName"],
            ["email"] = actor?["email"],
        };
    }

    private static JsonObject EnsureApiCenterShape(JsonObject? source)
    {
        var fallback = DefaultApiCenterConfig();
        if (source is null)
        {
            return fallback;
        }

        source["vendors"] ??= fallback["vendors"]?.DeepClone();
        source["defaults"] ??= fallback["defaults"]?.DeepClone();
        source["strategies"] ??= fallback["strategies"]?.DeepClone();
        source["nodeAssignments"] ??= fallback["nodeAssignments"]?.DeepClone();
        source["toolboxAssignments"] ??= fallback["toolboxAssignments"]?.DeepClone();
        return source;
    }

    private static JsonObject DefaultApiCenterConfig()
    {
        return new JsonObject
        {
            ["vendors"] = new JsonArray
            {
                Vendor("dashscope", "Alibaba Cloud DashScope", new[] { "text", "vision", "audio" }, new[]
                {
                    Model("qwen-plus", "Qwen Plus", "text", true),
                    Model("qwen-vl-plus", "Qwen VL Plus", "vision", true),
                    Model("qwen-audio-turbo", "Qwen Audio Turbo", "audio", true),
                }),
                Vendor("bytedance", "Volcengine Ark", new[] { "text", "vision", "image", "video" }, new[]
                {
                    Model("doubao-seed-1-6", "Doubao Seed 1.6", "text", true),
                    Model("doubao-seedream-5-0-260128", "Seedream 5.0", "image", true),
                    Model("doubao-seedance-2-0-260128", "Seedance 2.0", "video", true),
                }),
                Vendor("kling", "Kling AI", new[] { "image", "video" }, new[]
                {
                    Model("kling-v2-master", "Kling V2 Master", "video", false),
                    Model("kolors", "Kolors", "image", false),
                }),
            },
            ["defaults"] = new JsonObject
            {
                ["textModelId"] = "doubao-seed-1-6",
                ["visionModelId"] = "qwen-vl-plus",
                ["imageModelId"] = "doubao-seedream-5-0-260128",
                ["videoModelId"] = "doubao-seedance-2-0-260128",
                ["audioModelId"] = "qwen-audio-turbo",
            },
            ["strategies"] = new JsonObject
            {
                ["script"] = "textModelId",
                ["image"] = "imageModelId",
                ["video"] = "videoModelId",
                ["audio"] = "audioModelId",
            },
            ["nodeAssignments"] = new JsonArray(),
            ["toolboxAssignments"] = new JsonArray(),
        };
    }

    private static JsonObject Vendor(string id, string name, string[] supportedDomains, JsonObject[] models)
    {
        return new JsonObject
        {
            ["id"] = id,
            ["name"] = name,
            ["connected"] = false,
            ["apiKeyConfigured"] = false,
            ["lastCheckedAt"] = null,
            ["supportedDomains"] = new JsonArray(supportedDomains.Select(item => JsonValue.Create(item)).ToArray<JsonNode?>()),
            ["models"] = new JsonArray(models),
        };
    }

    private static JsonObject Model(string id, string name, string domain, bool enabled)
    {
        return new JsonObject
        {
            ["id"] = id,
            ["name"] = name,
            ["domain"] = domain,
            ["enabled"] = enabled,
        };
    }

    private static JsonObject FindVendor(JsonObject config, string vendorId)
    {
        var vendors = config["vendors"] as JsonArray ?? new JsonArray();
        var vendor = vendors.OfType<JsonObject>()
            .FirstOrDefault(item => string.Equals(item["id"]?.GetValue<string>(), vendorId, StringComparison.Ordinal));
        if (vendor is null)
        {
            throw new KeyNotFoundException("API vendor is not available in the canonical API center config.");
        }

        return vendor;
    }

    private static JsonObject SanitizeVendor(JsonObject vendor)
    {
        var clone = vendor.DeepClone().AsObject();
        clone.Remove("apiKeyHash");
        return clone;
    }

    private static JsonObject? ParseJsonObject(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        try
        {
            return JsonNode.Parse(raw) as JsonObject;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string? ReadJsonString(JsonObject? data, string key)
    {
        return data is not null && data.TryGetPropertyValue(key, out var value)
            ? value?.GetValue<string>()
            : null;
    }

    private static bool ReadJsonBool(JsonObject? data, string key, bool fallback)
    {
        if (data is null || !data.TryGetPropertyValue(key, out var value) || value is null)
        {
            return fallback;
        }

        return value.GetValueKind() == JsonValueKind.True
            || (value.GetValueKind() == JsonValueKind.String && bool.TryParse(value.GetValue<string>(), out var parsed) && parsed);
    }

    private static Dictionary<string, object?> EmptyUsageSummary()
    {
        return new Dictionary<string, object?>
        {
            ["todayUsedCredits"] = 0,
            ["monthUsedCredits"] = 0,
            ["totalUsedCredits"] = 0,
            ["refundedCredits"] = 0,
            ["pendingFrozenCredits"] = 0,
            ["recentTaskCount"] = 0,
            ["lastActivityAt"] = null,
        };
    }

    private static string NormalizeActorId(string? actorId)
    {
        return NormalizeOwnerId(actorId, "guest");
    }

    private static string NormalizeOwnerId(string? value, string fallback)
    {
        var normalized = NormalizeBlank(value);
        return normalized ?? fallback;
    }

    private static string? NormalizeBlank(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    private static string ActorIdFromEmail(string email, string mode)
    {
        var normalized = email.Trim().ToLowerInvariant();
        if (mode == "ops_admin" || normalized.Contains("ops", StringComparison.Ordinal))
        {
            return "ops_demo_001";
        }

        if (mode == "enterprise_admin" || normalized.Contains("admin", StringComparison.Ordinal))
        {
            return "user_demo_001";
        }

        if (normalized.Contains("member", StringComparison.Ordinal))
        {
            return "user_member_001";
        }

        var segment = new string(normalized.Select(ch => char.IsAsciiLetterOrDigit(ch) ? ch : '_').ToArray())
            .Trim('_');
        return string.IsNullOrWhiteSpace(segment) ? "user_demo_001" : $"user_{segment[..Math.Min(segment.Length, 48)]}";
    }

    private static string OrganizationIdFromName(string name)
    {
        var segment = new string(name.Trim().ToLowerInvariant()
                .Select(ch => char.IsAsciiLetterOrDigit(ch) ? ch : '_')
                .ToArray())
            .Trim('_');
        return string.IsNullOrWhiteSpace(segment) ? "org_demo_001" : $"org_{segment[..Math.Min(segment.Length, 48)]}";
    }

    private static string EmailLocalPart(string email)
    {
        var localPart = email.Split('@', 2)[0].Trim();
        return string.IsNullOrWhiteSpace(localPart) ? "Windows Native User" : localPart;
    }

    private static string DefaultDisplayName(string actorId)
    {
        return actorId switch
        {
            "guest" => "Guest",
            "user_demo_001" => "Enterprise Admin",
            "user_member_001" => "Enterprise Member",
            "ops_demo_001" => "Ops Admin",
            _ when InferPlatformRole(actorId) == "super_admin" => "Super Admin",
            _ => "Registered User",
        };
    }

    private static string? DefaultEmail(string actorId)
    {
        return actorId switch
        {
            "guest" => null,
            "user_demo_001" => "admin@xiaolou.local",
            "user_member_001" => "member@xiaolou.local",
            "ops_demo_001" => "ops@xiaolou.local",
            _ when InferPlatformRole(actorId) == "super_admin" => "root@xiaolou.local",
            _ => "user@xiaolou.local",
        };
    }

    private static string InferPlatformRole(string actorId)
    {
        if (actorId == "guest")
        {
            return "guest";
        }

        if (actorId.Contains("super", StringComparison.OrdinalIgnoreCase)
            || actorId.Contains("root", StringComparison.OrdinalIgnoreCase))
        {
            return "super_admin";
        }

        return actorId.Contains("ops", StringComparison.OrdinalIgnoreCase) ? "ops_admin" : "customer";
    }

    private static string NormalizeEnterpriseRole(string? role)
    {
        return string.Equals(role, "enterprise_admin", StringComparison.OrdinalIgnoreCase)
            ? "enterprise_admin"
            : "enterprise_member";
    }

    private static string? HashOptional(string? value)
    {
        var normalized = NormalizeBlank(value);
        return normalized is null ? null : Sha256Hex(normalized);
    }

    private static string Sha256Hex(string value)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    private static object DbNullable<T>(T? value)
    {
        return value is null ? DBNull.Value : value;
    }

    private static string? AsString(Dictionary<string, object?> row, string key)
    {
        return row.TryGetValue(key, out var value) && value is not null ? Convert.ToString(value) : null;
    }

    private static string ToIso(object? value)
    {
        return value switch
        {
            DateTimeOffset dto => dto.ToString("O"),
            DateTime dt => DateTime.SpecifyKind(dt, DateTimeKind.Utc).ToString("O"),
            null => DateTimeOffset.UtcNow.ToString("O"),
            _ => Convert.ToString(value) ?? DateTimeOffset.UtcNow.ToString("O"),
        };
    }
}
