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
    private static readonly TimeSpan PasswordResetTokenTtl = TimeSpan.FromMinutes(30);
    private const string DefaultSuperAdminPassword = "admin";
    private const int PasswordResetRateLimit = 3;

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
        var organizations = await ListOrganizationSummariesAsync(normalizedActorId, cancellationToken);
        var displayName = NormalizeBlank(request.DisplayName) ?? AsString(current, "displayName") ?? DefaultDisplayName(normalizedActorId);
        var avatar = request.Avatar is null ? AsString(current, "avatar") : NormalizeBlank(request.Avatar);
        var phone = request.Phone is null ? AsString(current, "phone") : NormalizeBlank(request.Phone);
        var defaultOrganizationId = request.DefaultOrganizationId is null
            ? AsString(current, "defaultOrganizationId")
            : NormalizeBlank(request.DefaultOrganizationId);
        if (phone is not null && !string.Equals(phone, AsString(current, "phone"), StringComparison.Ordinal))
        {
            await RequireUniqueAccountContactAsync(null, phone, normalizedActorId, cancellationToken);
        }

        if (defaultOrganizationId is not null)
        {
            var defaultOrganization = organizations.FirstOrDefault(item =>
                string.Equals(AsString(item, "id"), defaultOrganizationId, StringComparison.Ordinal));
            var defaultOrganizationRole = defaultOrganization is null ? null : AsString(defaultOrganization, "role");
            if (defaultOrganization is null || defaultOrganizationRole is not ("enterprise_admin" or "enterprise_member"))
            {
                throw new ArgumentException("defaultOrganizationId must belong to an enterprise organization for the current user");
            }
        }

        await EnsureUserAsync(
            normalizedActorId,
            displayName,
            AsString(current, "email"),
            phone,
            AsString(current, "platformRole") ?? InferPlatformRole(normalizedActorId),
            defaultOrganizationId,
            avatar,
            null,
            false,
            cancellationToken);

        return await GetPermissionContextAsync(normalizedActorId, cancellationToken);
    }

    public async Task<Dictionary<string, object?>> LoginWithEmailAsync(
        LoginRequest request,
        string mode,
        CancellationToken cancellationToken)
    {
        var email = RequireEmail(request.Email);
        var password = RequirePassword(request.Password);
        if (email == "root@xiaolou.local")
        {
            await EnsureDemoIdentityAsync("root_demo_001", cancellationToken);
        }

        var user = await GetPasswordUserRecordByEmailAsync(email, cancellationToken);
        if (user is null || !PasswordHashing.VerifyPassword(password, AsString(user, "password_hash")))
        {
            throw InvalidCredentials();
        }

        var actorId = AsString(user, "actor_id") ?? throw InvalidCredentials();
        var permissionContext = await GetPermissionContextAsync(actorId, cancellationToken);
        var resolvedPlatformRole = AsString(permissionContext, "platformRole") ?? "guest";
        if (mode == "ops_admin")
        {
            if (resolvedPlatformRole is not "ops_admin" and not "super_admin")
            {
                throw InvalidCredentials();
            }
        }

        return permissionContext;
    }

    public async Task<Dictionary<string, object?>> BootstrapPlatformPasswordAsync(
        BootstrapPlatformPasswordRequest request,
        CancellationToken cancellationToken)
    {
        var email = RequireEmail(request.Email);
        var password = RequirePassword(request.Password);
        var actorId = ActorIdFromEmail(email, "ops_admin");
        RequireReservedPlatformActor(actorId);

        await EnsureDemoIdentityAsync(actorId, cancellationToken);
        var existingHash = await GetPasswordHashAsync(actorId, cancellationToken);
        if (existingHash is not null)
        {
            if (!PasswordHashing.VerifyPassword(password, existingHash))
            {
                throw InvalidCredentials();
            }

            return await BuildPasswordConfiguredResultAsync(actorId, false, cancellationToken);
        }

        await EnsureUserAsync(
            actorId,
            DefaultDisplayName(actorId),
            email,
            null,
            InferPlatformRole(actorId),
            null,
            null,
            PasswordHashing.HashPassword(password),
            false,
            cancellationToken);

        return await BuildPasswordConfiguredResultAsync(actorId, true, cancellationToken);
    }

    public async Task<Dictionary<string, object?>> ChangePasswordAsync(
        string actorId,
        ChangePasswordRequest request,
        CancellationToken cancellationToken)
    {
        var normalizedActorId = NormalizeActorId(actorId);
        var currentPassword = RequirePassword(request.CurrentPassword);
        var newPassword = RequirePassword(request.NewPassword);
        var existingHash = await GetPasswordHashAsync(normalizedActorId, cancellationToken);
        if (!PasswordHashing.VerifyPassword(currentPassword, existingHash))
        {
            throw InvalidCredentials();
        }

        await UpdatePasswordHashAsync(
            normalizedActorId,
            PasswordHashing.HashPassword(newPassword),
            cancellationToken);
        return await BuildPasswordConfiguredResultAsync(normalizedActorId, true, cancellationToken);
    }

    public async Task<Dictionary<string, object?>> AdminResetPasswordAsync(
        AdminResetPasswordRequest request,
        CancellationToken cancellationToken)
    {
        var email = RequireEmail(request.Email);
        var newPassword = RequirePassword(request.NewPassword);
        var user = await GetPasswordUserRecordByEmailAsync(email, cancellationToken);
        if (user is null || ResolvePlatformRole(user) is "ops_admin" or "super_admin")
        {
            throw new ArgumentException("account is not available");
        }

        var actorId = AsString(user, "actor_id") ?? throw new ArgumentException("account is not available");
        await UpdatePasswordHashAsync(
            actorId,
            PasswordHashing.HashPassword(newPassword),
            cancellationToken);
        return await BuildPasswordConfiguredResultAsync(actorId, true, cancellationToken);
    }

    public async Task<Dictionary<string, object?>> RequestPasswordResetAsync(
        RequestPasswordResetRequest request,
        bool includeResetToken,
        CancellationToken cancellationToken)
    {
        var email = RequireEmail(request.Email);
        var user = await GetPasswordUserRecordByEmailAsync(email, cancellationToken);
        var actorId = user is null ? null : AsString(user, "actor_id");
        if (user is null || actorId is null || ResolvePlatformRole(user) is "ops_admin" or "super_admin")
        {
            await RecordPasswordAuditAsync(
                "password.reset.request",
                "accepted_without_account",
                null,
                email,
                new JsonObject { ["tokenIssued"] = false },
                cancellationToken);
            return BuildPasswordResetRequestResult(email, null, null, includeResetToken);
        }

        if (await CountRecentPasswordResetRequestsAsync(actorId, cancellationToken) >= PasswordResetRateLimit)
        {
            await RecordPasswordAuditAsync(
                "password.reset.request",
                "rate_limited",
                actorId,
                email,
                new JsonObject { ["tokenIssued"] = false },
                cancellationToken);
            return BuildPasswordResetRequestResult(email, null, null, includeResetToken);
        }

        var token = PasswordHashing.GenerateResetToken();
        var expiresAt = DateTimeOffset.UtcNow.Add(PasswordResetTokenTtl);
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO password_reset_tokens (
              user_account_id,
              actor_id,
              email,
              token_hash,
              status,
              expires_at,
              data
            )
            VALUES (
              @accountId,
              @actorId,
              @email,
              @tokenHash,
              'issued',
              @expiresAt,
              jsonb_build_object('delivery', @delivery)
            )
            """,
            connection);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, (Guid)user["account_id"]!);
        command.Parameters.AddWithValue("actorId", NpgsqlDbType.Text, actorId);
        command.Parameters.AddWithValue("email", NpgsqlDbType.Text, email);
        command.Parameters.AddWithValue("tokenHash", NpgsqlDbType.Text, PasswordResetTokenHash(token));
        command.Parameters.AddWithValue("expiresAt", NpgsqlDbType.TimestampTz, expiresAt);
        command.Parameters.AddWithValue(
            "delivery",
            NpgsqlDbType.Text,
            includeResetToken ? "local_token" : "email_unconfigured");
        await command.ExecuteNonQueryAsync(cancellationToken);

        await RecordPasswordAuditAsync(
            "password.reset.request",
            "issued",
            actorId,
            email,
            new JsonObject
            {
                ["delivery"] = includeResetToken ? "local_token" : "email_unconfigured",
                ["tokenIssued"] = true,
            },
            cancellationToken);
        return BuildPasswordResetRequestResult(email, token, expiresAt, includeResetToken);
    }

    public async Task<Dictionary<string, object?>> CompletePasswordResetAsync(
        CompletePasswordResetRequest request,
        CancellationToken cancellationToken)
    {
        var resetToken = RequireResetToken(request.ResetToken);
        var newPassword = RequirePassword(request.NewPassword);
        var resetTokenHash = PasswordResetTokenHash(resetToken);
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        await using var findToken = new NpgsqlCommand(
            """
            SELECT
              id,
              user_account_id,
              actor_id,
              email,
              status,
              expires_at,
              consumed_at
            FROM password_reset_tokens
            WHERE token_hash = @tokenHash
            LIMIT 1
            FOR UPDATE
            """,
            connection,
            transaction);
        findToken.Parameters.AddWithValue("tokenHash", NpgsqlDbType.Text, resetTokenHash);
        var row = await PostgresRows.ReadSingleAsync(findToken, cancellationToken);
        if (row is null)
        {
            await InsertPasswordAuditAsync(
                connection,
                transaction,
                null,
                null,
                "password.reset.complete",
                "invalid_token",
                new JsonObject(),
                cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            throw InvalidCredentials();
        }

        var actorId = AsString(row, "actor_id") ?? "guest";
        var email = AsString(row, "email");
        var status = AsString(row, "status");
        var expiresAt = ToDateTimeOffset(row["expires_at"]);
        if (!string.Equals(status, "issued", StringComparison.Ordinal)
            || row["consumed_at"] is not null
            || expiresAt <= DateTimeOffset.UtcNow)
        {
            await MarkExpiredPasswordResetTokenAsync(
                connection,
                transaction,
                (Guid)row["id"]!,
                expiresAt <= DateTimeOffset.UtcNow,
                cancellationToken);
            await InsertPasswordAuditAsync(
                connection,
                transaction,
                actorId,
                email,
                "password.reset.complete",
                expiresAt <= DateTimeOffset.UtcNow ? "expired" : "invalid_token",
                new JsonObject(),
                cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            throw InvalidCredentials();
        }

        await using var updatePassword = new NpgsqlCommand(
            """
            UPDATE users
            SET password_hash = @passwordHash,
                updated_at = now()
            WHERE account_id = @accountId
            """,
            connection,
            transaction);
        updatePassword.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, (Guid)row["user_account_id"]!);
        updatePassword.Parameters.AddWithValue("passwordHash", NpgsqlDbType.Text, PasswordHashing.HashPassword(newPassword));
        var updated = await updatePassword.ExecuteNonQueryAsync(cancellationToken);
        if (updated == 0)
        {
            await InsertPasswordAuditAsync(
                connection,
                transaction,
                actorId,
                email,
                "password.reset.complete",
                "account_missing",
                new JsonObject(),
                cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            throw InvalidCredentials();
        }

        await using var consumeToken = new NpgsqlCommand(
            """
            UPDATE password_reset_tokens
            SET status = 'consumed',
                consumed_at = now(),
                updated_at = now()
            WHERE id = @id
            """,
            connection,
            transaction);
        consumeToken.Parameters.AddWithValue("id", NpgsqlDbType.Uuid, (Guid)row["id"]!);
        await consumeToken.ExecuteNonQueryAsync(cancellationToken);

        await using var revokeOtherTokens = new NpgsqlCommand(
            """
            UPDATE password_reset_tokens
            SET status = 'revoked',
                updated_at = now()
            WHERE actor_id = @actorId
              AND id <> @id
              AND status = 'issued'
            """,
            connection,
            transaction);
        revokeOtherTokens.Parameters.AddWithValue("actorId", NpgsqlDbType.Text, actorId);
        revokeOtherTokens.Parameters.AddWithValue("id", NpgsqlDbType.Uuid, (Guid)row["id"]!);
        await revokeOtherTokens.ExecuteNonQueryAsync(cancellationToken);

        await InsertPasswordAuditAsync(
            connection,
            transaction,
            actorId,
            email,
            "password.reset.complete",
            "updated",
            new JsonObject(),
            cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return await BuildPasswordConfiguredResultAsync(actorId, true, cancellationToken);
    }

    public async Task<Dictionary<string, object?>> RegisterPersonalAsync(
        RegisterPersonalRequest request,
        CancellationToken cancellationToken)
    {
        var email = RequireEmail(request.Email);
        var password = RequirePassword(request.Password);
        RejectReservedPlatformEmail(email);
        await RequireUniqueAccountContactAsync(email, request.Phone, null, cancellationToken);
        var actorId = NewUserId();
        var displayName = NormalizeBlank(request.DisplayName) ?? EmailLocalPart(email);
        var passwordHash = PasswordHashing.HashPassword(password);
        await EnsureUserAsync(actorId, displayName, email, request.Phone, "customer", null, null, passwordHash, false, cancellationToken);
        var permissionContext = await GetPermissionContextAsync(actorId, cancellationToken);
        return BuildRegistrationResult(actorId, permissionContext, "personal", null);
    }

    public async Task<Dictionary<string, object?>> RegisterEnterpriseAdminAsync(
        RegisterEnterpriseAdminRequest request,
        CancellationToken cancellationToken)
    {
        var email = RequireEmail(request.Email);
        var password = RequirePassword(request.Password);
        RejectReservedPlatformEmail(email);
        await RequireUniqueAccountContactAsync(email, request.Phone, null, cancellationToken);
        var actorId = NewUserId();
        var companyName = NormalizeBlank(request.CompanyName) ?? "XiaoLou Enterprise";
        var organizationId = OrganizationIdFromName(companyName);
        var adminName = NormalizeBlank(request.AdminName) ?? EmailLocalPart(email);
        var passwordHash = PasswordHashing.HashPassword(password);
        await EnsureOrganizationAsync(organizationId, companyName, cancellationToken);
        await EnsureUserAsync(actorId, adminName, email, request.Phone, "customer", organizationId, null, passwordHash, false, cancellationToken);
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
        string? query,
        CancellationToken cancellationToken)
    {
        var normalizedQuery = NormalizeBlank(query);
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
              u.data::text AS user_data_json,
              usage.today_used_credits,
              usage.month_used_credits,
              usage.total_used_credits,
              usage.refunded_credits,
              usage.recent_task_count,
              usage.last_activity_at,
              usage.series_json::text AS usage_series_json
            FROM organization_memberships om
            JOIN accounts org_account ON org_account.id = om.organization_account_id
            JOIN accounts user_account ON user_account.id = om.user_account_id
            LEFT JOIN users u ON u.account_id = user_account.id
            LEFT JOIN LATERAL (
              SELECT
                COALESCE(SUM(CASE
                  WHEN ledger.amount_value < 0 AND ledger.created_at >= date_trunc('day', now()) THEN abs(ledger.amount_value)
                  ELSE 0
                END), 0) AS today_used_credits,
                COALESCE(SUM(CASE
                  WHEN ledger.amount_value < 0 AND ledger.created_at >= date_trunc('month', now()) THEN abs(ledger.amount_value)
                  ELSE 0
                END), 0) AS month_used_credits,
                COALESCE(SUM(CASE WHEN ledger.amount_value < 0 THEN abs(ledger.amount_value) ELSE 0 END), 0) AS total_used_credits,
                COALESCE(SUM(CASE WHEN ledger.entry_type = 'refund' THEN abs(ledger.amount_value) ELSE 0 END), 0) AS refunded_credits,
                COUNT(*) FILTER (WHERE ledger.amount_value < 0) AS recent_task_count,
                MAX(ledger.created_at) AS last_activity_at,
                COALESCE((
                  SELECT jsonb_agg(
                    jsonb_build_object(
                      'bucketStart', bucket.bucket_start,
                      'bucketLabel', to_char(bucket.bucket_start, 'MM-DD'),
                      'consumedCredits', bucket.consumed_credits,
                      'refundedCredits', bucket.refunded_credits
                    )
                    ORDER BY bucket.bucket_start
                  )
                  FROM (
                    SELECT
                      date_trunc('day', wl.created_at) AS bucket_start,
                      COALESCE(SUM(CASE
                        WHEN COALESCE(NULLIF(wl.credit_amount, 0), wl.amount, 0) < 0
                        THEN abs(COALESCE(NULLIF(wl.credit_amount, 0), wl.amount, 0))
                        ELSE 0
                      END), 0) AS consumed_credits,
                      COALESCE(SUM(CASE
                        WHEN wl.entry_type = 'refund'
                        THEN abs(COALESCE(NULLIF(wl.credit_amount, 0), wl.amount, 0))
                        ELSE 0
                      END), 0) AS refunded_credits
                    FROM wallet_ledger wl
                    WHERE (wl.account_id = org_account.id OR wl.wallet_id = org_account.id::text)
                      AND wl.actor_id = om.legacy_user_id
                      AND wl.created_at >= now() - interval '30 days'
                    GROUP BY date_trunc('day', wl.created_at)
                  ) bucket
                ), '[]'::jsonb) AS series_json
              FROM (
                SELECT
                  COALESCE(NULLIF(wl.credit_amount, 0), wl.amount, 0) AS amount_value,
                  wl.entry_type,
                  wl.created_at
                FROM wallet_ledger wl
                WHERE (wl.account_id = org_account.id OR wl.wallet_id = org_account.id::text)
                  AND wl.actor_id = om.legacy_user_id
              ) ledger
            ) usage ON true
            WHERE org_account.legacy_owner_type = 'organization'
              AND org_account.legacy_owner_id = @organizationId
              AND om.status <> 'disabled'
              AND (
                @query IS NULL
                OR lower(om.legacy_user_id) LIKE @query ESCAPE '\'
                OR lower(COALESCE(om.data->>'displayName', u.display_name, '')) LIKE @query ESCAPE '\'
                OR lower(COALESCE(om.data->>'email', u.email, '')) LIKE @query ESCAPE '\'
                OR lower(COALESCE(om.data->>'phone', '')) LIKE @query ESCAPE '\'
              )
            ORDER BY om.updated_at DESC, om.created_at DESC
            LIMIT 200
            """,
            connection);
        command.Parameters.AddWithValue("organizationId", NpgsqlDbType.Text, organizationId);
        command.Parameters.AddWithValue("query", NpgsqlDbType.Text, DbNullable(normalizedQuery is null ? null : $"%{EscapeLike(normalizedQuery.ToLowerInvariant())}%"));
        return (await PostgresRows.ReadManyAsync(command, cancellationToken)).Select(ToOrganizationMember).ToArray();
    }

    public Task<IReadOnlyList<Dictionary<string, object?>>> ListOrganizationMembersAsync(
        string organizationId,
        CancellationToken cancellationToken)
    {
        return ListOrganizationMembersAsync(organizationId, null, cancellationToken);
    }

    public async Task<Dictionary<string, object?>> CreateOrganizationMemberAsync(
        string organizationId,
        CreateOrganizationMemberRequest request,
        CancellationToken cancellationToken)
    {
        var normalizedOrganizationId = NormalizeOwnerId(organizationId, "org_demo_001");
        await EnsureDemoOrganizationAsync(normalizedOrganizationId, cancellationToken);
        var email = RequireEmail(request.Email);
        RejectReservedPlatformEmail(email);
        await RequireUniqueAccountContactAsync(email, request.Phone, null, cancellationToken);
        var requestedPassword = NormalizeBlank(request.Password);
        var generatedPassword = requestedPassword is null ? PasswordHashing.GenerateTemporaryPassword() : null;
        var password = requestedPassword ?? generatedPassword ?? throw new InvalidOperationException("Failed to generate member password.");
        var passwordHash = PasswordHashing.HashPassword(password);
        var membershipRole = string.Equals(request.MembershipRole, "admin", StringComparison.OrdinalIgnoreCase)
            ? "admin"
            : "member";
        var role = membershipRole == "admin" ? "enterprise_admin" : "enterprise_member";
        var actorId = NewUserId();
        var displayName = NormalizeBlank(request.DisplayName) ?? EmailLocalPart(email);
        await EnsureUserAsync(actorId, displayName, email, request.Phone, "customer", normalizedOrganizationId, null, passwordHash, true, cancellationToken);
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
        return BuildRegistrationResult(actorId, permissionContext, role, member, generatedPassword, generatedPassword is not null);
    }

    public async Task<Dictionary<string, object?>> ResetOrganizationMemberPasswordAsync(
        string organizationId,
        string userId,
        OrganizationMemberPasswordResetRequest request,
        CancellationToken cancellationToken)
    {
        var normalizedOrganizationId = NormalizeOwnerId(organizationId, "org_demo_001");
        var normalizedUserId = NormalizeActorId(userId);
        var newPassword = RequirePassword(request.NewPassword);
        if (await GetOrganizationMemberPasswordRecordAsync(normalizedOrganizationId, normalizedUserId, cancellationToken) is null)
        {
            throw new ArgumentException("member is not available");
        }

        await UpdatePasswordHashAsync(
            normalizedUserId,
            PasswordHashing.HashPassword(newPassword),
            cancellationToken);
        return await BuildPasswordConfiguredResultAsync(normalizedUserId, true, cancellationToken);
    }

    public async Task<Dictionary<string, object?>> UpdateOrganizationMemberAccountAsync(
        string organizationId,
        string userId,
        UpdateOrganizationMemberAccountRequest request,
        CancellationToken cancellationToken)
    {
        var normalizedOrganizationId = NormalizeOwnerId(organizationId, "org_demo_001");
        var normalizedUserId = NormalizeActorId(userId);
        var existing = await GetOrganizationMemberRecordAsync(normalizedOrganizationId, normalizedUserId, cancellationToken)
            ?? throw new ArgumentException("member is not available");
        var membershipData = ParseJsonObject(AsString(existing, "membership_data_json"));
        var displayName = request.DisplayName is null
            ? ReadJsonString(membershipData, "displayName") ?? AsString(existing, "display_name") ?? DefaultDisplayName(normalizedUserId)
            : NormalizeBlank(request.DisplayName) ?? throw new ArgumentException("displayName is required");
        var email = request.Email is null
            ? ReadJsonString(membershipData, "email") ?? AsString(existing, "email") ?? throw new ArgumentException("email is required")
            : RequireEmail(request.Email);
        RejectReservedPlatformEmail(email);
        var phone = request.Phone is null
            ? ReadJsonString(membershipData, "phone")
            : NormalizeBlank(request.Phone);
        var department = request.Department is null
            ? ReadJsonString(membershipData, "department")
            : NormalizeBlank(request.Department);
        var membershipRole = request.MembershipRole is null
            ? NormalizeEnterpriseRole(AsString(existing, "role")) == "enterprise_admin"
                ? "admin"
                : ReadJsonString(membershipData, "membershipRole") ?? "member"
            : string.Equals(request.MembershipRole, "admin", StringComparison.OrdinalIgnoreCase)
                ? "admin"
                : "member";
        var role = membershipRole == "admin" ? "enterprise_admin" : "enterprise_member";
        var canUseOrganizationWallet = request.CanUseOrganizationWallet
            ?? ReadJsonBool(membershipData, "canUseOrganizationWallet", true);
        var currentEmail = NormalizeEmail(ReadJsonString(membershipData, "email") ?? AsString(existing, "email"));
        var currentPhone = NormalizeBlank(ReadJsonString(membershipData, "phone"));
        if (!string.Equals(currentEmail, NormalizeEmail(email), StringComparison.Ordinal)
            || !string.Equals(currentPhone, phone, StringComparison.Ordinal))
        {
            await RequireUniqueAccountContactAsync(email, phone, normalizedUserId, cancellationToken);
        }

        var passwordHash = request.NewPassword is null
            ? null
            : PasswordHashing.HashPassword(RequirePassword(request.NewPassword));
        var userPatch = new JsonObject
        {
            ["phone"] = phone,
        };
        var membershipPatch = new JsonObject
        {
            ["displayName"] = displayName,
            ["email"] = email,
            ["phone"] = phone,
            ["department"] = department,
            ["membershipRole"] = membershipRole,
            ["canUseOrganizationWallet"] = canUseOrganizationWallet,
        };

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var userAccountId = AsGuid(existing, "user_account_id");
        var organizationAccountId = AsGuid(existing, "organization_account_id");
        await using var updateUser = new NpgsqlCommand(
            """
            UPDATE users
            SET email = @email,
                phone_hash = @phoneHash,
                password_hash = CASE
                    WHEN @passwordHash IS NULL THEN password_hash
                    ELSE @passwordHash
                END,
                display_name = @displayName,
                status = 'active',
                data = data || CAST(@userData AS jsonb),
                updated_at = now()
            WHERE account_id = @userAccountId
            """,
            connection,
            transaction);
        updateUser.Parameters.AddWithValue("userAccountId", NpgsqlDbType.Uuid, userAccountId);
        updateUser.Parameters.AddWithValue("email", NpgsqlDbType.Text, email);
        updateUser.Parameters.AddWithValue("phoneHash", NpgsqlDbType.Text, DbNullable(HashOptional(phone)));
        updateUser.Parameters.AddWithValue("passwordHash", NpgsqlDbType.Text, DbNullable(passwordHash));
        updateUser.Parameters.AddWithValue("displayName", NpgsqlDbType.Text, displayName);
        updateUser.Parameters.AddWithValue("userData", NpgsqlDbType.Jsonb, userPatch.ToJsonString(JsonOptions));
        await updateUser.ExecuteNonQueryAsync(cancellationToken);

        await using var updateMembership = new NpgsqlCommand(
            """
            UPDATE organization_memberships
            SET role = @role,
                status = 'active',
                data = data || CAST(@membershipData AS jsonb),
                updated_at = now()
            WHERE organization_account_id = @organizationAccountId
              AND user_account_id = @userAccountId
            """,
            connection,
            transaction);
        updateMembership.Parameters.AddWithValue("organizationAccountId", NpgsqlDbType.Uuid, organizationAccountId);
        updateMembership.Parameters.AddWithValue("userAccountId", NpgsqlDbType.Uuid, userAccountId);
        updateMembership.Parameters.AddWithValue("role", NpgsqlDbType.Text, role);
        updateMembership.Parameters.AddWithValue("membershipData", NpgsqlDbType.Jsonb, membershipPatch.ToJsonString(JsonOptions));
        await updateMembership.ExecuteNonQueryAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        var members = await ListOrganizationMembersAsync(normalizedOrganizationId, normalizedUserId, cancellationToken);
        return members.FirstOrDefault(item => string.Equals(AsString(item, "userId"), normalizedUserId, StringComparison.Ordinal))
            ?? throw new ArgumentException("member is not available");
    }

    public async Task<Dictionary<string, object?>> DeleteOrganizationMemberAccountAsync(
        string organizationId,
        string userId,
        CancellationToken cancellationToken)
    {
        var normalizedOrganizationId = NormalizeOwnerId(organizationId, "org_demo_001");
        var normalizedUserId = NormalizeActorId(userId);
        var existing = await GetOrganizationMemberRecordAsync(normalizedOrganizationId, normalizedUserId, cancellationToken)
            ?? throw new ArgumentException("member is not available");
        var deletedAt = DateTimeOffset.UtcNow.ToString("O");
        var deletionPatch = new JsonObject
        {
            ["deletedAt"] = deletedAt,
            ["phone"] = null,
        };

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var userAccountId = AsGuid(existing, "user_account_id");
        var organizationAccountId = AsGuid(existing, "organization_account_id");
        await using var updateMembership = new NpgsqlCommand(
            """
            UPDATE organization_memberships
            SET status = 'disabled',
                data = data || CAST(@deletionData AS jsonb),
                updated_at = now()
            WHERE organization_account_id = @organizationAccountId
              AND user_account_id = @userAccountId
            """,
            connection,
            transaction);
        updateMembership.Parameters.AddWithValue("organizationAccountId", NpgsqlDbType.Uuid, organizationAccountId);
        updateMembership.Parameters.AddWithValue("userAccountId", NpgsqlDbType.Uuid, userAccountId);
        updateMembership.Parameters.AddWithValue("deletionData", NpgsqlDbType.Jsonb, deletionPatch.ToJsonString(JsonOptions));
        await updateMembership.ExecuteNonQueryAsync(cancellationToken);

        await using var updateUser = new NpgsqlCommand(
            """
            UPDATE users
            SET email = NULL,
                phone_hash = NULL,
                password_hash = NULL,
                status = 'disabled',
                data = data || CAST(@deletionData AS jsonb),
                updated_at = now()
            WHERE account_id = @userAccountId
            """,
            connection,
            transaction);
        updateUser.Parameters.AddWithValue("userAccountId", NpgsqlDbType.Uuid, userAccountId);
        updateUser.Parameters.AddWithValue("deletionData", NpgsqlDbType.Jsonb, deletionPatch.ToJsonString(JsonOptions));
        await updateUser.ExecuteNonQueryAsync(cancellationToken);

        await using var updateAccount = new NpgsqlCommand(
            """
            UPDATE accounts
            SET status = 'disabled',
                updated_at = now()
            WHERE id = @userAccountId
            """,
            connection,
            transaction);
        updateAccount.Parameters.AddWithValue("userAccountId", NpgsqlDbType.Uuid, userAccountId);
        await updateAccount.ExecuteNonQueryAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return new Dictionary<string, object?>
        {
            ["deleted"] = true,
            ["organizationId"] = normalizedOrganizationId,
            ["userId"] = normalizedUserId,
        };
    }

    public async Task<IReadOnlyList<Dictionary<string, object?>>> ListPlatformAccountsAsync(
        string? query,
        CancellationToken cancellationToken)
    {
        var normalizedQuery = NormalizeBlank(query);
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT
              user_account.id AS account_id,
              user_account.legacy_owner_id AS actor_id,
              user_account.status AS account_status,
              user_account.created_at,
              user_account.updated_at,
              u.email,
              u.display_name,
              u.status AS user_status,
              u.data::text AS data_json
            FROM accounts user_account
            JOIN users u ON u.account_id = user_account.id
            WHERE user_account.legacy_owner_type = 'user'
              AND (
                @query IS NULL
                OR lower(user_account.legacy_owner_id) LIKE @query ESCAPE '\'
                OR lower(COALESCE(u.display_name, '')) LIKE @query ESCAPE '\'
                OR lower(COALESCE(u.email, '')) LIKE @query ESCAPE '\'
                OR lower(COALESCE(u.data->>'phone', '')) LIKE @query ESCAPE '\'
              )
            ORDER BY
              CASE WHEN u.status = 'active' AND user_account.status = 'active' THEN 0 ELSE 1 END,
              user_account.updated_at DESC,
              user_account.created_at DESC
            LIMIT 200
            """,
            connection);
        command.Parameters.AddWithValue("query", NpgsqlDbType.Text, DbNullable(normalizedQuery is null ? null : $"%{EscapeLike(normalizedQuery.ToLowerInvariant())}%"));
        return (await PostgresRows.ReadManyAsync(command, cancellationToken)).Select(ToPlatformAccount).ToArray();
    }

    public async Task<Dictionary<string, object?>> UpdatePlatformAccountAsync(
        string userId,
        UpdatePlatformAccountRequest request,
        CancellationToken cancellationToken)
    {
        var normalizedUserId = NormalizeActorId(userId);
        var existing = await GetPlatformAccountRecordAsync(normalizedUserId, cancellationToken)
            ?? throw new ArgumentException("account is not available");
        var data = ParseJsonObject(AsString(existing, "data_json"));
        var displayName = request.DisplayName is null
            ? AsString(existing, "display_name") ?? ReadJsonString(data, "displayName") ?? DefaultDisplayName(normalizedUserId)
            : NormalizeBlank(request.DisplayName) ?? throw new ArgumentException("displayName is required");
        var email = request.Email is null
            ? AsString(existing, "email") ?? ReadJsonString(data, "email") ?? throw new ArgumentException("email is required")
            : RequireEmail(request.Email);
        RejectReservedPlatformEmail(email);
        var phone = request.Phone is null
            ? ReadJsonString(data, "phone")
            : NormalizeBlank(request.Phone);
        var platformRole = NormalizePlatformRole(request.PlatformRole)
            ?? ReadJsonString(data, "platformRole")
            ?? InferPlatformRole(normalizedUserId);
        var currentEmail = NormalizeEmail(AsString(existing, "email") ?? ReadJsonString(data, "email"));
        var currentPhone = NormalizeBlank(ReadJsonString(data, "phone"));
        if (!string.Equals(currentEmail, NormalizeEmail(email), StringComparison.Ordinal)
            || !string.Equals(currentPhone, phone, StringComparison.Ordinal))
        {
            await RequireUniqueAccountContactAsync(email, phone, normalizedUserId, cancellationToken);
        }

        var passwordHash = request.NewPassword is null
            ? null
            : PasswordHashing.HashPassword(RequirePassword(request.NewPassword));
        var userPatch = new JsonObject
        {
            ["phone"] = phone,
            ["platformRole"] = platformRole,
            ["deletedAt"] = null,
        };

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var userAccountId = AsGuid(existing, "account_id");
        await using var updateUser = new NpgsqlCommand(
            """
            UPDATE users
            SET email = @email,
                phone_hash = @phoneHash,
                password_hash = CASE
                    WHEN @passwordHash IS NULL THEN password_hash
                    ELSE @passwordHash
                END,
                display_name = @displayName,
                status = 'active',
                data = data || CAST(@userData AS jsonb),
                updated_at = now()
            WHERE account_id = @accountId
            """,
            connection,
            transaction);
        updateUser.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, userAccountId);
        updateUser.Parameters.AddWithValue("email", NpgsqlDbType.Text, email);
        updateUser.Parameters.AddWithValue("phoneHash", NpgsqlDbType.Text, DbNullable(HashOptional(phone)));
        updateUser.Parameters.AddWithValue("passwordHash", NpgsqlDbType.Text, DbNullable(passwordHash));
        updateUser.Parameters.AddWithValue("displayName", NpgsqlDbType.Text, displayName);
        updateUser.Parameters.AddWithValue("userData", NpgsqlDbType.Jsonb, userPatch.ToJsonString(JsonOptions));
        await updateUser.ExecuteNonQueryAsync(cancellationToken);

        await using var updateAccount = new NpgsqlCommand(
            """
            UPDATE accounts
            SET status = 'active',
                updated_at = now()
            WHERE id = @accountId
            """,
            connection,
            transaction);
        updateAccount.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, userAccountId);
        await updateAccount.ExecuteNonQueryAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return await GetPlatformAccountAsync(normalizedUserId, cancellationToken)
            ?? throw new ArgumentException("account is not available");
    }

    public async Task<Dictionary<string, object?>> DeletePlatformAccountAsync(
        string userId,
        CancellationToken cancellationToken)
    {
        var normalizedUserId = NormalizeActorId(userId);
        var existing = await GetPlatformAccountRecordAsync(normalizedUserId, cancellationToken)
            ?? throw new ArgumentException("account is not available");
        var deletedAt = DateTimeOffset.UtcNow.ToString("O");
        var deletionPatch = new JsonObject
        {
            ["deleted"] = true,
            ["deletedAt"] = deletedAt,
            ["phone"] = null,
            ["defaultOrganizationId"] = null,
        };

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var userAccountId = AsGuid(existing, "account_id");
        await using var updateMemberships = new NpgsqlCommand(
            """
            UPDATE organization_memberships
            SET status = 'disabled',
                data = data || CAST(@deletionData AS jsonb),
                updated_at = now()
            WHERE user_account_id = @accountId
            """,
            connection,
            transaction);
        updateMemberships.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, userAccountId);
        updateMemberships.Parameters.AddWithValue("deletionData", NpgsqlDbType.Jsonb, deletionPatch.ToJsonString(JsonOptions));
        await updateMemberships.ExecuteNonQueryAsync(cancellationToken);

        await using var updateUser = new NpgsqlCommand(
            """
            UPDATE users
            SET email = NULL,
                phone_hash = NULL,
                password_hash = NULL,
                display_name = 'Deleted account',
                status = 'disabled',
                data = data || CAST(@deletionData AS jsonb),
                updated_at = now()
            WHERE account_id = @accountId
            """,
            connection,
            transaction);
        updateUser.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, userAccountId);
        updateUser.Parameters.AddWithValue("deletionData", NpgsqlDbType.Jsonb, deletionPatch.ToJsonString(JsonOptions));
        await updateUser.ExecuteNonQueryAsync(cancellationToken);

        await using var updateAccount = new NpgsqlCommand(
            """
            UPDATE accounts
            SET status = 'disabled',
                updated_at = now()
            WHERE id = @accountId
            """,
            connection,
            transaction);
        updateAccount.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, userAccountId);
        await updateAccount.ExecuteNonQueryAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return await GetPlatformAccountAsync(normalizedUserId, cancellationToken)
            ?? new Dictionary<string, object?>
            {
                ["id"] = normalizedUserId,
                ["userId"] = normalizedUserId,
                ["displayName"] = "Deleted account",
                ["status"] = "disabled",
                ["accountStatus"] = "disabled",
                ["deleted"] = true,
                ["deletedAt"] = deletedAt,
            };
    }

    private async Task<Dictionary<string, object?>?> GetPlatformAccountAsync(
        string userId,
        CancellationToken cancellationToken)
    {
        var accounts = await ListPlatformAccountsAsync(userId, cancellationToken);
        return accounts.FirstOrDefault(item => string.Equals(AsString(item, "userId"), userId, StringComparison.Ordinal));
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
                null,
                false,
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
            await EnsureUserAsync(actorId, "Ops Admin", "ops@xiaolou.local", null, "ops_admin", null, null, null, false, cancellationToken);
        }
        else if (InferPlatformRole(actorId) == "super_admin")
        {
            await EnsureUserAsync(
                actorId,
                "Super Admin",
                "root@xiaolou.local",
                null,
                "super_admin",
                null,
                null,
                PasswordHashing.HashPassword(DefaultSuperAdminPassword),
                false,
                cancellationToken);
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
            null,
            false,
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

    private async Task<string?> GetPasswordHashAsync(string actorId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT u.password_hash
            FROM accounts user_account
            JOIN users u ON u.account_id = user_account.id
            WHERE user_account.legacy_owner_type = 'user'
              AND user_account.legacy_owner_id = @actorId
            LIMIT 1
            """,
            connection);
        command.Parameters.AddWithValue("actorId", NpgsqlDbType.Text, actorId);
        var value = await command.ExecuteScalarAsync(cancellationToken);
        return value is null or DBNull ? null : Convert.ToString(value);
    }

    private async Task UpdatePasswordHashAsync(
        string actorId,
        string passwordHash,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            UPDATE users u
            SET password_hash = @passwordHash,
                updated_at = now()
            FROM accounts user_account
            WHERE u.account_id = user_account.id
              AND user_account.legacy_owner_type = 'user'
              AND user_account.legacy_owner_id = @actorId
            """,
            connection);
        command.Parameters.AddWithValue("actorId", NpgsqlDbType.Text, actorId);
        command.Parameters.AddWithValue("passwordHash", NpgsqlDbType.Text, passwordHash);
        var updated = await command.ExecuteNonQueryAsync(cancellationToken);
        if (updated == 0)
        {
            throw InvalidCredentials();
        }
    }

    private async Task<Dictionary<string, object?>> BuildPasswordConfiguredResultAsync(
        string actorId,
        bool passwordUpdated,
        CancellationToken cancellationToken)
    {
        var permissionContext = await GetPermissionContextAsync(actorId, cancellationToken);
        var actor = permissionContext.TryGetValue("actor", out var actorValue)
            ? actorValue as Dictionary<string, object?>
            : null;
        return new Dictionary<string, object?>
        {
            ["actorId"] = actorId,
            ["email"] = actor is null ? null : AsString(actor, "email"),
            ["platformRole"] = AsString(permissionContext, "platformRole") ?? (actor is null ? null : AsString(actor, "platformRole")),
            ["passwordConfigured"] = true,
            ["passwordUpdated"] = passwordUpdated,
        };
    }

    private static Dictionary<string, object?> BuildPasswordResetRequestResult(
        string email,
        string? resetToken,
        DateTimeOffset? expiresAt,
        bool includeResetToken)
    {
        var canReturnToken = includeResetToken && resetToken is not null && expiresAt is not null;
        var resetTokenExpiresAt = canReturnToken
            ? expiresAt.GetValueOrDefault().ToString("O")
            : null;
        return new Dictionary<string, object?>
        {
            ["email"] = email,
            ["accepted"] = true,
            ["delivery"] = canReturnToken ? "local_token" : "email_unconfigured",
            ["resetToken"] = canReturnToken ? resetToken : null,
            ["expiresAt"] = resetTokenExpiresAt,
        };
    }

    private async Task<Dictionary<string, object?>?> GetPasswordUserRecordAsync(
        string actorId,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT
              user_account.id AS account_id,
              user_account.legacy_owner_id AS actor_id,
              u.email,
              u.password_hash,
              u.data::text AS data_json
            FROM accounts user_account
            JOIN users u ON u.account_id = user_account.id
            WHERE user_account.legacy_owner_type = 'user'
              AND user_account.legacy_owner_id = @actorId
            LIMIT 1
            """,
            connection);
        command.Parameters.AddWithValue("actorId", NpgsqlDbType.Text, actorId);
        return await PostgresRows.ReadSingleAsync(command, cancellationToken);
    }

    private async Task<Dictionary<string, object?>?> GetPasswordUserRecordByEmailAsync(
        string email,
        CancellationToken cancellationToken)
    {
        var normalizedEmail = RequireEmail(email);
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT
              user_account.id AS account_id,
              user_account.legacy_owner_id AS actor_id,
              u.email,
              u.password_hash,
              u.data::text AS data_json
            FROM accounts user_account
            JOIN users u ON u.account_id = user_account.id
            WHERE user_account.legacy_owner_type = 'user'
              AND lower(u.email) = @email
              AND u.status = 'active'
            ORDER BY user_account.created_at ASC
            LIMIT 1
            """,
            connection);
        command.Parameters.AddWithValue("email", NpgsqlDbType.Text, normalizedEmail);
        return await PostgresRows.ReadSingleAsync(command, cancellationToken);
    }

    private async Task<Dictionary<string, object?>?> GetOrganizationMemberRecordAsync(
        string organizationId,
        string userId,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT
              org_account.id AS organization_account_id,
              user_account.id AS user_account_id,
              org_account.legacy_owner_id AS organization_id,
              user_account.legacy_owner_id AS actor_id,
              u.email,
              u.display_name,
              u.password_hash,
              u.data::text AS user_data_json,
              om.role,
              om.status,
              om.data::text AS membership_data_json
            FROM organization_memberships om
            JOIN accounts org_account ON org_account.id = om.organization_account_id
            JOIN accounts user_account ON user_account.id = om.user_account_id
            JOIN users u ON u.account_id = user_account.id
            WHERE org_account.legacy_owner_type = 'organization'
              AND org_account.legacy_owner_id = @organizationId
              AND user_account.legacy_owner_type = 'user'
              AND user_account.legacy_owner_id = @userId
              AND om.status <> 'disabled'
            LIMIT 1
            """,
            connection);
        command.Parameters.AddWithValue("organizationId", NpgsqlDbType.Text, organizationId);
        command.Parameters.AddWithValue("userId", NpgsqlDbType.Text, userId);
        return await PostgresRows.ReadSingleAsync(command, cancellationToken);
    }

    private async Task<Dictionary<string, object?>?> GetPlatformAccountRecordAsync(
        string userId,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT
              user_account.id AS account_id,
              user_account.legacy_owner_id AS actor_id,
              user_account.status AS account_status,
              user_account.created_at,
              user_account.updated_at,
              u.email,
              u.display_name,
              u.status AS user_status,
              u.data::text AS data_json
            FROM accounts user_account
            JOIN users u ON u.account_id = user_account.id
            WHERE user_account.legacy_owner_type = 'user'
              AND user_account.legacy_owner_id = @userId
            LIMIT 1
            """,
            connection);
        command.Parameters.AddWithValue("userId", NpgsqlDbType.Text, userId);
        return await PostgresRows.ReadSingleAsync(command, cancellationToken);
    }

    private async Task<Dictionary<string, object?>?> GetOrganizationMemberPasswordRecordAsync(
        string organizationId,
        string userId,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT
              user_account.id AS account_id,
              user_account.legacy_owner_id AS actor_id,
              u.email,
              u.password_hash,
              u.data::text AS data_json,
              om.role,
              om.status
            FROM organization_memberships om
            JOIN accounts org_account ON org_account.id = om.organization_account_id
            JOIN accounts user_account ON user_account.id = om.user_account_id
            JOIN users u ON u.account_id = user_account.id
            WHERE org_account.legacy_owner_type = 'organization'
              AND org_account.legacy_owner_id = @organizationId
              AND user_account.legacy_owner_type = 'user'
              AND user_account.legacy_owner_id = @userId
              AND om.status <> 'disabled'
            LIMIT 1
            """,
            connection);
        command.Parameters.AddWithValue("organizationId", NpgsqlDbType.Text, organizationId);
        command.Parameters.AddWithValue("userId", NpgsqlDbType.Text, userId);
        return await PostgresRows.ReadSingleAsync(command, cancellationToken);
    }

    private async Task RequireUniqueAccountContactAsync(
        string? email,
        string? phone,
        string? excludingActorId,
        CancellationToken cancellationToken)
    {
        var normalizedEmail = NormalizeEmail(email);
        var phoneHash = HashOptional(phone);
        if (normalizedEmail is null && phoneHash is null)
        {
            return;
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT
              user_account.legacy_owner_id AS actor_id,
              u.email,
              u.phone_hash
            FROM accounts user_account
            JOIN users u ON u.account_id = user_account.id
            WHERE user_account.legacy_owner_type = 'user'
              AND (@excludingActorId IS NULL OR user_account.legacy_owner_id <> @excludingActorId)
              AND (
                (@email IS NOT NULL AND lower(u.email) = @email)
                OR (@phoneHash IS NOT NULL AND u.phone_hash = @phoneHash)
              )
            LIMIT 1
            """,
            connection);
        command.Parameters.AddWithValue("excludingActorId", NpgsqlDbType.Text, DbNullable(excludingActorId));
        command.Parameters.AddWithValue("email", NpgsqlDbType.Text, DbNullable(normalizedEmail));
        command.Parameters.AddWithValue("phoneHash", NpgsqlDbType.Text, DbNullable(phoneHash));
        var existing = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        if (existing is null)
        {
            return;
        }

        var existingEmail = NormalizeEmail(AsString(existing, "email"));
        if (normalizedEmail is not null && string.Equals(existingEmail, normalizedEmail, StringComparison.Ordinal))
        {
            throw new ArgumentException("email is already registered");
        }

        throw new ArgumentException("phone is already registered");
    }

    private async Task<int> CountRecentPasswordResetRequestsAsync(
        string actorId,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT COUNT(*)
            FROM password_reset_tokens
            WHERE actor_id = @actorId
              AND created_at >= now() - interval '15 minutes'
            """,
            connection);
        command.Parameters.AddWithValue("actorId", NpgsqlDbType.Text, actorId);
        var count = await command.ExecuteScalarAsync(cancellationToken);
        return Convert.ToInt32(count);
    }

    private static async Task MarkExpiredPasswordResetTokenAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid tokenId,
        bool expired,
        CancellationToken cancellationToken)
    {
        if (!expired)
        {
            return;
        }

        await using var command = new NpgsqlCommand(
            """
            UPDATE password_reset_tokens
            SET status = 'expired',
                updated_at = now()
            WHERE id = @id
              AND status = 'issued'
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("id", NpgsqlDbType.Uuid, tokenId);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task RecordPasswordAuditAsync(
        string eventType,
        string outcome,
        string? actorId,
        string? email,
        JsonObject data,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await InsertPasswordAuditAsync(
            connection,
            transaction,
            actorId,
            email,
            eventType,
            outcome,
            data,
            cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    private static async Task InsertPasswordAuditAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        string? actorId,
        string? email,
        string eventType,
        string outcome,
        JsonObject data,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO password_auth_audit_events (
              actor_id,
              email_hash,
              event_type,
              outcome,
              data
            )
            VALUES (
              @actorId,
              @emailHash,
              @eventType,
              @outcome,
              CAST(@data AS jsonb)
            )
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("actorId", NpgsqlDbType.Text, DbNullable(actorId));
        command.Parameters.AddWithValue("emailHash", NpgsqlDbType.Text, DbNullable(HashOptional(email)));
        command.Parameters.AddWithValue("eventType", NpgsqlDbType.Text, eventType);
        command.Parameters.AddWithValue("outcome", NpgsqlDbType.Text, outcome);
        command.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, data.ToJsonString(JsonOptions));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task EnsureUserAsync(
        string actorId,
        string displayName,
        string? email,
        string? phone,
        string platformRole,
        string? defaultOrganizationId,
        string? avatar,
        string? passwordHash,
        bool overwritePasswordHash,
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
                password_hash = CASE
                    WHEN @passwordHash IS NULL THEN password_hash
                    WHEN @overwritePasswordHash THEN @passwordHash
                    ELSE COALESCE(NULLIF(password_hash, ''), @passwordHash)
                END,
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
        update.Parameters.AddWithValue("passwordHash", NpgsqlDbType.Text, DbNullable(passwordHash));
        update.Parameters.AddWithValue("overwritePasswordHash", NpgsqlDbType.Boolean, overwritePasswordHash);
        update.Parameters.AddWithValue("displayName", NpgsqlDbType.Text, displayName);
        update.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, data.ToJsonString(JsonOptions));
        var updated = await update.ExecuteNonQueryAsync(cancellationToken);
        if (updated == 0)
        {
            await using var insert = new NpgsqlCommand(
                """
                INSERT INTO users (account_id, email, phone_hash, password_hash, display_name, status, region_code, data, created_at, updated_at)
                VALUES (@accountId, @email, @phoneHash, @passwordHash, @displayName, 'active', 'CN', CAST(@data AS jsonb), now(), now())
                """,
                connection,
                transaction);
            insert.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
            insert.Parameters.AddWithValue("email", NpgsqlDbType.Text, DbNullable(email));
            insert.Parameters.AddWithValue("phoneHash", NpgsqlDbType.Text, DbNullable(HashOptional(phone)));
            insert.Parameters.AddWithValue("passwordHash", NpgsqlDbType.Text, DbNullable(passwordHash));
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
            ["usageSummary"] = BuildMemberUsageSummary(row),
        };
    }

    private static Dictionary<string, object?> ToPlatformAccount(Dictionary<string, object?> row)
    {
        var data = ParseJsonObject(AsString(row, "data_json"));
        var actorId = AsString(row, "actor_id") ?? "guest";
        var userStatus = AsString(row, "user_status") ?? "active";
        var accountStatus = AsString(row, "account_status") ?? "active";
        var deleted = string.Equals(userStatus, "disabled", StringComparison.Ordinal)
            || string.Equals(accountStatus, "disabled", StringComparison.Ordinal)
            || ReadJsonBool(data, "deleted", false);
        return new Dictionary<string, object?>
        {
            ["id"] = actorId,
            ["userId"] = actorId,
            ["displayName"] = deleted
                ? "已删除账号"
                : AsString(row, "display_name") ?? ReadJsonString(data, "displayName") ?? DefaultDisplayName(actorId),
            ["email"] = deleted ? null : AsString(row, "email") ?? ReadJsonString(data, "email"),
            ["phone"] = deleted ? null : ReadJsonString(data, "phone"),
            ["avatar"] = deleted ? null : ReadJsonString(data, "avatar"),
            ["platformRole"] = ReadJsonString(data, "platformRole") ?? InferPlatformRole(actorId),
            ["status"] = userStatus,
            ["accountStatus"] = accountStatus,
            ["deleted"] = deleted,
            ["deletedAt"] = ReadJsonString(data, "deletedAt"),
            ["createdAt"] = ToIso(row.TryGetValue("created_at", out var createdAt) ? createdAt : null),
            ["updatedAt"] = ToIso(row.TryGetValue("updated_at", out var updatedAt) ? updatedAt : null),
        };
    }

    private static string ResolvePlatformRole(Dictionary<string, object?> userRecord)
    {
        var actorId = AsString(userRecord, "actor_id") ?? "guest";
        var data = ParseJsonObject(AsString(userRecord, "data_json"));
        return ReadJsonString(data, "platformRole") ?? InferPlatformRole(actorId);
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
                ["canCreateProject"] = !isGuest,
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
        Dictionary<string, object?>? member,
        string? tempPassword = null,
        bool generatedPassword = false)
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
                ["tempPassword"] = tempPassword,
                ["generatedPassword"] = generatedPassword,
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

        source["vendors"] = MergeApiCenterVendors(source["vendors"] as JsonArray, fallback["vendors"] as JsonArray);
        source["defaults"] = MergeJsonObjectDefaults(source["defaults"] as JsonObject, fallback["defaults"] as JsonObject);
        source["strategies"] = MergeJsonObjectDefaults(source["strategies"] as JsonObject, fallback["strategies"] as JsonObject);
        source["nodeAssignments"] ??= fallback["nodeAssignments"]?.DeepClone();
        source["toolboxAssignments"] ??= fallback["toolboxAssignments"]?.DeepClone();
        return source;
    }

    private static JsonObject MergeJsonObjectDefaults(JsonObject? source, JsonObject? fallback)
    {
        var merged = source ?? new JsonObject();
        if (fallback is null)
        {
            return merged;
        }

        foreach (var property in fallback)
        {
            if (!merged.TryGetPropertyValue(property.Key, out var existing) || existing is null)
            {
                merged[property.Key] = property.Value?.DeepClone();
            }
        }

        return merged;
    }

    private static JsonArray MergeApiCenterVendors(JsonArray? source, JsonArray? fallback)
    {
        var merged = source ?? new JsonArray();
        if (fallback is null)
        {
            return merged;
        }

        foreach (var fallbackVendor in fallback.OfType<JsonObject>())
        {
            var vendorId = fallbackVendor["id"]?.GetValue<string>();
            if (string.IsNullOrWhiteSpace(vendorId))
            {
                continue;
            }

            var existingVendor = merged.OfType<JsonObject>()
                .FirstOrDefault(item => string.Equals(item["id"]?.GetValue<string>(), vendorId, StringComparison.Ordinal));
            if (existingVendor is null)
            {
                merged.Add(fallbackVendor.DeepClone());
                continue;
            }

            foreach (var property in fallbackVendor)
            {
                if (property.Key == "models")
                {
                    existingVendor["models"] = MergeApiCenterModels(
                        existingVendor["models"] as JsonArray,
                        fallbackVendor["models"] as JsonArray);
                    continue;
                }

                if (!existingVendor.TryGetPropertyValue(property.Key, out var existing) || existing is null)
                {
                    existingVendor[property.Key] = property.Value?.DeepClone();
                }
            }
        }

        return merged;
    }

    private static JsonArray MergeApiCenterModels(JsonArray? source, JsonArray? fallback)
    {
        var merged = source ?? new JsonArray();
        if (fallback is null)
        {
            return merged;
        }

        foreach (var fallbackModel in fallback.OfType<JsonObject>())
        {
            var modelId = fallbackModel["id"]?.GetValue<string>();
            if (string.IsNullOrWhiteSpace(modelId))
            {
                continue;
            }

            var existingModel = merged.OfType<JsonObject>()
                .FirstOrDefault(item => string.Equals(item["id"]?.GetValue<string>(), modelId, StringComparison.Ordinal));
            if (existingModel is null)
            {
                merged.Add(fallbackModel.DeepClone());
            }
            else
            {
                foreach (var property in fallbackModel)
                {
                    if (!existingModel.TryGetPropertyValue(property.Key, out var existing) || existing is null)
                    {
                        existingModel[property.Key] = property.Value?.DeepClone();
                    }
                }
            }
        }

        return merged;
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
                Vendor("google-vertex", "Google Vertex AI", new[] { "text", "vision", "image", "video" }, new[]
                {
                    Model("vertex:gemini-3-flash-preview", "Gemini 3 Flash (Vertex)", "text", true),
                    Model("vertex:gemini-3.1-pro-preview", "Gemini 3.1 Pro (Vertex)", "text", true),
                    Model("vertex:gemini-3-pro-image-preview", "Gemini 3 Pro Image+", "image", true),
                    Model("vertex:gemini-3.1-flash-image-preview", "Gemini 3.1 Flash Image+", "image", true),
                    Model("vertex:veo-3.1-generate-001", "Veo 3.1+", "video", true),
                    Model("vertex:veo-3.1-fast-generate-001", "Veo 3.1 Fast+", "video", true),
                    Model("vertex:veo-3.1-lite-generate-001", "Veo 3.1 Lite+", "video", true),
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
                ["imageModelId"] = "vertex:gemini-3-pro-image-preview",
                ["videoModelId"] = "vertex:veo-3.1-generate-001",
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

    private static JsonArray? ParseJsonArray(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        try
        {
            return JsonNode.Parse(raw) as JsonArray;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string? ReadJsonString(JsonObject? data, string key)
    {
        if (data is null || !data.TryGetPropertyValue(key, out var value) || value is null)
        {
            return null;
        }

        return value.GetValueKind() == JsonValueKind.Null ? null : value.GetValue<string>();
    }

    private static decimal ReadJsonDecimal(JsonObject? data, string key)
    {
        if (data is null || !data.TryGetPropertyValue(key, out var value) || value is null)
        {
            return 0;
        }

        return value.GetValueKind() switch
        {
            JsonValueKind.Number => value.GetValue<decimal>(),
            JsonValueKind.String => decimal.TryParse(value.GetValue<string>(), out var parsed) ? parsed : 0,
            _ => 0,
        };
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
            ["series"] = Array.Empty<Dictionary<string, object?>>(),
        };
    }

    private static Dictionary<string, object?> BuildMemberUsageSummary(Dictionary<string, object?> row)
    {
        var series = ParseJsonArray(AsString(row, "usage_series_json"))
            ?.OfType<JsonObject>()
            .Select(item => new Dictionary<string, object?>
            {
                ["bucketStart"] = ReadJsonString(item, "bucketStart"),
                ["bucketLabel"] = ReadJsonString(item, "bucketLabel") ?? "",
                ["consumedCredits"] = ReadJsonDecimal(item, "consumedCredits"),
                ["refundedCredits"] = ReadJsonDecimal(item, "refundedCredits"),
            })
            .ToArray()
            ?? Array.Empty<Dictionary<string, object?>>();

        return new Dictionary<string, object?>
        {
            ["todayUsedCredits"] = ReadDecimal(row, "today_used_credits"),
            ["monthUsedCredits"] = ReadDecimal(row, "month_used_credits"),
            ["totalUsedCredits"] = ReadDecimal(row, "total_used_credits"),
            ["refundedCredits"] = ReadDecimal(row, "refunded_credits"),
            ["pendingFrozenCredits"] = 0,
            ["recentTaskCount"] = ReadInt(row, "recent_task_count"),
            ["lastActivityAt"] = ToIsoOrNull(row.TryGetValue("last_activity_at", out var lastActivityAt) ? lastActivityAt : null),
            ["series"] = series,
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

    private static string EscapeLike(string value)
    {
        return value
            .Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("%", "\\%", StringComparison.Ordinal)
            .Replace("_", "\\_", StringComparison.Ordinal);
    }

    private static string? NormalizeEmail(string? email)
    {
        return NormalizeBlank(email)?.ToLowerInvariant();
    }

    private static string RequireEmail(string? email)
    {
        return NormalizeEmail(email)
            ?? throw new ArgumentException("email is required");
    }

    private static string RequirePassword(string? password)
    {
        return NormalizeBlank(password)
            ?? throw new ArgumentException("password is required");
    }

    private static string RequireResetToken(string? resetToken)
    {
        return NormalizeBlank(resetToken)
            ?? throw new ArgumentException("reset token is required");
    }

    private async Task<string?> PasswordHashForRegistrationAsync(
        string actorId,
        string password,
        CancellationToken cancellationToken)
    {
        var existingHash = await GetPasswordHashAsync(actorId, cancellationToken);
        if (existingHash is null)
        {
            return PasswordHashing.HashPassword(password);
        }

        if (!PasswordHashing.VerifyPassword(password, existingHash))
        {
            throw InvalidCredentials();
        }

        return null;
    }

    private static UnauthorizedAccessException InvalidCredentials()
    {
        return new UnauthorizedAccessException("email or password is incorrect");
    }

    private static void RejectReservedPlatformEmail(string email)
    {
        if (email is "root@xiaolou.local" or "ops@xiaolou.local" or "admin@xiaolou.local" or "member@xiaolou.local")
        {
            throw new ArgumentException("email is reserved");
        }
    }

    private static void RequireReservedPlatformActor(string actorId)
    {
        if (actorId is not "ops_demo_001" and not "root_demo_001")
        {
            throw new ArgumentException("email is not a platform admin");
        }
    }

    private static string NewUserId()
    {
        return $"user_{Guid.NewGuid():N}";
    }

    private static string ActorIdFromEmail(string email, string mode)
    {
        var normalized = email.Trim().ToLowerInvariant();
        if (normalized == "root@xiaolou.local")
        {
            return "root_demo_001";
        }

        if (normalized == "ops@xiaolou.local")
        {
            return "ops_demo_001";
        }

        if (normalized == "admin@xiaolou.local")
        {
            return "user_demo_001";
        }

        if (normalized == "member@xiaolou.local")
        {
            return "user_member_001";
        }

        var segment = new string(normalized.Select(ch => char.IsAsciiLetterOrDigit(ch) ? ch : '_').ToArray())
            .Trim('_');
        if (string.IsNullOrWhiteSpace(segment))
        {
            return mode == "ops_admin" ? "ops_demo_001" : "user_demo_001";
        }

        var prefix = mode == "ops_admin" ? "ops" : "user";
        return $"{prefix}_{segment[..Math.Min(segment.Length, 48)]}";
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

    private static string? NormalizePlatformRole(string? role)
    {
        var normalized = NormalizeBlank(role);
        return normalized is "guest" or "customer" or "ops_admin" or "super_admin"
            ? normalized
            : null;
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

    private static string PasswordResetTokenHash(string token)
    {
        return Sha256Hex($"password-reset-token:{token}");
    }

    private static object DbNullable<T>(T? value)
    {
        return value is null ? DBNull.Value : value;
    }

    private static string? AsString(Dictionary<string, object?> row, string key)
    {
        return row.TryGetValue(key, out var value) && value is not null ? Convert.ToString(value) : null;
    }

    private static Guid AsGuid(Dictionary<string, object?> row, string key)
    {
        if (!row.TryGetValue(key, out var value) || value is null)
        {
            throw new InvalidOperationException($"{key} is required");
        }

        return value switch
        {
            Guid guid => guid,
            _ => Guid.Parse(Convert.ToString(value) ?? throw new InvalidOperationException($"{key} is required")),
        };
    }

    private static decimal ReadDecimal(Dictionary<string, object?> row, string key)
    {
        if (!row.TryGetValue(key, out var value) || value is null)
        {
            return 0;
        }

        return value switch
        {
            decimal decimalValue => decimalValue,
            double doubleValue => Convert.ToDecimal(doubleValue),
            float floatValue => Convert.ToDecimal(floatValue),
            int intValue => intValue,
            long longValue => longValue,
            _ => decimal.TryParse(value.ToString(), out var parsed) ? parsed : 0,
        };
    }

    private static int ReadInt(Dictionary<string, object?> row, string key)
    {
        if (!row.TryGetValue(key, out var value) || value is null)
        {
            return 0;
        }

        return value switch
        {
            int intValue => intValue,
            long longValue => (int)Math.Clamp(longValue, int.MinValue, int.MaxValue),
            decimal decimalValue => (int)Math.Clamp(decimalValue, int.MinValue, int.MaxValue),
            _ => int.TryParse(value.ToString(), out var parsed) ? parsed : 0,
        };
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

    private static string? ToIsoOrNull(object? value)
    {
        return value switch
        {
            DateTimeOffset dto => dto.ToString("O"),
            DateTime dt => DateTime.SpecifyKind(dt, DateTimeKind.Utc).ToString("O"),
            null => null,
            _ => NormalizeBlank(Convert.ToString(value)),
        };
    }

    private static DateTimeOffset ToDateTimeOffset(object? value)
    {
        return value switch
        {
            DateTimeOffset dto => dto,
            DateTime dt => DateTime.SpecifyKind(dt, DateTimeKind.Utc),
            _ => DateTimeOffset.MinValue,
        };
    }
}
