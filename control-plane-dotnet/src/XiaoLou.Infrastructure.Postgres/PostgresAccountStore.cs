using XiaoLou.Domain;
using Npgsql;
using NpgsqlTypes;

namespace XiaoLou.Infrastructure.Postgres;

public sealed class PostgresAccountStore(NpgsqlDataSource dataSource)
{
    public async Task<Dictionary<string, object?>> EnsureAccountAsync(
        AccountScope scope,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var accountId = await EnsureAccountAsync(connection, transaction, scope, cancellationToken);
        await LockAccountLaneAsync(connection, transaction, accountId, AccountLanes.Control, cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return new Dictionary<string, object?>
        {
            ["id"] = accountId,
            ["lane_locked"] = AccountLanes.Control,
        };
    }

    public async Task<Guid> EnsureAccountAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        AccountScope scope,
        CancellationToken cancellationToken)
    {
        var ownerType = NormalizeOwnerType(scope.AccountOwnerType);
        var ownerId = string.IsNullOrWhiteSpace(scope.AccountOwnerId) ? "guest" : scope.AccountOwnerId.Trim();
        var regionCode = string.IsNullOrWhiteSpace(scope.RegionCode) ? "CN" : scope.RegionCode.Trim();
        var currency = string.IsNullOrWhiteSpace(scope.Currency) ? "CNY" : scope.Currency.Trim();

        if (Guid.TryParse(scope.AccountId, out var explicitAccountId))
        {
            await using var explicitCommand = new NpgsqlCommand(
                """
                INSERT INTO accounts (
                  id, account_type, legacy_owner_type, legacy_owner_id,
                  region_code, default_currency, created_at, updated_at
                )
                VALUES (@id, @type, @ownerType, @ownerId, @region, @currency, now(), now())
                ON CONFLICT (id) DO UPDATE SET
                  region_code = COALESCE(NULLIF(EXCLUDED.region_code, ''), accounts.region_code),
                  default_currency = COALESCE(NULLIF(EXCLUDED.default_currency, ''), accounts.default_currency),
                  updated_at = now()
                RETURNING id
                """,
                connection,
                transaction);
            explicitCommand.Parameters.AddWithValue("id", NpgsqlDbType.Uuid, explicitAccountId);
            explicitCommand.Parameters.AddWithValue("type", NpgsqlDbType.Text, ownerType);
            explicitCommand.Parameters.AddWithValue("ownerType", NpgsqlDbType.Text, ownerType);
            explicitCommand.Parameters.AddWithValue("ownerId", NpgsqlDbType.Text, ownerId);
            explicitCommand.Parameters.AddWithValue("region", NpgsqlDbType.Text, regionCode);
            explicitCommand.Parameters.AddWithValue("currency", NpgsqlDbType.Text, currency);
            return (Guid)(await explicitCommand.ExecuteScalarAsync(cancellationToken)
                ?? throw new InvalidOperationException("Failed to ensure account."));
        }

        await using var command = new NpgsqlCommand(
            """
            INSERT INTO accounts (
              account_type, legacy_owner_type, legacy_owner_id,
              region_code, default_currency, created_at, updated_at
            )
            VALUES (@type, @ownerType, @ownerId, @region, @currency, now(), now())
            ON CONFLICT (legacy_owner_type, legacy_owner_id)
            WHERE legacy_owner_type IS NOT NULL AND legacy_owner_id IS NOT NULL
            DO UPDATE SET
              region_code = COALESCE(NULLIF(EXCLUDED.region_code, ''), accounts.region_code),
              default_currency = COALESCE(NULLIF(EXCLUDED.default_currency, ''), accounts.default_currency),
              updated_at = now()
            RETURNING id
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("type", NpgsqlDbType.Text, ownerType);
        command.Parameters.AddWithValue("ownerType", NpgsqlDbType.Text, ownerType);
        command.Parameters.AddWithValue("ownerId", NpgsqlDbType.Text, ownerId);
        command.Parameters.AddWithValue("region", NpgsqlDbType.Text, regionCode);
        command.Parameters.AddWithValue("currency", NpgsqlDbType.Text, currency);

        return (Guid)(await command.ExecuteScalarAsync(cancellationToken)
            ?? throw new InvalidOperationException("Failed to ensure account."));
    }

    public static async Task LockAccountLaneAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid accountId,
        string lane,
        CancellationToken cancellationToken)
    {
        var normalizedLane = AccountLanes.Normalize(lane);
        await using var command = new NpgsqlCommand(
            "SELECT xiaolou_lock_account_lane(@accountId, @lane)",
            connection,
            transaction);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("lane", NpgsqlDbType.Text, normalizedLane);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static string NormalizeOwnerType(string? ownerType)
    {
        var value = string.IsNullOrWhiteSpace(ownerType) ? "user" : ownerType.Trim().ToLowerInvariant();
        return value is "organization" or "system" ? value : "user";
    }
}
