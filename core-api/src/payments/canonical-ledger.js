const { createHash, randomUUID } = require("node:crypto");
const {
  ensureAccountForLegacyOwner,
  lockAccountLane,
} = require("../accounts/account-lanes");
const { accountIdForLegacyOwner, amountToCents, stableUuid } = require("../accounts/canonical-ids");

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function normalizeJson(value) {
  return JSON.stringify(value && typeof value === "object" ? value : {});
}

function normalizeCurrency(order) {
  return String(order?.currency || "CNY").trim() || "CNY";
}

function normalizeProvider(provider, order) {
  return String(provider || order?.provider || order?.paymentMethod || "unknown").trim().toLowerCase();
}

function resolveAccountInput(order) {
  const ownerType = order?.walletOwnerType || order?.payerType || "user";
  const ownerId = order?.walletOwnerId || order?.actorId || "guest";
  return {
    ownerType,
    ownerId,
    accountId: accountIdForLegacyOwner(ownerType, ownerId),
  };
}

function paymentOrderIdForRecharge(order) {
  return stableUuid("payment_order", order?.id || randomUUID());
}

function merchantOrderNo(order) {
  return String(order?.providerTradeNo || order?.id || "").trim();
}

function providerTradeNoFrom(order, notification) {
  return (
    String(notification?.providerTradeNo || "").trim() ||
    String(notification?.orderId || "").trim() ||
    String(order?.providerTradeNo || "").trim() ||
    String(order?.id || "").trim()
  );
}

function paymentEventId(provider, order, notification) {
  return (
    String(notification?.transactionId || "").trim() ||
    String(notification?.eventId || "").trim() ||
    providerTradeNoFrom(order, notification) ||
    `${provider}:${order?.id || randomUUID()}`
  );
}

async function upsertRechargePaymentOrder(client, order, providerOverride = null) {
  if (!order?.id) {
    throw new Error("recharge order id is required");
  }

  const accountInput = resolveAccountInput(order);
  const account = await ensureAccountForLegacyOwner(client, accountInput.ownerType, accountInput.ownerId, {
    accountId: accountInput.accountId,
    currency: normalizeCurrency(order),
  });
  const provider = normalizeProvider(providerOverride, order);
  const paymentOrderId = paymentOrderIdForRecharge(order);
  const amountCents = amountToCents(order.amount);
  const creditAmount = Number(order.credits || 0);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error(`recharge order ${order.id} has invalid amount`);
  }

  const result = await client.query(
    `INSERT INTO payment_orders (
       id,
       account_id,
       legacy_recharge_order_id,
       provider,
       merchant_order_no,
       provider_trade_no,
       idempotency_key,
       status,
       amount_cents,
       credit_amount,
       currency,
       expires_at,
       data,
       created_at,
       updated_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,now(),now())
     ON CONFLICT (id) DO UPDATE SET
       provider = excluded.provider,
       provider_trade_no = COALESCE(excluded.provider_trade_no, payment_orders.provider_trade_no),
       status = CASE
         WHEN payment_orders.status = 'paid' THEN payment_orders.status
         ELSE excluded.status
       END,
       amount_cents = excluded.amount_cents,
       credit_amount = excluded.credit_amount,
       currency = excluded.currency,
       expires_at = excluded.expires_at,
       data = payment_orders.data || excluded.data,
       updated_at = now()
     RETURNING *`,
    [
      paymentOrderId,
      account.id,
      String(order.id),
      provider,
      merchantOrderNo(order) || String(order.id),
      order.providerTradeNo || null,
      `recharge-order:${order.id}`,
      order.status === "paid" ? "paid" : "pending",
      amountCents,
      Number.isFinite(creditAmount) ? creditAmount : 0,
      normalizeCurrency(order),
      order.expiresAt || order.expiredAt || null,
      normalizeJson({ legacyOrder: order }),
    ],
  );

  return result.rows[0];
}

async function syncRechargePaymentOrder(pool, order, providerOverride = null) {
  if (!pool) return null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const paymentOrder = await upsertRechargePaymentOrder(client, order, providerOverride);
    await client.query("COMMIT");
    return paymentOrder;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function creditRechargeOrderOnce(pool, { order, provider, notification = {}, rawBody = "" }) {
  if (!pool) return null;
  const normalizedProvider = normalizeProvider(provider, order);
  const eventId = paymentEventId(normalizedProvider, order, notification);
  const rawBodyHash = sha256(rawBody || JSON.stringify(notification?.notifyPayload || notification || {}));
  const providerTradeNo = providerTradeNoFrom(order, notification);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const paymentOrder = await upsertRechargePaymentOrder(client, order, normalizedProvider);
    await lockAccountLane(client, paymentOrder.account_id, "account-finance");

    const callbackInsert = await client.query(
      `INSERT INTO payment_callbacks (
         provider,
         event_id,
         merchant_order_no,
         provider_trade_no,
         signature_valid,
         processing_status,
         raw_body_hash,
         data
       )
       VALUES ($1,$2,$3,$4,true,'received',$5,$6::jsonb)
       ON CONFLICT (provider, event_id) DO NOTHING
       RETURNING *`,
      [
        normalizedProvider,
        eventId,
        paymentOrder.merchant_order_no,
        providerTradeNo,
        rawBodyHash,
        normalizeJson({ notification }),
      ],
    );

    if (!callbackInsert.rows[0]) {
      await client.query("COMMIT");
      return { duplicate: true, paymentOrder };
    }

    const lockedOrder = (
      await client.query("SELECT * FROM payment_orders WHERE id = $1 FOR UPDATE", [paymentOrder.id])
    ).rows[0];
    if (lockedOrder.status === "paid") {
      await client.query(
        `UPDATE payment_callbacks
         SET processing_status = 'replayed', processed_at = now()
         WHERE id = $1`,
        [callbackInsert.rows[0].id],
      );
      await client.query("COMMIT");
      return { duplicate: true, paymentOrder: lockedOrder };
    }

    const balance = (
      await client.query(
        `INSERT INTO wallet_balances (account_id, currency, balance_cents, credit_balance, ledger_version)
         VALUES ($1,$2,0,0,0)
         ON CONFLICT (account_id, currency) DO UPDATE
           SET updated_at = wallet_balances.updated_at
         RETURNING *`,
        [lockedOrder.account_id, lockedOrder.currency],
      )
    ).rows[0];

    await client.query(
      "SELECT * FROM wallet_balances WHERE account_id = $1 AND currency = $2 FOR UPDATE",
      [lockedOrder.account_id, lockedOrder.currency],
    );

    const nextBalanceCents = Number(balance.balance_cents || 0) + Number(lockedOrder.amount_cents || 0);
    const nextCreditBalance =
      Number(balance.credit_balance || 0) + Number(lockedOrder.credit_amount || 0);
    const ledgerIdempotencyKey = `payment:${normalizedProvider}:${providerTradeNo || lockedOrder.id}`;

    const ledgerInsert = await client.query(
      `INSERT INTO wallet_ledger (
         id,
         wallet_id,
         actor_id,
         entry_type,
         amount,
         source_type,
         source_id,
         data,
         created_at,
         updated_at,
         account_id,
         currency,
         amount_cents,
         credit_amount,
         balance_after_cents,
         balance_after_credits,
         payment_order_id,
         idempotency_key
       )
       VALUES ($1,$2,$3,'recharge',$4,'payment_order',$5,$6::jsonb,now(),now(),$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (account_id, idempotency_key) WHERE account_id IS NOT NULL AND idempotency_key IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [
        `ledger_${randomUUID()}`,
        order.walletId || null,
        order.actorId || null,
        Number(lockedOrder.credit_amount || 0),
        String(lockedOrder.id),
        normalizeJson({ order, notification }),
        lockedOrder.account_id,
        lockedOrder.currency,
        Number(lockedOrder.amount_cents || 0),
        Number(lockedOrder.credit_amount || 0),
        nextBalanceCents,
        nextCreditBalance,
        lockedOrder.id,
        ledgerIdempotencyKey,
      ],
    );

    if (ledgerInsert.rows[0]) {
      await client.query(
        `UPDATE wallet_balances
         SET balance_cents = $3,
             credit_balance = $4,
             ledger_version = ledger_version + 1,
             updated_at = now()
         WHERE account_id = $1 AND currency = $2`,
        [lockedOrder.account_id, lockedOrder.currency, nextBalanceCents, nextCreditBalance],
      );
    }

    const paidAt = notification.paidAt || order.paidAt || new Date().toISOString();
    const updatedOrder = (
      await client.query(
        `UPDATE payment_orders
         SET status = 'paid',
             provider_trade_no = COALESCE($2, provider_trade_no),
             paid_at = $3,
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [lockedOrder.id, providerTradeNo || null, paidAt],
      )
    ).rows[0];

    await client.query(
      `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
       VALUES ('payment_order', $1, 'payment.paid', $2::jsonb)`,
      [
        updatedOrder.id,
        normalizeJson({
          accountId: updatedOrder.account_id,
          paymentOrderId: updatedOrder.id,
          legacyRechargeOrderId: updatedOrder.legacy_recharge_order_id,
        }),
      ],
    );

    await client.query(
      `UPDATE payment_callbacks
       SET processing_status = 'processed', processed_at = now()
       WHERE id = $1`,
      [callbackInsert.rows[0].id],
    );

    await client.query("COMMIT");
    return { duplicate: false, paymentOrder: updatedOrder };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  creditRechargeOrderOnce,
  paymentOrderIdForRecharge,
  syncRechargePaymentOrder,
};
