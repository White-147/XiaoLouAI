using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace XiaoLou.Infrastructure.Postgres;

public sealed class PostgresWalletStore(NpgsqlDataSource dataSource)
{
    public async Task<Dictionary<string, object?>?> GetWalletByOwnerAsync(
        string? ownerType,
        string? ownerId,
        CancellationToken cancellationToken)
    {
        var wallets = await ListWalletsByOwnerAsync(ownerType, ownerId, 1, cancellationToken);
        return wallets.FirstOrDefault();
    }

    public async Task<IReadOnlyList<Dictionary<string, object?>>> ListWalletsByOwnerAsync(
        string? ownerType,
        string? ownerId,
        int limit,
        CancellationToken cancellationToken)
    {
        var normalizedOwnerId = NormalizeBlank(ownerId);
        if (normalizedOwnerId is null)
        {
            return Array.Empty<Dictionary<string, object?>>();
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            WalletSelectSql + """

            WHERE a.legacy_owner_type = @ownerType
              AND a.legacy_owner_id = @ownerId
            ORDER BY a.updated_at DESC
            LIMIT @limit
            """,
            connection);
        command.Parameters.AddWithValue("ownerType", NpgsqlDbType.Text, NormalizeOwnerType(ownerType));
        command.Parameters.AddWithValue("ownerId", NpgsqlDbType.Text, normalizedOwnerId);
        command.Parameters.AddWithValue("limit", NpgsqlDbType.Integer, Math.Clamp(limit, 1, 50));
        return (await PostgresRows.ReadManyAsync(command, cancellationToken))
            .Select(MapWallet)
            .ToArray();
    }

    public async Task<Dictionary<string, object?>?> GetWalletByAccountIdAsync(
        Guid accountId,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            WalletSelectSql + """

            WHERE a.id = @accountId
            LIMIT 1
            """,
            connection);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        var row = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        return row is null ? null : MapWallet(row);
    }

    public async Task<IReadOnlyList<Dictionary<string, object?>>> ListLedgerAsync(
        Guid accountId,
        int limit,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT *
            FROM wallet_ledger
            WHERE account_id = @accountId
               OR wallet_id = @walletId
            ORDER BY created_at DESC
            LIMIT @limit
            """,
            connection);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("walletId", NpgsqlDbType.Text, accountId.ToString("D"));
        command.Parameters.AddWithValue("limit", NpgsqlDbType.Integer, Math.Clamp(limit, 1, 100));
        return (await PostgresRows.ReadManyAsync(command, cancellationToken))
            .Select(row => MapLedger(row, accountId))
            .ToArray();
    }

    public async Task<Dictionary<string, object?>> GetUsageStatsAsync(
        string? ownerType,
        string? ownerId,
        string? mode,
        CancellationToken cancellationToken)
    {
        var normalizedOwnerType = NormalizeOwnerType(ownerType);
        var normalizedOwnerId = NormalizeBlank(ownerId);
        var wallet = normalizedOwnerId is null
            ? null
            : await GetWalletByOwnerAsync(normalizedOwnerType, normalizedOwnerId, cancellationToken);

        IReadOnlyList<Dictionary<string, object?>> ledger = Array.Empty<Dictionary<string, object?>>();
        if (TryReadGuid(wallet, "account_id", out var accountId))
        {
            ledger = await ListLedgerAsync(accountId, 20, cancellationToken);
        }

        var wallets = wallet is null
            ? Array.Empty<Dictionary<string, object?>>()
            : new[] { wallet };

        var consumedCredits = ledger
            .Select(entry => ReadDecimal(entry, "amount"))
            .Where(amount => amount < 0)
            .Select(Math.Abs)
            .Sum();
        var refundedCredits = ledger
            .Where(entry => string.Equals(ReadString(entry, "entryType"), "refund", StringComparison.OrdinalIgnoreCase))
            .Select(entry => Math.Abs(ReadDecimal(entry, "amount")))
            .Sum();
        var availableCredits = wallets.Select(item => ReadDecimal(item, "availableCredits")).Sum();
        var frozenCredits = wallets.Select(item => ReadDecimal(item, "frozenCredits")).Sum();
        var lastActivityAt = ledger.Select(entry => ReadString(entry, "createdAt")).FirstOrDefault();

        return new Dictionary<string, object?>
        {
            ["subject"] = new Dictionary<string, object?>
            {
                ["type"] = normalizedOwnerType,
                ["id"] = normalizedOwnerId,
                ["label"] = BuildSubjectLabel(normalizedOwnerType, normalizedOwnerId),
                ["detail"] = "canonical-postgresql-wallet",
            },
            ["mode"] = NormalizeBlank(mode) ?? (normalizedOwnerType == "organization" ? "organization" : "personal"),
            ["windowDays"] = 30,
            ["bucket"] = "day",
            ["wallets"] = wallets,
            ["summary"] = new Dictionary<string, object?>
            {
                ["consumedCredits"] = consumedCredits,
                ["todayConsumedCredits"] = 0,
                ["refundedCredits"] = refundedCredits,
                ["pendingFrozenCredits"] = frozenCredits,
                ["availableCredits"] = availableCredits,
                ["frozenCredits"] = frozenCredits,
                ["recentTaskCount"] = 0,
                ["lastActivityAt"] = lastActivityAt,
            },
            ["series"] = Array.Empty<Dictionary<string, object?>>(),
            ["recentEntries"] = ledger,
        };
    }

    private const string WalletSelectSql = """
        SELECT
          a.id AS account_id,
          a.account_type,
          COALESCE(a.legacy_owner_type, a.account_type) AS account_owner_type,
          COALESCE(a.legacy_owner_id, a.id::text) AS account_owner_id,
          a.status,
          a.default_currency,
          a.data,
          a.updated_at AS account_updated_at,
          COALESCE(b.currency, NULLIF(a.default_currency, ''), 'CNY') AS wallet_currency,
          COALESCE(b.balance_cents, 0) AS balance_cents,
          COALESCE(b.credit_balance, 0) AS credit_balance,
          COALESCE(b.updated_at, a.updated_at) AS wallet_updated_at
        FROM accounts a
        LEFT JOIN wallet_balances b
          ON b.account_id = a.id
         AND b.currency = COALESCE(NULLIF(a.default_currency, ''), 'CNY')
        """;

    private static Dictionary<string, object?> MapWallet(Dictionary<string, object?> row)
    {
        var accountId = ReadString(row, "account_id") ?? "";
        var ownerType = NormalizeOwnerType(ReadString(row, "account_owner_type"));
        var ownerId = ReadString(row, "account_owner_id") ?? accountId;
        var credits = ReadDecimal(row, "credit_balance");
        var currency = ReadString(row, "wallet_currency") ?? ReadString(row, "default_currency") ?? "CNY";
        return new Dictionary<string, object?>
        {
            ["id"] = accountId,
            ["account_id"] = accountId,
            ["ownerType"] = ownerType == "system" ? "platform" : ownerType,
            ["walletOwnerType"] = ownerType == "system" ? "platform" : ownerType,
            ["ownerId"] = ownerId,
            ["displayName"] = BuildWalletName(ownerType, ownerId),
            ["availableCredits"] = credits,
            ["frozenCredits"] = 0,
            ["creditsAvailable"] = credits,
            ["creditsFrozen"] = 0,
            ["currency"] = currency,
            ["status"] = ReadString(row, "status") ?? "active",
            ["allowNegative"] = false,
            ["unlimitedCredits"] = false,
            ["updatedAt"] = ReadDateIso(row, "wallet_updated_at") ?? ReadDateIso(row, "account_updated_at") ?? DateTimeOffset.UtcNow.ToString("O"),
            ["account_owner_type"] = ownerType,
            ["account_owner_id"] = ownerId,
        };
    }

    private static Dictionary<string, object?> MapLedger(Dictionary<string, object?> row, Guid fallbackAccountId)
    {
        var amount = ReadDecimal(row, "credit_amount");
        if (amount == 0)
        {
            amount = ReadDecimal(row, "amount");
        }

        var balanceAfter = ReadDecimal(row, "balance_after_credits");
        return new Dictionary<string, object?>
        {
            ["id"] = ReadString(row, "id") ?? "",
            ["walletId"] = ReadString(row, "account_id") ?? ReadString(row, "wallet_id") ?? fallbackAccountId.ToString("D"),
            ["entryType"] = ReadString(row, "entry_type") ?? "adjustment",
            ["amount"] = amount,
            ["balanceAfter"] = balanceAfter,
            ["frozenBalanceAfter"] = 0,
            ["sourceType"] = ReadString(row, "source_type") ?? "wallet_ledger",
            ["sourceId"] = ReadString(row, "source_id") ?? ReadString(row, "payment_order_id") ?? "",
            ["projectId"] = null,
            ["orderId"] = ReadString(row, "payment_order_id"),
            ["createdBy"] = ReadString(row, "actor_id"),
            ["metadata"] = ReadJsonObject(row, "data"),
            ["createdAt"] = ReadDateIso(row, "created_at") ?? DateTimeOffset.UtcNow.ToString("O"),
        };
    }

    private static string NormalizeOwnerType(string? ownerType)
    {
        var normalized = NormalizeBlank(ownerType)?.ToLowerInvariant();
        return normalized is "organization" or "system" or "platform"
            ? (normalized == "platform" ? "system" : normalized)
            : "user";
    }

    private static string? NormalizeBlank(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    private static string BuildWalletName(string ownerType, string ownerId)
    {
        return ownerType switch
        {
            "organization" => $"Organization wallet {ownerId}",
            "system" => "Platform wallet",
            _ => $"Personal wallet {ownerId}",
        };
    }

    private static string BuildSubjectLabel(string ownerType, string? ownerId)
    {
        return ownerType switch
        {
            "organization" => $"Organization {ownerId ?? "-"}",
            "system" => "Platform",
            _ => $"User {ownerId ?? "-"}",
        };
    }

    private static string? ReadString(Dictionary<string, object?> row, string key)
    {
        return row.TryGetValue(key, out var value) && value is not null
            ? NormalizeBlank(value.ToString())
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
            _ => decimal.TryParse(value.ToString(), out var parsed) ? parsed : 0,
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
            _ => NormalizeBlank(value.ToString()),
        };
    }

    private static Dictionary<string, object?> ReadJsonObject(Dictionary<string, object?> row, string key)
    {
        if (!row.TryGetValue(key, out var value) || value is null)
        {
            return new Dictionary<string, object?>();
        }

        if (value is JsonElement element && element.ValueKind == JsonValueKind.Object)
        {
            return JsonSerializer.Deserialize<Dictionary<string, object?>>(element.GetRawText())
                ?? new Dictionary<string, object?>();
        }

        var text = value.ToString();
        if (string.IsNullOrWhiteSpace(text))
        {
            return new Dictionary<string, object?>();
        }

        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, object?>>(text)
                ?? new Dictionary<string, object?>();
        }
        catch (JsonException)
        {
            return new Dictionary<string, object?>();
        }
    }

    private static bool TryReadGuid(Dictionary<string, object?>? row, string key, out Guid value)
    {
        value = default;
        if (row is null || !row.TryGetValue(key, out var raw) || raw is null)
        {
            return false;
        }

        if (raw is Guid guid)
        {
            value = guid;
            return true;
        }

        return Guid.TryParse(raw.ToString(), out value);
    }
}
