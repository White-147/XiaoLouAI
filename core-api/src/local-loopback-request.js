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

function hostnameIsLoopback(hostname) {
  const h = normalizeHostname(hostname);
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

function headerUrlLoopback(headerValue) {
  if (typeof headerValue !== "string" || !headerValue.trim()) return false;
  try {
    const u = new URL(headerValue);
    return hostnameIsLoopback(u.hostname);
  } catch {
    return false;
  }
}

function originOrRefererIsLoopback(req) {
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  if (Array.isArray(origin) ? headerUrlLoopback(origin[0]) : headerUrlLoopback(origin)) return true;
  if (Array.isArray(referer) ? headerUrlLoopback(referer[0]) : headerUrlLoopback(referer)) return true;
  return false;
}

function hostHeaderIsLoopback(req) {
  const host = req.headers.host;
  if (typeof host !== "string" || !host.trim()) return false;
  const hostname = host.split(":")[0];
  return hostnameIsLoopback(hostname);
}

function isLocalLoopbackClientHint(req) {
  if (!req || !req.headers) return false;
  if (originOrRefererIsLoopback(req)) return true;
  if (hostHeaderIsLoopback(req)) return true;
  return false;
}

module.exports = {
  SUPER_ADMIN_DEMO_ACTOR_ID,
  isLocalLoopbackClientHint,
};
