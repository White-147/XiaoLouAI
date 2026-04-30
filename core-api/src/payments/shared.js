require("../env").loadEnvFiles();

const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const {
  getRequestHintHostname,
  normalizeHostname,
  requestMatchesAllowedHosts,
} = require("../local-loopback-request");
const {
  resolveHeaderOrigin,
  resolveRequestBaseUrl,
  trimTrailingSlash,
} = require("../request-base-url");

// Public demo deployments need the mock recharge card visible from IP and domain
// visits. Restrict with PAYMENT_MOCK_ALLOWED_HOSTS when real billing is enforced.
const DEFAULT_PAYMENT_MOCK_ALLOWED_HOSTS = ["*"];

function splitCsv(value, fallback = []) {
  const source = String(value || "").trim();
  if (!source) return [...fallback];
  return source
    .split(",")
    .map((item) => normalizeHostname(item))
    .filter(Boolean);
}

function getPaymentMockAllowedHosts() {
  return splitCsv(process.env.PAYMENT_MOCK_ALLOWED_HOSTS, DEFAULT_PAYMENT_MOCK_ALLOWED_HOSTS);
}

function isDemoMockAllowedForRequest(req) {
  return requestMatchesAllowedHosts(req, getPaymentMockAllowedHosts());
}

function resolvePublicBaseUrl(req) {
  return (
    trimTrailingSlash(process.env.PAY_PUBLIC_BASE_URL) ||
    resolveRequestBaseUrl(req) ||
    trimTrailingSlash(process.env.CORE_API_PUBLIC_BASE_URL)
  );
}

function resolveReturnBaseUrl(req) {
  return (
    trimTrailingSlash(process.env.PAY_RETURN_BASE_URL) ||
    trimTrailingSlash(resolveHeaderOrigin(req)) ||
    resolveRequestBaseUrl(req) ||
    trimTrailingSlash(process.env.CORE_API_PUBLIC_BASE_URL)
  );
}

function joinUrl(baseUrl, pathname) {
  const base = trimTrailingSlash(baseUrl);
  const path = String(pathname || "").startsWith("/") ? pathname : `/${pathname || ""}`;
  return `${base}${path}`;
}

function resolveSecretValue(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return "";
  if (value.includes("-----BEGIN")) {
    return value.replace(/\\n/g, "\n");
  }

  const candidates = [
    value,
    resolve(value),
    resolve(__dirname, "..", value),
    resolve(__dirname, "..", "..", value),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, "utf8");
    }
  }

  return value.replace(/\\n/g, "\n");
}

function getClientIp(req) {
  const forwarded = req?.headers?.["x-forwarded-for"];
  const candidate = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const rawIp =
    (typeof candidate === "string" && candidate.split(",")[0].trim()) ||
    req?.socket?.remoteAddress ||
    "127.0.0.1";
  return rawIp.replace(/^::ffff:/, "") || "127.0.0.1";
}

function amountToFen(amount) {
  return Math.max(1, Math.round(Number(amount || 0) * 100));
}

function getBankTransferConfig() {
  const accountName = String(process.env.BANK_TRANSFER_ACCOUNT_NAME || "").trim();
  const bankName = String(process.env.BANK_TRANSFER_BANK_NAME || "").trim();
  const accountNo = String(process.env.BANK_TRANSFER_ACCOUNT_NO || "").trim();
  const branchName = String(process.env.BANK_TRANSFER_BRANCH_NAME || "").trim();
  const remarkTemplate = String(process.env.BANK_TRANSFER_REMARK_TEMPLATE || "").trim();
  const instructions = String(process.env.BANK_TRANSFER_INSTRUCTIONS || "").trim();
  const available = Boolean(accountName && bankName && accountNo);

  return {
    available,
    reason: available ? null : "Missing bank transfer account configuration.",
    account: available
      ? {
          accountName,
          bankName,
          accountNo,
          branchName: branchName || null,
          remarkTemplate: remarkTemplate || null,
          instructions: instructions || null,
        }
      : null,
  };
}

module.exports = {
  amountToFen,
  getBankTransferConfig,
  getClientIp,
  getPaymentMockAllowedHosts,
  getRequestHintHostname,
  isDemoMockAllowedForRequest,
  joinUrl,
  normalizeHostname,
  requestMatchesAllowedHosts,
  resolvePublicBaseUrl,
  resolveReturnBaseUrl,
  resolveSecretValue,
};
