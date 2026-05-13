using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using XiaoLou.Domain;
using Npgsql;
using NpgsqlTypes;

namespace XiaoLou.Infrastructure.Postgres;

public sealed class PostgresPaymentLedger(NpgsqlDataSource dataSource, PostgresAccountStore accounts)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<Dictionary<string, object?>> CreateRechargeOrderAsync(
        CreateWalletRechargeOrderRequest request,
        AccountScope scope,
        Guid? walletAccountId,
        string? actorId,
        string? idempotencyKey,
        CancellationToken cancellationToken)
    {
        var paymentMethod = NormalizeRechargePaymentMethod(request.PaymentMethod) ?? "wechat_pay";
        var provider = PaymentMethodToProvider(paymentMethod);
        var mode = NormalizeRechargeMode(request.Mode)
            ?? (paymentMethod == "bank_transfer" ? "live" : "demo_mock");
        var scene = NormalizeRechargeScene(request.Scene) ?? DefaultRechargeScene(paymentMethod, mode);
        var currency = string.IsNullOrWhiteSpace(request.Currency) ? "CNY" : request.Currency.Trim();
        var amountCents = AmountToCents(request.Amount);
        var merchantOrderNo = $"xlr_{DateTimeOffset.UtcNow:yyyyMMddHHmmss}_{Guid.NewGuid().ToString("N")[..12]}";
        var expiresAt = DateTimeOffset.UtcNow.Add(mode == "demo_mock" ? TimeSpan.FromMinutes(30) : TimeSpan.FromHours(2));
        var normalizedActorId = FirstNonBlank(actorId);
        var normalizedIdempotencyKey = NormalizeIdempotencyKey(idempotencyKey)
            ?? $"wallet-recharge:{Guid.NewGuid():N}";

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        var accountId = walletAccountId
            ?? await accounts.EnsureAccountAsync(connection, transaction, scope, cancellationToken);
        await PostgresAccountStore.LockAccountLaneAsync(connection, transaction, accountId, AccountLanes.Finance, cancellationToken);

        var data = new Dictionary<string, object?>
        {
            ["source"] = "wallet-recharge",
            ["planId"] = FirstNonBlank(request.PlanId) ?? "custom",
            ["planName"] = FirstNonBlank(request.PlanName) ?? "Wallet recharge",
            ["billingCycle"] = FirstNonBlank(request.BillingCycle) ?? "one_time",
            ["paymentMethod"] = paymentMethod,
            ["provider"] = provider,
            ["mode"] = mode,
            ["scene"] = scene,
            ["amount"] = request.Amount,
            ["credits"] = request.Credits,
            ["currency"] = currency,
            ["actorId"] = normalizedActorId,
            ["walletId"] = accountId.ToString("D"),
            ["walletOwnerType"] = FirstNonBlank(scope.AccountOwnerType) ?? "user",
            ["walletOwnerId"] = FirstNonBlank(scope.AccountOwnerId) ?? "guest",
            ["expiresAt"] = expiresAt.ToString("O"),
            ["reviewStatus"] = paymentMethod == "bank_transfer" ? "pending_proof" : null,
            ["callbackSafety"] = "live provider paid status is accepted only through signed /api/payments/callbacks/{provider}",
            ["ledgerIdempotency"] = mode == "demo_mock"
                ? "payment:demo_mock:{orderId}"
                : "provider-callback-event-id",
        };

        await using var command = new NpgsqlCommand(
            """
            INSERT INTO payment_orders (
              account_id, provider, merchant_order_no, provider_trade_no,
              idempotency_key, status, amount_cents, credit_amount, currency,
              data, created_at, updated_at
            )
            VALUES (
              @accountId, @provider, @merchantOrderNo, NULL,
              @idempotencyKey, 'pending', @amountCents, @creditAmount, @currency,
              CAST(@data AS jsonb), now(), now()
            )
            ON CONFLICT (account_id, idempotency_key) DO UPDATE SET
              updated_at = payment_orders.updated_at
            RETURNING *
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("provider", NpgsqlDbType.Text, provider);
        command.Parameters.AddWithValue("merchantOrderNo", NpgsqlDbType.Text, merchantOrderNo);
        command.Parameters.AddWithValue("idempotencyKey", NpgsqlDbType.Text, normalizedIdempotencyKey);
        command.Parameters.AddWithValue("amountCents", NpgsqlDbType.Bigint, amountCents);
        command.Parameters.AddWithValue("creditAmount", NpgsqlDbType.Numeric, request.Credits);
        command.Parameters.AddWithValue("currency", NpgsqlDbType.Text, currency);
        command.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, JsonSerializer.Serialize(data, JsonOptions));

        var order = await PostgresRows.ReadSingleAsync(command, cancellationToken)
            ?? throw new InvalidOperationException("Failed to create wallet recharge order.");
        await transaction.CommitAsync(cancellationToken);
        return MapRechargeOrder(order);
    }

    public async Task<Dictionary<string, object?>?> GetRechargeOrderAsync(
        Guid orderId,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT *
            FROM payment_orders
            WHERE id = @id
              AND data->>'source' = 'wallet-recharge'
            LIMIT 1
            """,
            connection);
        command.Parameters.AddWithValue("id", NpgsqlDbType.Uuid, orderId);
        var order = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        return order is null ? null : MapRechargeOrder(order);
    }

    public Task<Dictionary<string, object?>?> RefreshRechargeOrderAsync(
        Guid orderId,
        CancellationToken cancellationToken)
    {
        return GetRechargeOrderAsync(orderId, cancellationToken);
    }

    public async Task<Dictionary<string, object?>?> SubmitBankTransferProofAsync(
        Guid orderId,
        WalletRechargeTransferProofRequest request,
        CancellationToken cancellationToken)
    {
        var files = request.VoucherFiles?
            .Select(value => FirstNonBlank(value))
            .Where(value => value is not null)
            .Cast<string>()
            .Distinct(StringComparer.Ordinal)
            .ToArray() ?? Array.Empty<string>();
        var proofData = new Dictionary<string, object?>
        {
            ["voucherFiles"] = files,
            ["transferNote"] = FirstNonBlank(request.Note),
            ["transferReference"] = FirstNonBlank(request.TransferReference),
            ["reviewStatus"] = "submitted",
            ["proofSubmittedAt"] = DateTimeOffset.UtcNow.ToString("O"),
        };

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            UPDATE payment_orders
            SET status = CASE WHEN status = 'paid' THEN status ELSE 'pending' END,
                data = data || CAST(@data AS jsonb),
                updated_at = now()
            WHERE id = @id
              AND data->>'source' = 'wallet-recharge'
            RETURNING *
            """,
            connection);
        command.Parameters.AddWithValue("id", NpgsqlDbType.Uuid, orderId);
        command.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, JsonSerializer.Serialize(proofData, JsonOptions));
        var order = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        return order is null ? null : MapRechargeOrder(order);
    }

    public async Task<Dictionary<string, object?>?> ReviewBankTransferRechargeOrderAsync(
        Guid orderId,
        AdminOrderReviewRequest request,
        string? reviewerId,
        CancellationToken cancellationToken)
    {
        var decision = NormalizeAdminReviewDecision(request.Decision)
            ?? throw new ArgumentException("decision must be approve or reject", nameof(request.Decision));
        var normalizedReviewerId = FirstNonBlank(reviewerId) ?? "system";
        var note = FirstNonBlank(request.Note);
        var reviewedAt = DateTimeOffset.UtcNow;

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var order = await GetRechargeOrderForUpdateAsync(connection, transaction, orderId, cancellationToken);
        if (order is null)
        {
            await transaction.CommitAsync(cancellationToken);
            return null;
        }

        var mappedOrder = MapRechargeOrder(order);
        if (!string.Equals(mappedOrder["paymentMethod"]?.ToString(), "bank_transfer", StringComparison.Ordinal))
        {
            await transaction.CommitAsync(cancellationToken);
            return ReviewConflict("admin review is only supported for bank_transfer wallet recharge orders", mappedOrder);
        }

        var status = mappedOrder["status"]?.ToString();
        var reviewStatus = mappedOrder["reviewStatus"]?.ToString();
        if (string.Equals(status, "paid", StringComparison.Ordinal))
        {
            await transaction.CommitAsync(cancellationToken);
            if (decision == "approve"
                && string.Equals(reviewStatus, "approved", StringComparison.Ordinal))
            {
                mappedOrder["ledgerInserted"] = false;
                mappedOrder["duplicate"] = true;
                mappedOrder["reviewDecision"] = decision;
                return mappedOrder;
            }

            return ReviewConflict("wallet recharge order is already paid", mappedOrder);
        }

        if (string.Equals(status, "failed", StringComparison.Ordinal)
            || string.Equals(reviewStatus, "rejected", StringComparison.Ordinal))
        {
            await transaction.CommitAsync(cancellationToken);
            return decision == "reject"
                ? ReviewDuplicate(mappedOrder, decision)
                : ReviewConflict("rejected bank transfer orders cannot be approved", mappedOrder);
        }

        if (!string.Equals(reviewStatus, "submitted", StringComparison.Ordinal))
        {
            await transaction.CommitAsync(cancellationToken);
            return ReviewConflict("bank transfer proof must be submitted before admin review", mappedOrder);
        }

        if (decision == "reject")
        {
            var rejectedOrder = await PatchOrderReviewAsync(
                connection,
                transaction,
                orderId,
                "failed",
                BuildAdminReviewPatch(
                    "rejected",
                    decision,
                    normalizedReviewerId,
                    note,
                    reviewedAt,
                    ledgerIdempotency: null),
                cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            var rejectedResult = MapRechargeOrder(rejectedOrder);
            rejectedResult["ledgerInserted"] = false;
            rejectedResult["duplicate"] = false;
            return rejectedResult;
        }

        var accountId = (Guid)order["account_id"]!;
        await PostgresAccountStore.LockAccountLaneAsync(connection, transaction, accountId, AccountLanes.Finance, cancellationToken);
        var amountCents = Convert.ToInt64(order["amount_cents"] ?? 0L);
        var creditAmount = Convert.ToDecimal(order["credit_amount"] ?? 0m);
        if (amountCents <= 0 && creditAmount <= 0)
        {
            await transaction.CommitAsync(cancellationToken);
            return ReviewConflict("payment amount is zero", mappedOrder);
        }

        var currency = order["currency"]?.ToString() ?? "CNY";
        var balance = await EnsureAndLockBalanceAsync(connection, transaction, accountId, currency, cancellationToken);
        var nextBalanceCents = Convert.ToInt64(balance["balance_cents"] ?? 0L) + amountCents;
        var nextCreditBalance = Convert.ToDecimal(balance["credit_balance"] ?? 0m) + creditAmount;
        var merchantOrderNo = order["merchant_order_no"]?.ToString();
        var providerTradeNo = FirstNonBlank(
            mappedOrder["transferReference"]?.ToString(),
            merchantOrderNo,
            $"admin-review-{orderId:N}");
        var callback = new PaymentCallbackRequest
        {
            Provider = "bank_transfer",
            EventId = $"admin-review:{orderId:D}",
            MerchantOrderNo = merchantOrderNo,
            ProviderTradeNo = providerTradeNo,
            AmountCents = amountCents,
            CreditAmount = creditAmount,
            Currency = currency,
            PaidAt = reviewedAt,
            Data = ToJsonElement(new
            {
                source = "wallet-recharge-admin-review",
                orderId = orderId.ToString("D"),
                reviewedBy = normalizedReviewerId,
                reviewDecision = decision,
                reviewNote = note,
            }),
        };
        var ledgerIdempotency = $"payment:admin_review:{orderId:D}";
        var ledgerInserted = await InsertLedgerAsync(
            connection,
            transaction,
            accountId,
            order,
            callback,
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
                currency,
                nextBalanceCents,
                nextCreditBalance,
                cancellationToken);
        }

        var paidOrder = await MarkOrderPaidAsync(connection, transaction, order, callback, cancellationToken);
        var auditedOrder = await PatchOrderReviewAsync(
            connection,
            transaction,
            (Guid)paidOrder["id"]!,
            paymentStatus: null,
            BuildAdminReviewPatch(
                "approved",
                decision,
                normalizedReviewerId,
                note,
                reviewedAt,
                ledgerIdempotency),
            cancellationToken);
        await InsertOutboxAsync(connection, transaction, auditedOrder, cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        var result = MapRechargeOrder(auditedOrder);
        result["ledgerInserted"] = ledgerInserted;
        result["duplicate"] = !ledgerInserted;
        result["reviewDecision"] = decision;
        return result;
    }

    public async Task<Dictionary<string, object?>> ConfirmDemoRechargeOrderAsync(
        Guid orderId,
        string? actorId,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var order = await GetRechargeOrderForUpdateAsync(connection, transaction, orderId, cancellationToken);
        if (order is null)
        {
            await transaction.CommitAsync(cancellationToken);
            return new Dictionary<string, object?>
            {
                ["error"] = "wallet recharge order not found",
            };
        }

        var mappedOrder = MapRechargeOrder(order);
        if (mappedOrder["status"]?.ToString() == "paid")
        {
            await transaction.CommitAsync(cancellationToken);
            mappedOrder["ledgerInserted"] = false;
            mappedOrder["duplicate"] = true;
            return mappedOrder;
        }

        if (!string.Equals(mappedOrder["mode"]?.ToString(), "demo_mock", StringComparison.Ordinal))
        {
            await transaction.CommitAsync(cancellationToken);
            return new Dictionary<string, object?>
            {
                ["error"] = "only demo_mock wallet recharge orders can be confirmed by client",
                ["order"] = mappedOrder,
            };
        }

        var accountId = (Guid)order["account_id"]!;
        await PostgresAccountStore.LockAccountLaneAsync(connection, transaction, accountId, AccountLanes.Finance, cancellationToken);
        var amountCents = Convert.ToInt64(order["amount_cents"] ?? 0L);
        var creditAmount = Convert.ToDecimal(order["credit_amount"] ?? 0m);
        if (amountCents <= 0 && creditAmount <= 0)
        {
            await transaction.CommitAsync(cancellationToken);
            return new Dictionary<string, object?>
            {
                ["error"] = "payment amount is zero",
                ["order"] = mappedOrder,
            };
        }

        var currency = order["currency"]?.ToString() ?? "CNY";
        var balance = await EnsureAndLockBalanceAsync(connection, transaction, accountId, currency, cancellationToken);
        var nextBalanceCents = Convert.ToInt64(balance["balance_cents"] ?? 0L) + amountCents;
        var nextCreditBalance = Convert.ToDecimal(balance["credit_balance"] ?? 0m) + creditAmount;
        var merchantOrderNo = order["merchant_order_no"]?.ToString();
        var callback = new PaymentCallbackRequest
        {
            Provider = "demo_mock",
            EventId = $"demo-confirm:{orderId:D}",
            MerchantOrderNo = merchantOrderNo,
            ProviderTradeNo = $"demo-{orderId:N}",
            AmountCents = amountCents,
            CreditAmount = creditAmount,
            Currency = currency,
            PaidAt = DateTimeOffset.UtcNow,
            Data = ToJsonElement(new
            {
                source = "wallet-recharge-demo-confirm",
                actorId = FirstNonBlank(actorId),
                orderId = orderId.ToString("D"),
            }),
        };
        var ledgerIdempotency = $"payment:demo_mock:{orderId:D}";
        var ledgerInserted = await InsertLedgerAsync(
            connection,
            transaction,
            accountId,
            order,
            callback,
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
                currency,
                nextBalanceCents,
                nextCreditBalance,
                cancellationToken);
        }

        var paidOrder = await MarkOrderPaidAsync(connection, transaction, order, callback, cancellationToken);
        await InsertOutboxAsync(connection, transaction, paidOrder, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        var result = MapRechargeOrder(paidOrder);
        result["ledgerInserted"] = ledgerInserted;
        result["duplicate"] = !ledgerInserted;
        return result;
    }

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
              data = payment_orders.data || (
                EXCLUDED.data
                - 'source'
                - 'paymentMethod'
                - 'provider'
                - 'mode'
                - 'scene'
                - 'walletId'
                - 'walletOwnerType'
                - 'walletOwnerId'
                - 'ledgerIdempotency'
                - 'callbackSafety'
                - 'voucherFiles'
                - 'transferReference'
                - 'transferNote'
                - 'proofSubmittedAt'
                - 'reviewStatus'
                - 'reviewDecision'
                - 'reviewedAt'
                - 'reviewedBy'
                - 'reviewNote'
                - 'reviewAudit'
              ),
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

        var orderData = ReadJsonElement(order, "data");
        if (string.Equals(GetDataString(orderData, "source"), "wallet-recharge", StringComparison.Ordinal)
            && string.Equals(GetDataString(orderData, "paymentMethod"), "bank_transfer", StringComparison.Ordinal))
        {
            return "bank transfer wallet recharge orders settle only through admin review";
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

    private static async Task<Dictionary<string, object?>> PatchOrderReviewAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid orderId,
        string? paymentStatus,
        Dictionary<string, object?> patch,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            """
            UPDATE payment_orders
            SET status = CASE
                  WHEN @status::text IS NULL THEN status
                  ELSE @status::payment_order_status
                END,
                data = data || CAST(@data AS jsonb),
                updated_at = now()
            WHERE id = @id
            RETURNING *
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("id", NpgsqlDbType.Uuid, orderId);
        command.Parameters.AddWithValue("status", NpgsqlDbType.Text, (object?)paymentStatus ?? DBNull.Value);
        command.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, JsonSerializer.Serialize(patch, JsonOptions));
        return await PostgresRows.ReadSingleAsync(command, cancellationToken)
            ?? throw new InvalidOperationException("Failed to patch payment order review audit.");
    }

    private static Dictionary<string, object?> BuildAdminReviewPatch(
        string reviewStatus,
        string decision,
        string reviewerId,
        string? note,
        DateTimeOffset reviewedAt,
        string? ledgerIdempotency)
    {
        var patch = new Dictionary<string, object?>
        {
            ["reviewStatus"] = reviewStatus,
            ["reviewDecision"] = decision,
            ["reviewedBy"] = reviewerId,
            ["reviewedAt"] = reviewedAt.ToString("O"),
            ["reviewNote"] = note,
            ["callbackSafety"] = "bank transfer wallet recharge settles through admin review; signed callbacks cannot overwrite proof or review audit",
            ["reviewAudit"] = new Dictionary<string, object?>
            {
                ["decision"] = decision,
                ["status"] = reviewStatus,
                ["reviewedBy"] = reviewerId,
                ["reviewedAt"] = reviewedAt.ToString("O"),
                ["note"] = note,
                ["ledgerIdempotency"] = ledgerIdempotency,
            },
        };

        if (ledgerIdempotency is not null)
        {
            patch["ledgerIdempotency"] = ledgerIdempotency;
        }

        if (reviewStatus == "rejected")
        {
            patch["failureReason"] = note ?? "bank transfer proof rejected by admin review";
        }

        return patch;
    }

    private static Dictionary<string, object?> ReviewConflict(
        string error,
        Dictionary<string, object?> order)
    {
        return new Dictionary<string, object?>
        {
            ["error"] = error,
            ["order"] = order,
        };
    }

    private static Dictionary<string, object?> ReviewDuplicate(
        Dictionary<string, object?> order,
        string decision)
    {
        order["ledgerInserted"] = false;
        order["duplicate"] = true;
        order["reviewDecision"] = decision;
        return order;
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

    private static async Task<Dictionary<string, object?>?> GetRechargeOrderForUpdateAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid orderId,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            """
            SELECT *
            FROM payment_orders
            WHERE id = @id
              AND data->>'source' = 'wallet-recharge'
            FOR UPDATE
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("id", NpgsqlDbType.Uuid, orderId);
        return await PostgresRows.ReadSingleAsync(command, cancellationToken);
    }

    private static Dictionary<string, object?> MapRechargeOrder(Dictionary<string, object?> row)
    {
        var data = ReadJsonElement(row, "data");
        var provider = ReadString(row, "provider") ?? "";
        var paymentMethod = GetDataString(data, "paymentMethod")
            ?? ProviderToPaymentMethod(provider);
        var mode = GetDataString(data, "mode")
            ?? (paymentMethod == "bank_transfer" ? "live" : "demo_mock");
        var scene = GetDataString(data, "scene") ?? DefaultRechargeScene(paymentMethod, mode);
        var status = ReadString(row, "status") ?? "pending";
        var orderId = ReadString(row, "id") ?? "";
        var merchantOrderNo = ReadString(row, "merchant_order_no");
        var amountCents = ReadLong(row, "amount_cents");
        var reviewStatus = GetDataString(data, "reviewStatus")
            ?? (status == "proof_submitted" ? "submitted" : null);
        if (paymentMethod == "bank_transfer"
            && status == "pending"
            && reviewStatus == "submitted")
        {
            status = "pending_review";
        }

        var order = new Dictionary<string, object?>
        {
            ["id"] = orderId,
            ["planId"] = GetDataString(data, "planId") ?? "custom",
            ["planName"] = GetDataString(data, "planName") ?? "Wallet recharge",
            ["billingCycle"] = GetDataString(data, "billingCycle") ?? "one_time",
            ["paymentMethod"] = paymentMethod,
            ["provider"] = provider,
            ["scene"] = scene,
            ["mode"] = mode,
            ["amount"] = amountCents == 0 ? ReadDecimal(row, "amount") : amountCents / 100m,
            ["credits"] = ReadDecimal(row, "credit_amount"),
            ["currency"] = ReadString(row, "currency") ?? GetDataString(data, "currency") ?? "CNY",
            ["status"] = status,
            ["actorId"] = GetDataString(data, "actorId"),
            ["walletId"] = GetDataString(data, "walletId") ?? ReadString(row, "account_id"),
            ["walletOwnerType"] = GetDataString(data, "walletOwnerType"),
            ["walletOwnerId"] = GetDataString(data, "walletOwnerId"),
            ["payerType"] = GetDataString(data, "walletOwnerType"),
            ["providerTradeNo"] = ReadString(row, "provider_trade_no"),
            ["merchantOrderNo"] = merchantOrderNo,
            ["notifyPayload"] = null,
            ["paidAt"] = ReadDateIso(row, "paid_at"),
            ["expiredAt"] = GetDataString(data, "expiredAt"),
            ["failureReason"] = GetDataString(data, "failureReason"),
            ["voucherFiles"] = GetDataStringArray(data, "voucherFiles"),
            ["reviewStatus"] = reviewStatus,
            ["reviewedAt"] = GetDataString(data, "reviewedAt"),
            ["reviewedBy"] = GetDataString(data, "reviewedBy"),
            ["reviewNote"] = GetDataString(data, "reviewNote"),
            ["qrCodePayload"] = GetDataString(data, "qrCodePayload"),
            ["qrCodeHint"] = GetDataString(data, "qrCodeHint"),
            ["codeUrl"] = GetDataString(data, "codeUrl"),
            ["h5Url"] = GetDataString(data, "h5Url"),
            ["redirectUrl"] = GetDataString(data, "redirectUrl"),
            ["bankAccount"] = GetDataValue(data, "bankAccount"),
            ["transferReference"] = GetDataString(data, "transferReference"),
            ["transferNote"] = GetDataString(data, "transferNote"),
            ["createdAt"] = ReadDateIso(row, "created_at") ?? DateTimeOffset.UtcNow.ToString("O"),
            ["updatedAt"] = ReadDateIso(row, "updated_at") ?? DateTimeOffset.UtcNow.ToString("O"),
            ["expiresAt"] = GetDataString(data, "expiresAt"),
            ["account_id"] = ReadString(row, "account_id"),
            ["account_owner_type"] = GetDataString(data, "walletOwnerType") ?? "user",
            ["account_owner_id"] = GetDataString(data, "walletOwnerId") ?? "guest",
            ["ledgerIdempotency"] = mode == "demo_mock"
                ? $"payment:demo_mock:{orderId}"
                : GetDataString(data, "ledgerIdempotency"),
            ["callbackSafety"] = GetDataString(data, "callbackSafety"),
        };

        if (mode == "demo_mock" && paymentMethod == "wechat_pay")
        {
            order["qrCodePayload"] ??= $"demo://wallet-recharge/{orderId}";
            order["qrCodeHint"] ??= "Demo mock order. Use confirm to post credits through the idempotent ledger path.";
        }

        if (mode == "demo_mock" && paymentMethod == "alipay")
        {
            order["redirectUrl"] ??= $"/wallet/recharge?orderId={Uri.EscapeDataString(orderId)}&mode=demo_mock";
        }

        if (paymentMethod == "bank_transfer")
        {
            order["transferReference"] ??= merchantOrderNo;
        }

        return order;
    }

    private static JsonElement ToJsonElement(object value)
    {
        return JsonSerializer.SerializeToElement(value, JsonOptions);
    }

    private static JsonElement ReadJsonElement(Dictionary<string, object?> row, string key)
    {
        if (!row.TryGetValue(key, out var value) || value is null)
        {
            return default;
        }

        if (value is JsonElement element)
        {
            return element.Clone();
        }

        if (value is JsonDocument document)
        {
            return document.RootElement.Clone();
        }

        if (value is string json && !string.IsNullOrWhiteSpace(json))
        {
            try
            {
                using var documentFromString = JsonDocument.Parse(json);
                return documentFromString.RootElement.Clone();
            }
            catch (JsonException)
            {
                return default;
            }
        }

        return default;
    }

    private static object? GetDataValue(JsonElement data, string propertyName)
    {
        if (data.ValueKind != JsonValueKind.Object
            || !data.TryGetProperty(propertyName, out var value)
            || value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return null;
        }

        return value.Clone();
    }

    private static string[] GetDataStringArray(JsonElement data, string propertyName)
    {
        if (data.ValueKind != JsonValueKind.Object
            || !data.TryGetProperty(propertyName, out var value)
            || value.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<string>();
        }

        return value.EnumerateArray()
            .Where(item => item.ValueKind == JsonValueKind.String)
            .Select(item => item.GetString())
            .Where(item => !string.IsNullOrWhiteSpace(item))
            .Select(item => item!.Trim())
            .Distinct(StringComparer.Ordinal)
            .ToArray();
    }

    private static string? ReadString(Dictionary<string, object?> row, string key)
    {
        return row.TryGetValue(key, out var value) && value is not null
            ? FirstNonBlank(value.ToString())
            : null;
    }

    private static decimal ReadDecimal(Dictionary<string, object?> row, string key)
    {
        if (!row.TryGetValue(key, out var value) || value is null)
        {
            return 0m;
        }

        return value switch
        {
            decimal decimalValue => decimalValue,
            int intValue => intValue,
            long longValue => longValue,
            double doubleValue => Convert.ToDecimal(doubleValue),
            float floatValue => Convert.ToDecimal(floatValue),
            _ => decimal.TryParse(value.ToString(), out var parsed) ? parsed : 0m,
        };
    }

    private static long ReadLong(Dictionary<string, object?> row, string key)
    {
        if (!row.TryGetValue(key, out var value) || value is null)
        {
            return 0L;
        }

        return value switch
        {
            long longValue => longValue,
            int intValue => intValue,
            decimal decimalValue => Convert.ToInt64(decimalValue),
            _ => long.TryParse(value.ToString(), out var parsed) ? parsed : 0L,
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
            DateTimeOffset dateTimeOffset => dateTimeOffset.ToString("O"),
            DateTime dateTime => new DateTimeOffset(DateTime.SpecifyKind(dateTime, DateTimeKind.Utc)).ToString("O"),
            _ => FirstNonBlank(value.ToString()),
        };
    }

    private static long AmountToCents(decimal amount)
    {
        return Convert.ToInt64(decimal.Round(amount * 100m, 0, MidpointRounding.AwayFromZero));
    }

    private static string? NormalizeIdempotencyKey(string? value)
    {
        var key = FirstNonBlank(value);
        if (key is null)
        {
            return null;
        }

        return key.Length <= 160 ? key : key[..160];
    }

    private static string? NormalizeRechargePaymentMethod(string? value)
    {
        var method = FirstNonBlank(value)?.ToLowerInvariant();
        return method is "wechat_pay" or "wechat" or "alipay" or "bank_transfer"
            ? (method == "wechat" ? "wechat_pay" : method)
            : null;
    }

    private static string? NormalizeRechargeMode(string? value)
    {
        var mode = FirstNonBlank(value)?.ToLowerInvariant();
        return mode is "live" or "demo_mock" ? mode : null;
    }

    private static string? NormalizeRechargeScene(string? value)
    {
        var scene = FirstNonBlank(value)?.ToLowerInvariant();
        return scene is "desktop_qr" or "mobile_h5" or "pc_page" or "mobile_wap" or "bank_transfer"
            ? scene
            : null;
    }

    private static string? NormalizeAdminReviewDecision(string? value)
    {
        var decision = FirstNonBlank(value)?.ToLowerInvariant();
        return decision switch
        {
            "approve" or "approved" => "approve",
            "reject" or "rejected" => "reject",
            _ => null,
        };
    }

    private static string DefaultRechargeScene(string paymentMethod, string mode)
    {
        return paymentMethod switch
        {
            "wechat_pay" => "desktop_qr",
            "alipay" => "pc_page",
            "bank_transfer" => "bank_transfer",
            _ => "desktop_qr",
        };
    }

    private static string PaymentMethodToProvider(string paymentMethod)
    {
        return paymentMethod switch
        {
            "wechat_pay" => "wechat",
            "bank_transfer" => "bank_transfer",
            _ => paymentMethod,
        };
    }

    private static string ProviderToPaymentMethod(string provider)
    {
        return provider switch
        {
            "wechat" => "wechat_pay",
            "bank_transfer" => "bank_transfer",
            _ => "alipay",
        };
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
