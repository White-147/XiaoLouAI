const { randomUUID } = require("node:crypto");

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const DEFAULT_FRONTEND_ORIGIN = "http://localhost:3001";
const SESSION_TTL_MS = 10 * 60 * 1000;
const EXCHANGE_TTL_MS = 2 * 60 * 1000;

const oauthSessions = new Map();
const loginExchanges = new Map();

function apiError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function isConfigured() {
  return Boolean(
    String(process.env.GOOGLE_OAUTH_CLIENT_ID || "").trim() &&
      String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || "").trim(),
  );
}

function normalizeOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return DEFAULT_FRONTEND_ORIGIN;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return DEFAULT_FRONTEND_ORIGIN;
    }
    return url.origin;
  } catch {
    return DEFAULT_FRONTEND_ORIGIN;
  }
}

function normalizeReturnTo(value) {
  const raw = String(value || "").trim();
  if (!raw) return "/home";
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  try {
    const url = new URL(raw);
    return `${url.pathname || "/home"}${url.search || ""}${url.hash || ""}`;
  } catch {
    return "/home";
  }
}

function getRedirectUri(frontendOrigin) {
  const configured = String(process.env.GOOGLE_OAUTH_REDIRECT_URI || "").trim();
  if (configured) return configured;
  return `${normalizeOrigin(frontendOrigin)}/api/auth/google/callback`;
}

function pruneExpired(map, now = Date.now()) {
  for (const [key, value] of map.entries()) {
    if (!value?.expiresAt || value.expiresAt <= now) {
      map.delete(key);
    }
  }
}

function createGoogleAuthorizationUrl({ returnTo, frontendOrigin } = {}) {
  if (!isConfigured()) {
    throw apiError(503, "GOOGLE_AUTH_NOT_CONFIGURED", "Google login is not configured.");
  }

  pruneExpired(oauthSessions);

  const state = randomUUID();
  const normalizedFrontendOrigin = normalizeOrigin(frontendOrigin);
  const normalizedReturnTo = normalizeReturnTo(returnTo);
  const redirectUri = getRedirectUri(normalizedFrontendOrigin);

  oauthSessions.set(state, {
    returnTo: normalizedReturnTo,
    frontendOrigin: normalizedFrontendOrigin,
    redirectUri,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });

  const params = new URLSearchParams({
    client_id: String(process.env.GOOGLE_OAUTH_CLIENT_ID || "").trim(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

function appendQuery(target, params) {
  const url = new URL(target);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function buildFrontendRedirect(session, params) {
  const frontendOrigin = normalizeOrigin(session?.frontendOrigin);
  const returnTo = normalizeReturnTo(session?.returnTo);
  return appendQuery(`${frontendOrigin}${returnTo}`, params);
}

function buildFallbackRedirect(params) {
  const frontendOrigin = normalizeOrigin(process.env.XIAOLOU_FRONTEND_ORIGIN);
  return appendQuery(`${frontendOrigin}/home`, params);
}

function consumeOAuthSession(state) {
  pruneExpired(oauthSessions);
  const session = oauthSessions.get(state);
  if (!session) {
    throw apiError(400, "INVALID_OAUTH_STATE", "Google login state is invalid or expired.");
  }
  oauthSessions.delete(state);
  return session;
}

async function exchangeCodeForTokens({ code, redirectUri }) {
  const body = new URLSearchParams({
    code,
    client_id: String(process.env.GOOGLE_OAUTH_CLIENT_ID || "").trim(),
    client_secret: String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || "").trim(),
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw apiError(
      502,
      "GOOGLE_TOKEN_EXCHANGE_FAILED",
      payload.error_description || payload.error || "Google token exchange failed.",
    );
  }

  return payload;
}

async function fetchGoogleUserInfo(accessToken) {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw apiError(502, "GOOGLE_USERINFO_FAILED", "Unable to read Google user profile.");
  }

  return payload;
}

async function completeGoogleCallback(callbackUrl) {
  const state = callbackUrl.searchParams.get("state");
  const code = callbackUrl.searchParams.get("code");
  const oauthError = callbackUrl.searchParams.get("error");

  if (!state) {
    throw apiError(400, "MISSING_OAUTH_STATE", "Missing Google login state.");
  }

  const session = consumeOAuthSession(state);

  if (oauthError) {
    const description = callbackUrl.searchParams.get("error_description") || oauthError;
    throw Object.assign(apiError(400, "GOOGLE_AUTH_CANCELLED", description), { session });
  }

  if (!code) {
    throw Object.assign(apiError(400, "MISSING_AUTH_CODE", "Missing Google authorization code."), { session });
  }

  let tokens;
  let profile;
  try {
    tokens = await exchangeCodeForTokens({ code, redirectUri: session.redirectUri });
    profile = await fetchGoogleUserInfo(tokens.access_token);
  } catch (error) {
    error.session = session;
    throw error;
  }

  return { session, profile };
}

function createGoogleLoginExchange(loginResult) {
  pruneExpired(loginExchanges);

  const code = randomUUID();
  loginExchanges.set(code, {
    loginResult,
    expiresAt: Date.now() + EXCHANGE_TTL_MS,
  });
  return code;
}

function consumeGoogleLoginExchange(code) {
  pruneExpired(loginExchanges);

  const normalizedCode = String(code || "").trim();
  const record = loginExchanges.get(normalizedCode);
  if (!record) {
    throw apiError(400, "INVALID_GOOGLE_LOGIN_CODE", "Google login code is invalid or expired.");
  }
  loginExchanges.delete(normalizedCode);
  return record.loginResult;
}

module.exports = {
  buildFallbackRedirect,
  buildFrontendRedirect,
  completeGoogleCallback,
  consumeGoogleLoginExchange,
  createGoogleAuthorizationUrl,
  createGoogleLoginExchange,
  isGoogleAuthConfigured: isConfigured,
};
