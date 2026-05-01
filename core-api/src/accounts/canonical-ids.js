const { createHash } = require("node:crypto");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeText(value, fallback = "unknown") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function stableUuid(namespace, value) {
  const normalized = normalizeText(value);
  if (UUID_RE.test(normalized)) return normalized.toLowerCase();

  const hash = createHash("md5")
    .update(`xiaolou:${namespace}:${normalized}`)
    .digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join("-");
}

function accountIdForLegacyOwner(ownerType, ownerId) {
  const normalizedOwnerType = normalizeText(ownerType, "user").toLowerCase();
  const normalizedOwnerId = normalizeText(ownerId, "guest");
  return stableUuid("account", `${normalizedOwnerType}:${normalizedOwnerId}`);
}

function accountIdForActor(actorId) {
  return accountIdForLegacyOwner("user", actorId);
}

function amountToCents(amount) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100);
}

module.exports = {
  accountIdForActor,
  accountIdForLegacyOwner,
  amountToCents,
  stableUuid,
};
