const { getRequestHintHostname } = require("./local-loopback-request");

function trimTrailingSlash(value) {
  return String(value || "").trim().replace(/\/+$/g, "");
}

function getRequestProtocol(req) {
  const protoHeader = req?.headers?.["x-forwarded-proto"];
  const forwarded = Array.isArray(protoHeader) ? protoHeader[0] : protoHeader;
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }

  for (const headerName of ["origin", "referer"]) {
    const headerValue = req?.headers?.[headerName];
    const candidate = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    try {
      return new URL(candidate).protocol.replace(/:$/, "");
    } catch {
      // Ignore malformed browser headers and fall back below.
    }
  }

  return "http";
}

function resolveHeaderOrigin(req) {
  for (const headerName of ["origin", "referer"]) {
    const headerValue = req?.headers?.[headerName];
    const candidate = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    try {
      return new URL(candidate).origin;
    } catch {
      // Ignore malformed browser headers and continue searching.
    }
  }

  return "";
}

function resolveBaseUrlFromHost(req) {
  const hostname = getRequestHintHostname(req) || "127.0.0.1";
  const hostHeader = req?.headers?.host;
  const port =
    typeof hostHeader === "string" && hostHeader.includes(":")
      ? hostHeader.split(":").slice(1).join(":")
      : "";
  const protocol = getRequestProtocol(req);
  return `${protocol}://${hostname}${port ? `:${port}` : ""}`;
}

function resolveRequestBaseUrl(req) {
  return trimTrailingSlash(resolveHeaderOrigin(req)) || trimTrailingSlash(resolveBaseUrlFromHost(req));
}

module.exports = {
  getRequestProtocol,
  resolveBaseUrlFromHost,
  resolveHeaderOrigin,
  resolveRequestBaseUrl,
  trimTrailingSlash,
};
