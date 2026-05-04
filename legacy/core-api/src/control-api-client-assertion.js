const { createHmac, randomUUID } = require("node:crypto");

const DEFAULT_PERMISSIONS = Object.freeze([
  "accounts:ensure",
  "jobs:create",
  "jobs:read",
  "jobs:cancel",
  "wallet:read",
  "media:read",
  "media:write",
  "projects:read",
  "projects:write",
  "canvas:read",
  "canvas:write",
  "create:read",
  "create:write",
  "identity:read",
  "identity:write",
  "organization:read",
  "organization:write",
  "api-center:read",
  "api-center:write",
  "admin:read",
  "admin:write",
  "enterprise-applications:read",
  "enterprise-applications:write",
  "playground:read",
  "playground:write",
  "toolbox:read",
  "toolbox:write",
]);

const DEFAULT_TTL_SECONDS = 60 * 60;

function readSetting(settings, ...names) {
  for (const name of names) {
    const value = settings?.[name];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function readPositiveInteger(settings, names, fallback) {
  const raw = readSetting(settings, ...names);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeGrantList(value) {
  const grants = Array.isArray(value) ? value : String(value || "").split(/[,\s;]+/);
  return Array.from(
    new Set(
      grants
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  );
}

function base64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlJson(value) {
  return base64Url(JSON.stringify(value));
}

function signHs256(input, secret) {
  return createHmac("sha256", secret)
    .update(input)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function collectOwnerGrants(permissionContext = {}) {
  const grants = new Set();
  const actorId = permissionContext.actor?.id || permissionContext.actorId;
  if (actorId) {
    grants.add(actorId);
    grants.add(`user:${actorId}`);
  }

  const organizations = Array.isArray(permissionContext.organizations)
    ? permissionContext.organizations
    : [];
  for (const organization of organizations) {
    if (!organization?.id || organization.status === "disabled") continue;
    grants.add(organization.id);
    grants.add(`organization:${organization.id}`);
  }

  const currentOrganizationId = permissionContext.currentOrganizationId;
  if (currentOrganizationId) {
    grants.add(currentOrganizationId);
    grants.add(`organization:${currentOrganizationId}`);
  }

  return Array.from(grants);
}

function buildControlApiAssertionClaims(permissionContext = {}, settings = process.env, options = {}) {
  const now = Number.isFinite(options.nowSeconds)
    ? Math.floor(options.nowSeconds)
    : Math.floor(Date.now() / 1000);
  const ttlSeconds = readPositiveInteger(
    settings,
    ["CLIENT_API_AUTH_PROVIDER_TTL_SECONDS", "CONTROL_API_CLIENT_ASSERTION_TTL_SECONDS"],
    DEFAULT_TTL_SECONDS,
  );
  const issuer = readSetting(
    settings,
    "CLIENT_API_AUTH_PROVIDER_ISSUER",
    "CONTROL_API_CLIENT_ASSERTION_ISSUER",
  );
  const audience = readSetting(
    settings,
    "CLIENT_API_AUTH_PROVIDER_AUDIENCE",
    "CONTROL_API_CLIENT_ASSERTION_AUDIENCE",
  );
  const permissions = normalizeGrantList(
    readSetting(settings, "CLIENT_API_ALLOWED_PERMISSIONS", "CONTROL_API_CLIENT_ASSERTION_PERMISSIONS")
      || DEFAULT_PERMISSIONS,
  );
  const actorId = permissionContext.actor?.id || permissionContext.actorId || null;
  const claims = {
    sub: actorId,
    iat: now,
    nbf: now - 30,
    exp: now + ttlSeconds,
    jti: randomUUID(),
    xiaolou_account_owner_type: "user",
    xiaolou_account_owner_ids: collectOwnerGrants(permissionContext),
    xiaolou_permissions: permissions,
  };

  if (issuer) claims.iss = issuer;
  if (audience) claims.aud = audience;
  if (permissionContext.currentOrganizationId) {
    claims.xiaolou_current_organization_id = permissionContext.currentOrganizationId;
  }

  return claims;
}

function createControlApiClientAssertion(permissionContext = {}, settings = process.env, options = {}) {
  const secret = readSetting(
    settings,
    "CLIENT_API_AUTH_PROVIDER_SECRET",
    "CONTROL_API_CLIENT_ASSERTION_SECRET",
  );
  if (!secret) return null;

  const header = {
    alg: "HS256",
    typ: "JWT",
  };
  const claims = buildControlApiAssertionClaims(permissionContext, settings, options);
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(claims)}`;
  return `${signingInput}.${signHs256(signingInput, secret)}`;
}

module.exports = {
  buildControlApiAssertionClaims,
  collectOwnerGrants,
  createControlApiClientAssertion,
};
