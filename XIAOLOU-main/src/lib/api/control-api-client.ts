import {
  getAuthToken,
  getControlApiClientAssertion,
  getCurrentActorId,
} from "../actor-session";
import {
  isControlApiClientPath,
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

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  assertNoLegacyMutatingRequest(path, init);

  const headers = buildRequestHeaders(path, init, { allowBodyContentType: true });
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

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
  const headers = buildRequestHeaders(path, init, {
    allowBodyContentType: Boolean(init?.body && !isFormDataBody),
  });

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

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
    const errorPayload = payload as { error?: { message?: string; code?: string }; title?: string; detail?: string } | null;
    throw new ApiRequestError(
      errorPayload?.error?.message || errorPayload?.detail || errorPayload?.title || "Control API request failed",
      {
        code: errorPayload?.error?.code,
        status: response.status,
      },
    );
  }

  return payload as T;
}
