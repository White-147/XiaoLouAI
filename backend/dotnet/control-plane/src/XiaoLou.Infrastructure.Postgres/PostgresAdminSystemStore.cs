using System.Text.Json;
using Npgsql;
using NpgsqlTypes;
using XiaoLou.Domain;

namespace XiaoLou.Infrastructure.Postgres;

public sealed class PostgresAdminSystemStore(NpgsqlDataSource dataSource)
{
    private static readonly IReadOnlyList<PricingSeed> DefaultPricingSeeds =
    [
        new("storyboard_image_generate", "Storyboard image generation", 1m, "image", "Canonical storyboard image generation display price."),
        new("canvas_image_generate", "Canvas image generation", 1m, "image", "Canonical canvas image generation display price."),
        new("video_generate", "Video generation", 8m, "job", "Canonical video generation display price."),
    ];

    public async Task<IReadOnlyList<Dictionary<string, object?>>> ListPricingRulesAsync(CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await EnsureDefaultPricingRulesAsync(connection, cancellationToken);

        await using var command = new NpgsqlCommand(
            """
            SELECT action_code, credits, data, updated_at
            FROM pricing_rules
            ORDER BY action_code
            """,
            connection);

        return (await PostgresRows.ReadManyAsync(command, cancellationToken))
            .Select(MapPricingRule)
            .ToArray();
    }

    public async Task<Dictionary<string, object?>> UpsertPricingRuleAsync(
        string actionCode,
        PricingRuleRequest request,
        CancellationToken cancellationToken)
    {
        var normalizedActionCode = NormalizeBlank(request.ActionCode) ?? NormalizeBlank(actionCode);
        if (normalizedActionCode is null)
        {
            throw new ArgumentException("Pricing rule actionCode is required.", nameof(actionCode));
        }

        var data = ReadJsonElementObject(request.Data);
        data["id"] = ReadValueString(data, "id") ?? normalizedActionCode;
        data["actionCode"] = normalizedActionCode;
        data["label"] = NormalizeBlank(request.Label) ?? ReadValueString(data, "label") ?? normalizedActionCode;
        var credits = request.BaseCredits ?? request.Credits ?? ReadValueDecimal(data, "baseCredits") ?? ReadValueDecimal(data, "credits") ?? 0m;
        data["baseCredits"] = credits;
        data["credits"] = credits;
        data["unitLabel"] = NormalizeBlank(request.UnitLabel) ?? ReadValueString(data, "unitLabel") ?? "unit";
        data["description"] = NormalizeBlank(request.Description) ?? ReadValueString(data, "description") ?? "";
        data["updatedAt"] = DateTimeOffset.UtcNow.ToString("O");

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO pricing_rules (action_code, credits, data, updated_at)
            VALUES (@actionCode, @credits, @data::jsonb, now())
            ON CONFLICT (action_code) DO UPDATE SET
              credits = EXCLUDED.credits,
              data = pricing_rules.data || EXCLUDED.data,
              updated_at = now()
            RETURNING action_code, credits, data, updated_at
            """,
            connection);
        command.Parameters.AddWithValue("actionCode", NpgsqlDbType.Text, normalizedActionCode);
        command.Parameters.AddWithValue("credits", NpgsqlDbType.Numeric, credits);
        command.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, JsonSerializer.Serialize(data));

        return MapPricingRule((await PostgresRows.ReadSingleAsync(command, cancellationToken))!);
    }

    public async Task<IReadOnlyList<Dictionary<string, object?>>> ListAdminOrdersAsync(
        int limit,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT
              po.id,
              po.account_id,
              po.legacy_recharge_order_id,
              po.provider,
              po.merchant_order_no,
              po.provider_trade_no,
              po.status::text AS status,
              po.amount_cents,
              po.credit_amount,
              po.currency,
              po.paid_at,
              po.expires_at,
              po.data,
              po.created_at,
              po.updated_at,
              a.account_type,
              COALESCE(a.legacy_owner_type, a.account_type) AS account_owner_type,
              COALESCE(a.legacy_owner_id, a.id::text) AS account_owner_id,
              wb.credit_balance,
              wb.updated_at AS wallet_updated_at
            FROM payment_orders po
            JOIN accounts a ON a.id = po.account_id
            LEFT JOIN wallet_balances wb ON wb.account_id = po.account_id AND wb.currency = po.currency
            ORDER BY po.created_at DESC
            LIMIT @limit
            """,
            connection);
        command.Parameters.AddWithValue("limit", NpgsqlDbType.Integer, Math.Clamp(limit, 1, 200));

        return (await PostgresRows.ReadManyAsync(command, cancellationToken))
            .Select(MapAdminOrder)
            .ToArray();
    }

    public async Task<IReadOnlyList<Dictionary<string, object?>>> ListEnterpriseApplicationsAsync(
        int limit,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT id, company_name, contact_name, phone, email, status, data, created_at, updated_at
            FROM enterprise_applications
            ORDER BY created_at DESC
            LIMIT @limit
            """,
            connection);
        command.Parameters.AddWithValue("limit", NpgsqlDbType.Integer, Math.Clamp(limit, 1, 200));

        return (await PostgresRows.ReadManyAsync(command, cancellationToken))
            .Select(MapEnterpriseApplication)
            .ToArray();
    }

    public async Task<Dictionary<string, object?>> CreateEnterpriseApplicationAsync(
        EnterpriseApplicationRequest request,
        CancellationToken cancellationToken)
    {
        var companyName = NormalizeBlank(request.CompanyName);
        var contactName = NormalizeBlank(request.ContactName);
        var phone = NormalizeBlank(request.ContactPhone) ?? NormalizeBlank(request.Phone);
        if (companyName is null || contactName is null || phone is null)
        {
            throw new ArgumentException("companyName, contactName and contactPhone are required.");
        }

        var now = DateTimeOffset.UtcNow;
        var id = $"ent_app_{Guid.NewGuid():N}"[..24];
        var data = ReadJsonElementObject(request.Data);
        data["id"] = id;
        data["companyName"] = companyName;
        data["contactName"] = contactName;
        data["contactPhone"] = phone;
        data["phone"] = phone;
        data["email"] = NormalizeBlank(request.Email);
        data["licenseNo"] = NormalizeBlank(request.LicenseNo);
        data["industry"] = NormalizeBlank(request.Industry);
        data["teamSize"] = NormalizeBlank(request.TeamSize);
        data["note"] = NormalizeBlank(request.Note);
        data["status"] = "submitted";
        data["source"] = "control_api_canonical";
        data["createdAt"] = now.ToString("O");
        data["updatedAt"] = now.ToString("O");

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO enterprise_applications (
              id, company_name, contact_name, phone, email, status, data, created_at, updated_at
            )
            VALUES (@id, @companyName, @contactName, @phone, @email, 'submitted', @data::jsonb, @createdAt, @updatedAt)
            RETURNING id, company_name, contact_name, phone, email, status, data, created_at, updated_at
            """,
            connection);
        command.Parameters.AddWithValue("id", NpgsqlDbType.Text, id);
        command.Parameters.AddWithValue("companyName", NpgsqlDbType.Text, companyName);
        command.Parameters.AddWithValue("contactName", NpgsqlDbType.Text, contactName);
        command.Parameters.AddWithValue("phone", NpgsqlDbType.Text, phone);
        command.Parameters.AddWithValue("email", NpgsqlDbType.Text, (object?)NormalizeBlank(request.Email) ?? DBNull.Value);
        command.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, JsonSerializer.Serialize(data));
        command.Parameters.AddWithValue("createdAt", NpgsqlDbType.TimestampTz, now);
        command.Parameters.AddWithValue("updatedAt", NpgsqlDbType.TimestampTz, now);

        return MapEnterpriseApplication((await PostgresRows.ReadSingleAsync(command, cancellationToken))!);
    }

    public async Task<Dictionary<string, object?>?> ReviewEnterpriseApplicationAsync(
        string applicationId,
        EnterpriseApplicationReviewRequest request,
        string reviewerId,
        CancellationToken cancellationToken)
    {
        var status = NormalizeApplicationStatus(request.Status ?? request.Decision);
        var now = DateTimeOffset.UtcNow;
        var patch = new Dictionary<string, object?>
        {
            ["status"] = status,
            ["reviewStatus"] = status,
            ["reviewNote"] = NormalizeBlank(request.Note),
            ["reviewedBy"] = NormalizeBlank(reviewerId) ?? "system",
            ["reviewedAt"] = now.ToString("O"),
            ["updatedAt"] = now.ToString("O"),
        };

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            UPDATE enterprise_applications
            SET status = @status,
                data = data || @data::jsonb,
                updated_at = @updatedAt
            WHERE id = @id
            RETURNING id, company_name, contact_name, phone, email, status, data, created_at, updated_at
            """,
            connection);
        command.Parameters.AddWithValue("id", NpgsqlDbType.Text, applicationId);
        command.Parameters.AddWithValue("status", NpgsqlDbType.Text, status);
        command.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, JsonSerializer.Serialize(patch));
        command.Parameters.AddWithValue("updatedAt", NpgsqlDbType.TimestampTz, now);

        var row = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        return row is null ? null : MapEnterpriseApplication(row);
    }

    private static async Task EnsureDefaultPricingRulesAsync(
        NpgsqlConnection connection,
        CancellationToken cancellationToken)
    {
        foreach (var seed in DefaultPricingSeeds)
        {
            var now = DateTimeOffset.UtcNow;
            var data = new Dictionary<string, object?>
            {
                ["id"] = seed.ActionCode.Replace('_', '-'),
                ["actionCode"] = seed.ActionCode,
                ["label"] = seed.Label,
                ["baseCredits"] = seed.BaseCredits,
                ["credits"] = seed.BaseCredits,
                ["unitLabel"] = seed.UnitLabel,
                ["description"] = seed.Description,
                ["updatedAt"] = now.ToString("O"),
                ["source"] = "canonical-default",
            };

            await using var command = new NpgsqlCommand(
                """
                INSERT INTO pricing_rules (action_code, credits, data, updated_at)
                VALUES (@actionCode, @credits, @data::jsonb, @updatedAt)
                ON CONFLICT (action_code) DO NOTHING
                """,
                connection);
            command.Parameters.AddWithValue("actionCode", NpgsqlDbType.Text, seed.ActionCode);
            command.Parameters.AddWithValue("credits", NpgsqlDbType.Numeric, seed.BaseCredits);
            command.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, JsonSerializer.Serialize(data));
            command.Parameters.AddWithValue("updatedAt", NpgsqlDbType.TimestampTz, now);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
    }

    private static Dictionary<string, object?> MapPricingRule(Dictionary<string, object?> row)
    {
        var data = ReadJsonObject(row, "data");
        var actionCode = ReadString(row, "action_code") ?? ReadValueString(data, "actionCode") ?? "";
        var credits = ReadDecimal(row, "credits");
        if (credits == 0)
        {
            credits = ReadValueDecimal(data, "baseCredits") ?? ReadValueDecimal(data, "credits") ?? 0m;
        }

        return new Dictionary<string, object?>
        {
            ["id"] = ReadValueString(data, "id") ?? actionCode,
            ["actionCode"] = actionCode,
            ["label"] = ReadValueString(data, "label") ?? actionCode,
            ["baseCredits"] = credits,
            ["unitLabel"] = ReadValueString(data, "unitLabel") ?? "unit",
            ["description"] = ReadValueString(data, "description") ?? "",
            ["updatedAt"] = ReadDateIso(row, "updated_at") ?? ReadValueString(data, "updatedAt") ?? DateTimeOffset.UtcNow.ToString("O"),
        };
    }

    private static Dictionary<string, object?> MapAdminOrder(Dictionary<string, object?> row)
    {
        var data = ReadJsonObject(row, "data");
        var provider = ReadString(row, "provider") ?? ReadValueString(data, "provider") ?? "unknown";
        var status = ReadValueString(data, "status") ?? ReadString(row, "status") ?? "created";
        var paymentMethod = ReadValueString(data, "paymentMethod") ?? ProviderToPaymentMethod(provider);
        var accountId = ReadString(row, "account_id") ?? "";
        var ownerType = ReadString(row, "account_owner_type") ?? "user";
        var ownerId = ReadString(row, "account_owner_id") ?? accountId;
        var amount = decimal.Divide(ReadLong(row, "amount_cents"), 100m);
        var credits = ReadDecimal(row, "credit_amount");

        return new Dictionary<string, object?>
        {
            ["id"] = ReadString(row, "id") ?? ReadString(row, "legacy_recharge_order_id") ?? "",
            ["planId"] = ReadValueString(data, "planId") ?? $"canonical-{provider}",
            ["planName"] = ReadValueString(data, "planName") ?? $"{provider} payment order",
            ["billingCycle"] = ReadValueString(data, "billingCycle") ?? "one_time",
            ["paymentMethod"] = paymentMethod,
            ["provider"] = provider,
            ["scene"] = ReadValueString(data, "scene") ?? paymentMethod,
            ["mode"] = ReadValueString(data, "mode") ?? "live",
            ["amount"] = amount,
            ["credits"] = credits,
            ["currency"] = ReadString(row, "currency") ?? "CNY",
            ["status"] = status,
            ["actorId"] = ReadValueString(data, "actorId") ?? ownerId,
            ["walletId"] = accountId,
            ["walletOwnerType"] = ownerType == "system" ? "platform" : ownerType,
            ["walletOwnerId"] = ownerId,
            ["payerType"] = ownerType == "system" ? "platform" : ownerType,
            ["providerTradeNo"] = ReadString(row, "provider_trade_no"),
            ["paidAt"] = ReadDateIso(row, "paid_at"),
            ["expiredAt"] = ReadDateIso(row, "expires_at"),
            ["expiresAt"] = ReadDateIso(row, "expires_at"),
            ["failureReason"] = ReadValueString(data, "failureReason"),
            ["voucherFiles"] = ReadValueStringArray(data, "voucherFiles"),
            ["reviewStatus"] = ReadValueString(data, "reviewStatus"),
            ["reviewedAt"] = ReadValueString(data, "reviewedAt"),
            ["reviewedBy"] = ReadValueString(data, "reviewedBy"),
            ["reviewNote"] = ReadValueString(data, "reviewNote"),
            ["createdAt"] = ReadDateIso(row, "created_at") ?? DateTimeOffset.UtcNow.ToString("O"),
            ["updatedAt"] = ReadDateIso(row, "updated_at") ?? DateTimeOffset.UtcNow.ToString("O"),
            ["wallet"] = new Dictionary<string, object?>
            {
                ["id"] = accountId,
                ["ownerType"] = ownerType == "system" ? "platform" : ownerType,
                ["walletOwnerType"] = ownerType == "system" ? "platform" : ownerType,
                ["ownerId"] = ownerId,
                ["displayName"] = ownerType == "organization" ? $"Organization wallet {ownerId}" : $"Personal wallet {ownerId}",
                ["availableCredits"] = ReadDecimal(row, "credit_balance"),
                ["frozenCredits"] = 0,
                ["creditsAvailable"] = ReadDecimal(row, "credit_balance"),
                ["creditsFrozen"] = 0,
                ["currency"] = ReadString(row, "currency") ?? "CNY",
                ["status"] = "active",
                ["updatedAt"] = ReadDateIso(row, "wallet_updated_at") ?? ReadDateIso(row, "updated_at") ?? DateTimeOffset.UtcNow.ToString("O"),
            },
        };
    }

    private static Dictionary<string, object?> MapEnterpriseApplication(Dictionary<string, object?> row)
    {
        var data = ReadJsonObject(row, "data");
        var phone = ReadString(row, "phone") ?? ReadValueString(data, "contactPhone") ?? ReadValueString(data, "phone");
        return new Dictionary<string, object?>
        {
            ["id"] = ReadString(row, "id") ?? "",
            ["companyName"] = ReadString(row, "company_name") ?? ReadValueString(data, "companyName"),
            ["contactName"] = ReadString(row, "contact_name") ?? ReadValueString(data, "contactName"),
            ["contactPhone"] = phone,
            ["phone"] = phone,
            ["email"] = ReadString(row, "email") ?? ReadValueString(data, "email"),
            ["licenseNo"] = ReadValueString(data, "licenseNo"),
            ["industry"] = ReadValueString(data, "industry"),
            ["teamSize"] = ReadValueString(data, "teamSize"),
            ["note"] = ReadValueString(data, "note"),
            ["status"] = ReadString(row, "status") ?? ReadValueString(data, "status") ?? "submitted",
            ["reviewStatus"] = ReadValueString(data, "reviewStatus"),
            ["reviewedAt"] = ReadValueString(data, "reviewedAt"),
            ["reviewedBy"] = ReadValueString(data, "reviewedBy"),
            ["reviewNote"] = ReadValueString(data, "reviewNote"),
            ["createdAt"] = ReadDateIso(row, "created_at") ?? ReadValueString(data, "createdAt") ?? DateTimeOffset.UtcNow.ToString("O"),
            ["updatedAt"] = ReadDateIso(row, "updated_at") ?? ReadValueString(data, "updatedAt") ?? DateTimeOffset.UtcNow.ToString("O"),
        };
    }

    private static Dictionary<string, object?> ReadJsonElementObject(JsonElement element)
    {
        if (element.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null)
        {
            return new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        }

        if (element.ValueKind != JsonValueKind.Object)
        {
            return new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        }

        return JsonSerializer.Deserialize<Dictionary<string, object?>>(element.GetRawText())
               ?? new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
    }

    private static Dictionary<string, object?> ReadJsonObject(Dictionary<string, object?> row, string key)
    {
        if (!row.TryGetValue(key, out var value) || value is null)
        {
            return new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        }

        if (value is JsonElement element && element.ValueKind == JsonValueKind.Object)
        {
            return JsonSerializer.Deserialize<Dictionary<string, object?>>(element.GetRawText())
                   ?? new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        }

        var text = value.ToString();
        if (string.IsNullOrWhiteSpace(text))
        {
            return new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        }

        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, object?>>(text)
                   ?? new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        }
        catch (JsonException)
        {
            return new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        }
    }

    private static string? ReadValueString(Dictionary<string, object?> source, string key)
    {
        if (!source.TryGetValue(key, out var value) || value is null)
        {
            return null;
        }

        return value switch
        {
            JsonElement { ValueKind: JsonValueKind.String } element => NormalizeBlank(element.GetString()),
            JsonElement { ValueKind: JsonValueKind.Number } element => NormalizeBlank(element.GetRawText()),
            JsonElement { ValueKind: JsonValueKind.True } => "true",
            JsonElement { ValueKind: JsonValueKind.False } => "false",
            JsonElement { ValueKind: JsonValueKind.Null } => null,
            _ => NormalizeBlank(Convert.ToString(value)),
        };
    }

    private static decimal? ReadValueDecimal(Dictionary<string, object?> source, string key)
    {
        if (!source.TryGetValue(key, out var value) || value is null)
        {
            return null;
        }

        return value switch
        {
            JsonElement { ValueKind: JsonValueKind.Number } element when element.TryGetDecimal(out var numericValue) => numericValue,
            JsonElement { ValueKind: JsonValueKind.String } element when decimal.TryParse(element.GetString(), out var stringValue) => stringValue,
            decimal decimalValue => decimalValue,
            double doubleValue => Convert.ToDecimal(doubleValue),
            float floatValue => Convert.ToDecimal(floatValue),
            int intValue => intValue,
            long longValue => longValue,
            _ => decimal.TryParse(Convert.ToString(value), out var fallbackValue) ? fallbackValue : null,
        };
    }

    private static string[] ReadValueStringArray(Dictionary<string, object?> source, string key)
    {
        if (!source.TryGetValue(key, out var value) || value is null)
        {
            return [];
        }

        if (value is JsonElement element && element.ValueKind == JsonValueKind.Array)
        {
            return element.EnumerateArray()
                .Select(item => item.ValueKind == JsonValueKind.String ? item.GetString() : item.GetRawText())
                .Select(NormalizeBlank)
                .Where(item => item is not null)
                .Select(item => item!)
                .ToArray();
        }

        return [];
    }

    private static string NormalizeApplicationStatus(string? status)
    {
        var normalized = NormalizeBlank(status)?.ToLowerInvariant();
        return normalized switch
        {
            "approve" or "approved" or "active" => "approved",
            "reject" or "rejected" => "rejected",
            "submitted" or "pending" or "pending_review" => "submitted",
            _ => "submitted",
        };
    }

    private static string ProviderToPaymentMethod(string provider)
    {
        return provider.ToLowerInvariant() switch
        {
            "wechat" or "wechatpay" or "wechat_pay" => "wechat_pay",
            "alipay" => "alipay",
            "bank" or "bank_transfer" => "bank_transfer",
            _ => provider,
        };
    }

    private static string? ReadString(Dictionary<string, object?> row, string key)
    {
        return row.TryGetValue(key, out var value) && value is not null
            ? NormalizeBlank(Convert.ToString(value))
            : null;
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
            _ => decimal.TryParse(Convert.ToString(value), out var parsed) ? parsed : 0,
        };
    }

    private static long ReadLong(Dictionary<string, object?> row, string key)
    {
        if (!row.TryGetValue(key, out var value) || value is null)
        {
            return 0;
        }

        return value switch
        {
            long longValue => longValue,
            int intValue => intValue,
            decimal decimalValue => Convert.ToInt64(decimalValue),
            _ => long.TryParse(Convert.ToString(value), out var parsed) ? parsed : 0,
        };
    }

    private static string? ReadDateIso(Dictionary<string, object?> row, string key)
    {
        if (!row.TryGetValue(key, out var value) || value is null)
        {
            return null;
        }

        return value switch
        {
            DateTimeOffset offset => offset.ToString("O"),
            DateTime dateTime => DateTime.SpecifyKind(dateTime, DateTimeKind.Utc).ToString("O"),
            _ => NormalizeBlank(Convert.ToString(value)),
        };
    }

    private static string? NormalizeBlank(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    private sealed record PricingSeed(string ActionCode, string Label, decimal BaseCredits, string UnitLabel, string Description);
}
