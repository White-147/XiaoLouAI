using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using XiaoLou.Domain;
using Npgsql;
using NpgsqlTypes;

namespace XiaoLou.Infrastructure.Postgres;

public sealed class PostgresPaymentLedger(NpgsqlDataSource dataSource, PostgresAccountStore accounts)
{
    public async Task<Dictionary<string, object?>> ProcessCallbackAsync(
        PaymentCallbackRequest request,
        CancellationToken cancellationToken)
    {
        var provider = string.IsNullOrWhiteSpace(request.Provider) ? "unknown" : request.Provider.Trim().ToLowerInvariant();
        var rawHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(request.RawBody))).ToLowerInvariant();
        var eventId = FirstNonBlank(request.EventId, request.ProviderTradeNo, request.MerchantOrderNo)
            ?? $"{provider}:{rawHash}";

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        var callback = await InsertCallbackAsync(connection, transaction, request, provider, eventId, rawHash, cancellationToken);
        if (callback is null)
        {
            var existingCallback = await GetCallbackAsync(connection, transaction, provider, eventId, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            if (!string.Equals(existingCallback?["raw_body_hash"]?.ToString(), rawHash, StringComparison.OrdinalIgnoreCase))
            {
                return Rejected(provider, eventId, "callback event body mismatch", conflict: true);
            }

            return new Dictionary<string, object?>
            {
                ["duplicate"] = true,
                ["provider"] = provider,
                ["event_id"] = eventId,
            };
        }

        if (!request.SignatureValid)
        {
            await UpdateCallbackAsync(connection, transaction, (Guid)callback["id"]!, "rejected", "invalid signature", cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new Dictionary<string, object?>
            {
                ["duplicate"] = false,
                ["processed"] = false,
                ["provider"] = provider,
                ["event_id"] = eventId,
                ["error"] = "invalid signature",
            };
        }

        var policyError = ValidateCallbackPolicy(request);
        if (policyError is not null)
        {
            await UpdateCallbackAsync(connection, transaction, (Guid)callback["id"]!, "rejected", policyError, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return Rejected(provider, eventId, policyError);
        }

        var accountId = await accounts.EnsureAccountAsync(connection, transaction, request, cancellationToken);
        await PostgresAccountStore.LockAccountLaneAsync(connection, transaction, accountId, AccountLanes.Finance, cancellationToken);

        var order = await UpsertAndLockPaymentOrderAsync(connection, transaction, request, accountId, provider, cancellationToken);
        var orderConflict = ValidatePaymentOrderConsistency(order, request, accountId, provider);
        if (orderConflict is not null)
        {
            await UpdateCallbackAsync(connection, transaction, (Guid)callback["id"]!, "conflict", orderConflict, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return Rejected(provider, eventId, orderConflict, conflict: true);
        }

        if (order["status"]?.ToString() == "paid")
        {
            await UpdateCallbackAsync(connection, transaction, (Guid)callback["id"]!, "replayed", null, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new Dictionary<string, object?>
            {
                ["duplicate"] = true,
                ["payment_order"] = order,
            };
        }

        var amountCents = Convert.ToInt64(order["amount_cents"] ?? 0L);
        var creditAmount = Convert.ToDecimal(order["credit_amount"] ?? 0m);
        if (amountCents <= 0 && creditAmount <= 0)
        {
            await UpdateCallbackAsync(connection, transaction, (Guid)callback["id"]!, "failed", "payment amount is zero", cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new Dictionary<string, object?>
            {
                ["processed"] = false,
                ["error"] = "payment amount is zero",
            };
        }

        var balance = await EnsureAndLockBalanceAsync(
            connection,
            transaction,
            accountId,
            order["currency"]?.ToString() ?? "CNY",
            cancellationToken);
        var nextBalanceCents = Convert.ToInt64(balance["balance_cents"] ?? 0L) + amountCents;
        var nextCreditBalance = Convert.ToDecimal(balance["credit_balance"] ?? 0m) + creditAmount;
        var ledgerIdempotency = $"payment:{provider}:{eventId}";
        var ledgerInserted = await InsertLedgerAsync(
            connection,
            transaction,
            accountId,
            order,
            request,
            amountCents,
            creditAmount,
            nextBalanceCents,
            nextCreditBalance,
            ledgerIdempotency,
            cancellationToken);

        if (ledgerInserted)
        {
            await UpdateBalanceAsync(
                connection,
                transaction,
                accountId,
                order["currency"]?.ToString() ?? "CNY",
                nextBalanceCents,
                nextCreditBalance,
                cancellationToken);
        }

        var paidOrder = await MarkOrderPaidAsync(connection, transaction, order, request, cancellationToken);
        await InsertOutboxAsync(connection, transaction, paidOrder, cancellationToken);
        await UpdateCallbackAsync(connection, transaction, (Guid)callback["id"]!, "processed", null, cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return new Dictionary<string, object?>
        {
            ["duplicate"] = !ledgerInserted,
            ["payment_order"] = paidOrder,
            ["ledger_inserted"] = ledgerInserted,
        };
    }

    private static async Task<Dictionary<string, object?>?> InsertCallbackAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        PaymentCallbackRequest request,
        string provider,
        string eventId,
        string rawHash,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO payment_callbacks (
              provider, event_id, merchant_order_no, provider_trade_no,
              signature_valid, processing_status, raw_body_hash, data
            )
            VALUES (
              @provider, @eventId, @merchantOrderNo, @providerTradeNo,
              @signatureValid, 'received', @rawHash, CAST(@data AS jsonb)
            )
            ON CONFLICT (provider, event_id) DO NOTHING
            RETURNING *
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("provider", NpgsqlDbType.Text, provider);
        command.Parameters.AddWithValue("eventId", NpgsqlDbType.Text, eventId);
        command.Parameters.AddWithValue("merchantOrderNo", NpgsqlDbType.Text, (object?)request.MerchantOrderNo ?? DBNull.Value);
        command.Parameters.AddWithValue("providerTradeNo", NpgsqlDbType.Text, (object?)request.ProviderTradeNo ?? DBNull.Value);
        command.Parameters.AddWithValue("signatureValid", NpgsqlDbType.Boolean, request.SignatureValid);
        command.Parameters.AddWithValue("rawHash", NpgsqlDbType.Text, rawHash);
        command.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, Jsonb.From(request.Data));
        return await PostgresRows.ReadSingleAsync(command, cancellationToken);
    }

    private static async Task<Dictionary<string, object?>?> GetCallbackAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        string provider,
        string eventId,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            """
            SELECT *
            FROM payment_callbacks
            WHERE provider = @provider
              AND event_id = @eventId
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("provider", NpgsqlDbType.Text, provider);
        command.Parameters.AddWithValue("eventId", NpgsqlDbType.Text, eventId);
        return await PostgresRows.ReadSingleAsync(command, cancellationToken);
    }

    private static async Task<Dictionary<string, object?>> UpsertAndLockPaymentOrderAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        PaymentCallbackRequest request,
        Guid accountId,
        string provider,
        CancellationToken cancellationToken)
    {
        var merchantOrderNo = FirstNonBlank(request.MerchantOrderNo, request.ProviderTradeNo)
            ?? $"callback-{Guid.NewGuid():N}";
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO payment_orders (
              account_id, provider, merchant_order_no, provider_trade_no,
              idempotency_key, status, amount_cents, credit_amount, currency,
              paid_at, data, created_at, updated_at
            )
            VALUES (
              @accountId, @provider, @merchantOrderNo, @providerTradeNo,
              @idempotencyKey, 'pending', @amountCents, @creditAmount, @currency,
              @paidAt, CAST(@data AS jsonb), now(), now()
            )
            ON CONFLICT (merchant_order_no) DO UPDATE SET
              provider_trade_no = COALESCE(payment_orders.provider_trade_no, EXCLUDED.provider_trade_no),
              data = payment_orders.data || EXCLUDED.data,
              updated_at = now()
            RETURNING *
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("provider", NpgsqlDbType.Text, provider);
        command.Parameters.AddWithValue("merchantOrderNo", NpgsqlDbType.Text, merchantOrderNo);
        command.Parameters.AddWithValue("providerTradeNo", NpgsqlDbType.Text, (object?)request.ProviderTradeNo ?? DBNull.Value);
        command.Parameters.AddWithValue("idempotencyKey", NpgsqlDbType.Text, $"payment-order:{merchantOrderNo}");
        command.Parameters.AddWithValue("amountCents", NpgsqlDbType.Bigint, request.AmountCents);
        command.Parameters.AddWithValue("creditAmount", NpgsqlDbType.Numeric, request.CreditAmount);
        command.Parameters.AddWithValue("currency", NpgsqlDbType.Text, string.IsNullOrWhiteSpace(request.Currency) ? "CNY" : request.Currency);
        command.Parameters.AddWithValue("paidAt", NpgsqlDbType.TimestampTz, (object?)request.PaidAt ?? DBNull.Value);
        command.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, Jsonb.From(request.Data));
        var order = await PostgresRows.ReadSingleAsync(command, cancellationToken)
            ?? throw new InvalidOperationException("Failed to upsert payment order.");

        await using var lockCommand = new NpgsqlCommand("SELECT * FROM payment_orders WHERE id = @id FOR UPDATE", connection, transaction);
        lockCommand.Parameters.AddWithValue("id", NpgsqlDbType.Uuid, (Guid)order["id"]!);
        return await PostgresRows.ReadSingleAsync(lockCommand, cancellationToken)
            ?? throw new InvalidOperationException("Failed to lock payment order.");
    }

    private static string? ValidateCallbackPolicy(PaymentCallbackRequest request)
    {
        var regionCode = string.IsNullOrWhiteSpace(request.RegionCode)
            ? "CN"
            : request.RegionCode.Trim();
        if (!string.Equals(regionCode, "CN", StringComparison.OrdinalIgnoreCase))
        {
            return "payment callback region is not allowed";
        }

        var sensitivity = GetDataString(request.Data, "dataSensitivity")
            ?? GetDataString(request.Data, "data_sensitivity");
        if (string.Equals(sensitivity, "restricted", StringComparison.OrdinalIgnoreCase))
        {
            return "payment callback data sensitivity is not allowed";
        }

        return null;
    }

    private static string? ValidatePaymentOrderConsistency(
        Dictionary<string, object?> order,
        PaymentCallbackRequest request,
        Guid accountId,
        string provider)
    {
        if (order.TryGetValue("account_id", out var existingAccountId)
            && existingAccountId is Guid orderAccountId
            && orderAccountId != accountId)
        {
            return "payment order account mismatch";
        }

        if (!string.Equals(order["provider"]?.ToString(), provider, StringComparison.OrdinalIgnoreCase))
        {
            return "payment order provider mismatch";
        }

        var existingTradeNo = order["provider_trade_no"]?.ToString();
        if (!string.IsNullOrWhiteSpace(existingTradeNo)
            && !string.IsNullOrWhiteSpace(request.ProviderTradeNo)
            && !string.Equals(existingTradeNo, request.ProviderTradeNo.Trim(), StringComparison.Ordinal))
        {
            return "payment order provider trade number mismatch";
        }

        if (Convert.ToInt64(order["amount_cents"] ?? 0L) != request.AmountCents)
        {
            return "payment order amount mismatch";
        }

        if (Convert.ToDecimal(order["credit_amount"] ?? 0m) != request.CreditAmount)
        {
            return "payment order credit amount mismatch";
        }

        var currency = string.IsNullOrWhiteSpace(request.Currency) ? "CNY" : request.Currency.Trim();
        if (!string.Equals(order["currency"]?.ToString(), currency, StringComparison.OrdinalIgnoreCase))
        {
            return "payment order currency mismatch";
        }

        return null;
    }

    private static async Task<Dictionary<string, object?>> EnsureAndLockBalanceAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid accountId,
        string currency,
        CancellationToken cancellationToken)
    {
        await using var ensure = new NpgsqlCommand(
            """
            INSERT INTO wallet_balances (account_id, currency, balance_cents, credit_balance, ledger_version)
            VALUES (@accountId, @currency, 0, 0, 0)
            ON CONFLICT (account_id, currency) DO NOTHING
            """,
            connection,
            transaction);
        ensure.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        ensure.Parameters.AddWithValue("currency", NpgsqlDbType.Text, currency);
        await ensure.ExecuteNonQueryAsync(cancellationToken);

        await using var select = new NpgsqlCommand(
            "SELECT * FROM wallet_balances WHERE account_id = @accountId AND currency = @currency FOR UPDATE",
            connection,
            transaction);
        select.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        select.Parameters.AddWithValue("currency", NpgsqlDbType.Text, currency);
        return await PostgresRows.ReadSingleAsync(select, cancellationToken)
            ?? throw new InvalidOperationException("Failed to lock wallet balance.");
    }

    private static async Task<bool> InsertLedgerAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid accountId,
        Dictionary<string, object?> order,
        PaymentCallbackRequest request,
        long amountCents,
        decimal creditAmount,
        long nextBalanceCents,
        decimal nextCreditBalance,
        string idempotencyKey,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO wallet_ledger (
              id, wallet_id, actor_id, entry_type, amount, source_type, source_id,
              data, created_at, updated_at, account_id, currency, amount_cents,
              credit_amount, balance_after_cents, balance_after_credits,
              payment_order_id, idempotency_key, immutable
            )
            VALUES (
              @id, NULL, NULL, 'recharge', @creditAmount, 'payment_order', @sourceId,
              CAST(@data AS jsonb), now(), now(), @accountId, @currency, @amountCents,
              @creditAmount, @balanceAfterCents, @balanceAfterCredits,
              @paymentOrderId, @idempotencyKey, true
            )
            ON CONFLICT (account_id, idempotency_key)
            WHERE account_id IS NOT NULL AND idempotency_key IS NOT NULL
            DO NOTHING
            RETURNING id
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("id", NpgsqlDbType.Text, $"ledger_{Guid.NewGuid():N}");
        command.Parameters.AddWithValue("creditAmount", NpgsqlDbType.Numeric, creditAmount);
        command.Parameters.AddWithValue("sourceId", NpgsqlDbType.Text, order["id"]?.ToString() ?? "");
        command.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, JsonSerializer.Serialize(new
        {
            request.Provider,
            request.EventId,
            request.MerchantOrderNo,
            request.ProviderTradeNo,
        }));
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("currency", NpgsqlDbType.Text, order["currency"]?.ToString() ?? "CNY");
        command.Parameters.AddWithValue("amountCents", NpgsqlDbType.Bigint, amountCents);
        command.Parameters.AddWithValue("balanceAfterCents", NpgsqlDbType.Bigint, nextBalanceCents);
        command.Parameters.AddWithValue("balanceAfterCredits", NpgsqlDbType.Numeric, nextCreditBalance);
        command.Parameters.AddWithValue("paymentOrderId", NpgsqlDbType.Uuid, (Guid)order["id"]!);
        command.Parameters.AddWithValue("idempotencyKey", NpgsqlDbType.Text, idempotencyKey);
        return await command.ExecuteScalarAsync(cancellationToken) is not null;
    }

    private static async Task UpdateBalanceAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid accountId,
        string currency,
        long balanceCents,
        decimal creditBalance,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            """
            UPDATE wallet_balances
            SET balance_cents = @balanceCents,
                credit_balance = @creditBalance,
                ledger_version = ledger_version + 1,
                updated_at = now()
            WHERE account_id = @accountId AND currency = @currency
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("currency", NpgsqlDbType.Text, currency);
        command.Parameters.AddWithValue("balanceCents", NpgsqlDbType.Bigint, balanceCents);
        command.Parameters.AddWithValue("creditBalance", NpgsqlDbType.Numeric, creditBalance);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task<Dictionary<string, object?>> MarkOrderPaidAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Dictionary<string, object?> order,
        PaymentCallbackRequest request,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            """
            UPDATE payment_orders
            SET status = 'paid',
                provider_trade_no = COALESCE(@providerTradeNo, provider_trade_no),
                paid_at = COALESCE(@paidAt, now()),
                updated_at = now()
            WHERE id = @id
            RETURNING *
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("id", NpgsqlDbType.Uuid, (Guid)order["id"]!);
        command.Parameters.AddWithValue("providerTradeNo", NpgsqlDbType.Text, (object?)request.ProviderTradeNo ?? DBNull.Value);
        command.Parameters.AddWithValue("paidAt", NpgsqlDbType.TimestampTz, (object?)request.PaidAt ?? DBNull.Value);
        return await PostgresRows.ReadSingleAsync(command, cancellationToken)
            ?? throw new InvalidOperationException("Failed to mark order paid.");
    }

    private static async Task InsertOutboxAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Dictionary<string, object?> order,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
            VALUES (
              'payment_order',
              @orderId,
              'payment.paid',
              jsonb_build_object('payment_order_id', @orderId, 'account_id', @accountId)
            )
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("orderId", NpgsqlDbType.Text, order["id"]?.ToString() ?? "");
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Text, order["account_id"]?.ToString() ?? "");
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task UpdateCallbackAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid callbackId,
        string status,
        string? error,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            """
            UPDATE payment_callbacks
            SET processing_status = @status,
                processed_at = now(),
                error = @error
            WHERE id = @id
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("id", NpgsqlDbType.Uuid, callbackId);
        command.Parameters.AddWithValue("status", NpgsqlDbType.Text, status);
        command.Parameters.AddWithValue("error", NpgsqlDbType.Text, (object?)error ?? DBNull.Value);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static string? FirstNonBlank(params string?[] values)
    {
        return values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim();
    }

    private static string? GetDataString(JsonElement data, string propertyName)
    {
        if (data.ValueKind != JsonValueKind.Object
            || !data.TryGetProperty(propertyName, out var value)
            || value.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return value.GetString();
    }

    private static Dictionary<string, object?> Rejected(
        string provider,
        string eventId,
        string error,
        bool conflict = false)
    {
        return new Dictionary<string, object?>
        {
            ["duplicate"] = false,
            ["processed"] = false,
            ["provider"] = provider,
            ["event_id"] = eventId,
            ["conflict"] = conflict,
            ["error"] = error,
        };
    }
}
