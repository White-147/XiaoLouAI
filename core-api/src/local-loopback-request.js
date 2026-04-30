/**
 * Detects whether an HTTP request likely comes from a browser session on
 * loopback (127.0.0.1 / localhost / ::1). Used to gate demo-only
 * super-admin actor id — must not be honored from public deployments.
 *
 * Heuristic: Origin / Referer hostname, then Host header (direct curl to core-api).
 */

const SUPER_ADMIN_DEMO_ACTOR_ID = "root_demo_001";

function normalizeHostname(hostname) {
  if (!hostname) return "";
  return String(hostname)
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
}

function parseHeaderHostname(headerValue) {
  if (typeof headerValue !== "string" || !headerValue.trim()) return "";
  try {
    const parsed = new URL(headerValue);
    return normalizeHostname(parsed.hostname);
  } catch {
    return "";
  }
}

function hostnameIsLoopback(hostname) {
  const h = normalizeHostname(hostname);
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

function headerUrlLoopback(headerValue) {
  return hostnameIsLoopback(parseHeaderHostname(headerValue));
}

function originOrRefererIsLoopback(req) {
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  if (Array.isArray(origin) ? headerUrlLoopback(origin[0]) : headerUrlLoopback(origin)) return true;
  if (Array.isArray(referer) ? headerUrlLoopback(referer[0]) : headerUrlLoopback(referer)) return true;
  return false;
}

function hostHeaderIsLoopback(req) {
  return hostnameIsLoopback(getRequestHintHostname(req));
}

function getRequestHintHostname(req) {
  if (!req || !req.headers) return "";

  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const hostCandidates = [
    Array.isArray(origin) ? origin[0] : origin,
    Array.isArray(referer) ? referer[0] : referer,
  ]
    .map(parseHeaderHostname)
    .filter(Boolean);

  if (hostCandidates.length > 0) {
    return hostCandidates[0];
  }

  const host = req.headers.host;
  if (typeof host !== "string" || !host.trim()) return "";
  return normalizeHostname(host.split(":")[0]);
}

function requestMatchesAllowedHosts(req, allowedHosts) {
  const normalizedHosts = Array.isArray(allowedHosts)
    ? allowedHosts.map(normalizeHostname).filter(Boolean)
    : [];

  if (normalizedHosts.includes("*")) return true;

  const hostname = getRequestHintHostname(req);
  if (!hostname) return false;

  return normalizedHosts.includes(hostname);
}

function isLocalLoopbackClientHint(req) {
  if (!req || !req.headers) return false;

  // If the browser sent an Origin or Referer header, trust it as the primary
  // signal. When traffic flows through a reverse proxy and Vite
  // (changeOrigin:true) to core-api, Vite rewrites the Host header to
  // "127.0.0.1:4100" but keeps the browser's original Origin/Referer.
  // Relying on Host alone would falsely grant super-admin to external users.
  const origin  = req.headers.origin;
  const referer = req.headers.referer;
  const hasOrigin  = typeof origin  === "string" ? !!origin.trim()  : (Array.isArray(origin)  && origin.length  > 0);
  const hasReferer = typeof referer === "string" ? !!referer.trim() : (Array.isArray(referer) && referer.length > 0);

  if (hasOrigin || hasReferer) {
    // At least one browser-sourced hint present — only allow loopback if it
    // actually points to localhost.
    return originOrRefererIsLoopback(req);
  }

  // No Origin/Referer (e.g. direct curl to core-api port) — fall back to Host.
  return hostHeaderIsLoopback(req);
}

module.exports = {
  SUPER_ADMIN_DEMO_ACTOR_ID,
  isLocalLoopbackClientHint,
  getRequestHintHostname,
  normalizeHostname,
  requestMatchesAllowedHosts,
};
