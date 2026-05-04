const { accountIdForLegacyOwner } = require("./canonical-ids");

const ACCOUNT_LANES = new Set([
  "account-finance",
  "account-control",
  "account-media",
]);

function assertAccountLane(lane) {
  const normalized = String(lane || "").trim();
  if (!ACCOUNT_LANES.has(normalized)) {
    const error = new Error(`Unsupported account lane: ${normalized || "(empty)"}`);
    error.statusCode = 400;
    error.code = "BAD_ACCOUNT_LANE";
    throw error;
  }
  return normalized;
}

function normalizeAccountType(ownerType) {
  const normalized = String(ownerType || "user").trim().toLowerCase();
  return normalized === "organization" ? "organization" : normalized === "system" ? "system" : "user";
}

async function ensureAccountForLegacyOwner(client, ownerType, ownerId, options = {}) {
  const normalizedOwnerType = normalizeAccountType(ownerType);
  const normalizedOwnerId = String(ownerId || "guest").trim() || "guest";
  const accountId =
    options.accountId || accountIdForLegacyOwner(normalizedOwnerType, normalizedOwnerId);

  const result = await client.query(
    `INSERT INTO accounts (
       id,
       account_type,
       legacy_owner_type,
       legacy_owner_id,
       region_code,
       default_currency,
       data,
       created_at,
       updated_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,now(),now())
     ON CONFLICT (id) DO UPDATE SET
       legacy_owner_type = COALESCE(accounts.legacy_owner_type, excluded.legacy_owner_type),
       legacy_owner_id = COALESCE(accounts.legacy_owner_id, excluded.legacy_owner_id),
       region_code = COALESCE(NULLIF(excluded.region_code, ''), accounts.region_code),
       default_currency = COALESCE(NULLIF(excluded.default_currency, ''), accounts.default_currency),
       updated_at = now()
     RETURNING *`,
    [
      accountId,
      normalizedOwnerType,
      normalizedOwnerType,
      normalizedOwnerId,
      options.regionCode || "CN",
      options.currency || "CNY",
      JSON.stringify(options.data || {}),
    ],
  );

  return result.rows[0];
}

async function lockAccountLane(client, accountId, lane) {
  const normalizedLane = assertAccountLane(lane);
  await client.query("SELECT xiaolou_lock_account_lane($1, $2)", [accountId, normalizedLane]);
}

async function withAccountLane(pool, { ownerType, ownerId, accountId, lane, accountOptions }, callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const account =
      accountId && !ownerId
        ? { id: accountId }
        : await ensureAccountForLegacyOwner(client, ownerType, ownerId, {
            ...(accountOptions || {}),
            accountId,
          });
    await lockAccountLane(client, account.id, lane);
    const result = await callback(client, account);
    await client.query("COMMIT");
    return result;
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
  ACCOUNT_LANES,
  assertAccountLane,
  ensureAccountForLegacyOwner,
  lockAccountLane,
  withAccountLane,
};
