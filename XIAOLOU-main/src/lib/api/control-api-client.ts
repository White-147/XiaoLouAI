import {
  getAuthToken,
  getControlApiClientAssertion,
  getCurrentActorId,
  isLocalDemoActorId,
  rememberKnownActor,
  setAuthToken,
  setControlApiClientAssertion,
} from "../actor-session";
import {
  isControlApiClientPath,
  normalizeRoutePath,
  shouldBlockLegacyMutatingRequest,
} from "./route-policy";

export const API_BASE_URL =
  import.meta.env.VITE_CORE_API_BASE_URL ?? "";

type ApiEnvelope<T> = {
  success: boolean;
  data: T;
  error?: {
    code: string;
    message: string;
  };
};

type SessionRefreshResponse = {
  actorId?: string | null;
  token?: string | null;
  controlApiClientAssertion?: string | null;
  displayName?: string | null;
  email?: string | null;
};

const SESSION_REFRESH_PATH = "/api/auth/session/refresh";
const DEMO_SESSION_PATH = "/api/auth/demo-session";
const SESSION_REPAIR_STATUS_CODES = new Set([401, 403]);
const SESSION_REPAIR_EXCLUDED_PATHS = new Set([
  SESSION_REFRESH_PATH,
  "/api/auth/providers",
  "/api/auth/google/exchange",
  "/api/auth/login",
  "/api/auth/admin/login",
  "/api/auth/password/bootstrap-admin",
  "/api/auth/password/reset/request",
  "/api/auth/password/reset/complete",
  DEMO_SESSION_PATH,
  "/api/auth/register/personal",
  "/api/auth/register/enterprise-admin",
  "/api/me",
]);
let sessionRefreshPromise: Promise<boolean> | null = null;
let demoSessionPromise: Promise<boolean> | null = null;

export class ApiRequestError extends Error {
  code: string;
  status: number;

  constructor(message: string, options?: { code?: string; status?: number }) {
    super(message);
    this.name = "ApiRequestError";
    this.code = options?.code || "API_REQUEST_FAILED";
    this.status = options?.status || 500;
  }
}

export function assertNoLegacyMutatingRequest(path: string, init?: RequestInit) {
  if (!shouldBlockLegacyMutatingRequest(path, init)) {
    return;
  }

  throw new ApiRequestError(
    "Legacy mutating API routes are disabled in the Windows-native runtime. Use the .NET Control API or retire this flow.",
    {
      code: "LEGACY_WRITE_DISABLED",
      status: 410,
    },
  );
}

function buildRequestHeaders(path: string, init?: RequestInit, options: { allowBodyContentType?: boolean } = {}) {
  const actorId = getCurrentActorId();
  const token = getAuthToken();
  const controlApiClientAssertion = getControlApiClientAssertion();
  const headers = new Headers(init?.headers);
  if (options.allowBodyContentType && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("X-Actor-Id", actorId);
  if (controlApiClientAssertion && isControlApiClientPath(path)) {
    headers.set("Authorization", `Bearer ${controlApiClientAssertion}`);
  } else if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

function shouldAttemptSessionRepair(path: string) {
  const normalizedPath = normalizeRoutePath(path);
  return (
    isControlApiClientPath(path) &&
    !SESSION_REPAIR_EXCLUDED_PATHS.has(normalizedPath)
  );
}

function shouldRetryAfterSessionRepair(path: string, status: number) {
  return shouldAttemptSessionRepair(path) && SESSION_REPAIR_STATUS_CODES.has(status);
}

async function refreshControlApiSessionAssertion() {
  const token = getAuthToken();
  if (!token) {
    return false;
  }

  if (sessionRefreshPromise) {
    return sessionRefreshPromise;
  }

  sessionRefreshPromise = (async () => {
    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    headers.set("X-Actor-Id", getCurrentActorId());
    headers.set("Authorization", `Bearer ${token}`);

    try {
      const response = await fetch(`${API_BASE_URL}${SESSION_REFRESH_PATH}`, {
        method: "POST",
        headers,
        body: "{}",
      });
      if (!response.ok) {
        return false;
      }

      const text = await response.text();
      if (!text) {
        return false;
      }

      const payload = JSON.parse(text) as SessionRefreshResponse;
      if (!payload?.controlApiClientAssertion) {
        return false;
      }

      if (payload.token) {
        setAuthToken(payload.token);
      }
      setControlApiClientAssertion(payload.controlApiClientAssertion);
      return true;
    } catch {
      return false;
    }
  })();

  try {
    return await sessionRefreshPromise;
  } finally {
    sessionRefreshPromise = null;
  }
}

async function createLocalDemoSessionAssertion() {
  const actorId = getCurrentActorId();
  if (!isLocalDemoActorId(actorId)) {
    return false;
  }

  if (demoSessionPromise) {
    return demoSessionPromise;
  }

  demoSessionPromise = (async () => {
    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    headers.set("X-Actor-Id", actorId);

    try {
      const response = await fetch(`${API_BASE_URL}${DEMO_SESSION_PATH}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ actorId }),
      });
      if (!response.ok) {
        return false;
      }

      const text = await response.text();
      if (!text) {
        return false;
      }

      const payload = JSON.parse(text) as SessionRefreshResponse;
      if (!payload?.controlApiClientAssertion) {
        return false;
      }

      if (payload.token) {
        setAuthToken(payload.token);
      }
      setControlApiClientAssertion(payload.controlApiClientAssertion);
      rememberKnownActor({
        id: payload.actorId || actorId,
        label: payload.displayName || payload.actorId || actorId,
        detail: payload.email || "",
        token: payload.token ?? null,
        controlApiClientAssertion: payload.controlApiClientAssertion,
      });
      return true;
    } catch {
      return false;
    }
  })();

  try {
    return await demoSessionPromise;
  } finally {
    demoSessionPromise = null;
  }
}

async function repairControlApiSessionAssertion(path: string) {
  if (!shouldAttemptSessionRepair(path)) {
    return false;
  }

  return getAuthToken()
    ? refreshControlApiSessionAssertion()
    : createLocalDemoSessionAssertion();
}

async function repairMissingSessionAssertion(path: string) {
  if (!shouldAttemptSessionRepair(path) || getControlApiClientAssertion()) {
    return false;
  }

  return repairControlApiSessionAssertion(path);
}

function sendRequest(path: string, init?: RequestInit, options: { allowBodyContentType?: boolean } = {}) {
  const headers = buildRequestHeaders(path, init, options);
  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  assertNoLegacyMutatingRequest(path, init);

  const repairedBeforeRequest = await repairMissingSessionAssertion(path);
  let response = await sendRequest(path, init, { allowBodyContentType: true });
  if (
    !repairedBeforeRequest &&
    shouldRetryAfterSessionRepair(path, response.status) &&
    (await repairControlApiSessionAssertion(path))
  ) {
    response = await sendRequest(path, init, { allowBodyContentType: true });
  }

  const responseText = await response.text();
  let payload: ApiEnvelope<T> | null = null;

  if (responseText) {
    try {
      payload = JSON.parse(responseText) as ApiEnvelope<T>;
    } catch {
      throw new ApiRequestError(
        response.ok
          ? "接口返回格式无效"
          : `接口请求失败（${response.status || "NETWORK"}）`,
        {
          code: "INVALID_API_RESPONSE",
          status: response.status || 500,
        },
      );
    }
  }

  if (!payload) {
    throw new ApiRequestError(
      response.ok
        ? "接口返回为空"
        : `接口请求失败（${response.status || "NETWORK"}）`,
      {
        code: "EMPTY_API_RESPONSE",
        status: response.status || 500,
      },
    );
  }

  if (!response.ok || !payload.success) {
    throw new ApiRequestError(payload.error?.message ?? "接口请求失败", {
      code: payload.error?.code,
      status: response.status,
    });
  }

  return payload.data;
}

export async function controlApiJsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  assertNoLegacyMutatingRequest(path, init);

  const isFormDataBody = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const requestOptions = {
    allowBodyContentType: Boolean(init?.body && !isFormDataBody),
  };
  const repairedBeforeRequest = await repairMissingSessionAssertion(path);
  let response = await sendRequest(path, init, requestOptions);
  if (
    !repairedBeforeRequest &&
    shouldRetryAfterSessionRepair(path, response.status) &&
    (await repairControlApiSessionAssertion(path))
  ) {
    response = await sendRequest(path, init, requestOptions);
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ApiRequestError("Control API returned an invalid JSON response", {
        code: "CONTROL_API_INVALID_RESPONSE",
        status: response.status || 500,
      });
    }
  }

  if (!response.ok) {
    const errorPayload = payload as {
      error?: string | { message?: string; code?: string };
      title?: string;
      detail?: string;
    } | null;
    const rawError = errorPayload?.error;
    const errorMessage =
      typeof rawError === "string"
        ? rawError
        : rawError?.message;
    const errorCode =
      typeof rawError === "object" && rawError !== null
        ? rawError.code
        : undefined;
    throw new ApiRequestError(
      errorMessage || errorPayload?.detail || errorPayload?.title || "Control API request failed",
      {
        code: errorCode,
        status: response.status,
      },
    );
  }

  return payload as T;
}

export async function controlApiStreamRequest(path: string, init?: RequestInit): Promise<Response> {
  assertNoLegacyMutatingRequest(path, init);

  const isFormDataBody = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const requestOptions = {
    allowBodyContentType: Boolean(init?.body && !isFormDataBody),
  };

  const sendStreamRequest = () => {
    const headers = buildRequestHeaders(path, init, requestOptions);
    if (!headers.has("Accept")) {
      headers.set("Accept", "text/event-stream");
    }

    return fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
    });
  };

  const repairedBeforeRequest = await repairMissingSessionAssertion(path);
  let response = await sendStreamRequest();
  if (
    !repairedBeforeRequest &&
    shouldRetryAfterSessionRepair(path, response.status) &&
    (await repairControlApiSessionAssertion(path))
  ) {
    response = await sendStreamRequest();
  }

  return response;
}
