import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessionState = vi.hoisted(() => ({
  actorId: "synthetic-actor",
  clientAssertion: null as string | null,
  token: null as string | null,
}));

vi.mock("../../actor-session", () => ({
  getAuthToken: () => sessionState.token,
  getControlApiClientAssertion: () => sessionState.clientAssertion,
  getCurrentActorId: () => sessionState.actorId,
  setAuthToken: (token: string | null) => {
    sessionState.token = token;
  },
  setControlApiClientAssertion: (assertion: string | null | undefined) => {
    sessionState.clientAssertion = assertion ?? null;
  },
}));

import {
  ApiRequestError,
  assertNoLegacyMutatingRequest,
  controlApiJsonRequest,
  controlApiStreamRequest,
  request,
} from "../control-api-client";

function createResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as Response;
}

function getLastRequest(fetchMock: ReturnType<typeof vi.fn>) {
  return getRequestAt(fetchMock, -1);
}

function getRequestAt(fetchMock: ReturnType<typeof vi.fn>, index: number) {
  const [url, init] = fetchMock.mock.calls.at(index) ?? [];
  return {
    headers: (init as RequestInit | undefined)?.headers as Headers,
    init: init as RequestInit,
    url,
  };
}

describe("control-api-client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionState.actorId = "synthetic-actor";
    sessionState.clientAssertion = null;
    sessionState.token = null;
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the client assertion for allowlisted Control API paths", async () => {
    sessionState.token = "synthetic-user-token";
    sessionState.clientAssertion = "synthetic-client-assertion";
    fetchMock.mockResolvedValueOnce(createResponse(JSON.stringify({ ok: true })));

    await expect(
      controlApiJsonRequest("/api/jobs", {
        method: "POST",
        body: JSON.stringify({ synthetic: true }),
      }),
    ).resolves.toEqual({ ok: true });

    const requestInfo = getLastRequest(fetchMock);
    expect(requestInfo.url).toBe("/api/jobs");
    expect(requestInfo.headers.get("X-Actor-Id")).toBe("synthetic-actor");
    expect(requestInfo.headers.get("Authorization")).toBe("Bearer synthetic-client-assertion");
    expect(requestInfo.headers.get("Content-Type")).toBe("application/json");
  });

  it("refreshes a missing client assertion before a Control API request", async () => {
    sessionState.token = "synthetic-user-token";
    fetchMock
      .mockResolvedValueOnce(createResponse(JSON.stringify({
        actorId: "synthetic-actor",
        token: "refreshed-user-token",
        controlApiClientAssertion: "refreshed-client-assertion",
      })))
      .mockResolvedValueOnce(createResponse(JSON.stringify({ capabilities: [] })));

    await expect(controlApiJsonRequest("/api/toolbox/capabilities")).resolves.toEqual({ capabilities: [] });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const refreshRequest = getRequestAt(fetchMock, 0);
    expect(refreshRequest.url).toBe("/api/auth/session/refresh");
    expect(refreshRequest.init.method).toBe("POST");
    expect(refreshRequest.headers.get("X-Actor-Id")).toBe("synthetic-actor");
    expect(refreshRequest.headers.get("Authorization")).toBe("Bearer synthetic-user-token");
    expect(refreshRequest.headers.get("Content-Type")).toBe("application/json");

    const retriedRequest = getRequestAt(fetchMock, 1);
    expect(retriedRequest.url).toBe("/api/toolbox/capabilities");
    expect(retriedRequest.headers.get("Authorization")).toBe("Bearer refreshed-client-assertion");
    expect(sessionState.token).toBe("refreshed-user-token");
    expect(sessionState.clientAssertion).toBe("refreshed-client-assertion");
  });

  it("repairs protected password auth requests without repairing anonymous auth routes", async () => {
    sessionState.token = "synthetic-user-token";
    fetchMock
      .mockResolvedValueOnce(createResponse(JSON.stringify({
        actorId: "synthetic-actor",
        token: "refreshed-user-token",
        controlApiClientAssertion: "refreshed-client-assertion",
      })))
      .mockResolvedValueOnce(createResponse(JSON.stringify({ passwordConfigured: true })))
      .mockResolvedValueOnce(createResponse(JSON.stringify({ accepted: true })));

    await expect(
      controlApiJsonRequest("/api/auth/password/change", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: "old-password",
          newPassword: "new-password",
        }),
      }),
    ).resolves.toEqual({ passwordConfigured: true });
    await expect(
      controlApiJsonRequest("/api/auth/password/reset/request", {
        method: "POST",
        body: JSON.stringify({ email: "synthetic@example.test" }),
      }),
    ).resolves.toEqual({ accepted: true });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(getRequestAt(fetchMock, 0).url).toBe("/api/auth/session/refresh");
    expect(getRequestAt(fetchMock, 1).url).toBe("/api/auth/password/change");
    expect(getRequestAt(fetchMock, 1).headers.get("Authorization")).toBe("Bearer refreshed-client-assertion");
    expect(getRequestAt(fetchMock, 2).url).toBe("/api/auth/password/reset/request");
  });

  it("refreshes a stale client assertion and retries once on auth failure", async () => {
    sessionState.token = "synthetic-user-token";
    sessionState.clientAssertion = "stale-client-assertion";
    fetchMock
      .mockResolvedValueOnce(createResponse(JSON.stringify({ error: "expired assertion" }), 401))
      .mockResolvedValueOnce(createResponse(JSON.stringify({
        actorId: "synthetic-actor",
        token: "refreshed-user-token",
        controlApiClientAssertion: "refreshed-client-assertion",
      })))
      .mockResolvedValueOnce(createResponse(JSON.stringify({ models: [] })));

    await expect(controlApiJsonRequest("/api/playground/models")).resolves.toEqual({ models: [] });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(getRequestAt(fetchMock, 0).url).toBe("/api/playground/models");
    expect(getRequestAt(fetchMock, 0).headers.get("Authorization")).toBe("Bearer stale-client-assertion");
    expect(getRequestAt(fetchMock, 1).url).toBe("/api/auth/session/refresh");
    expect(getRequestAt(fetchMock, 1).headers.get("Authorization")).toBe("Bearer synthetic-user-token");
    expect(getRequestAt(fetchMock, 2).url).toBe("/api/playground/models");
    expect(getRequestAt(fetchMock, 2).headers.get("Authorization")).toBe("Bearer refreshed-client-assertion");
  });

  it("falls back to the session token outside the Control API client allowlist", async () => {
    sessionState.token = "synthetic-user-token";
    sessionState.clientAssertion = "synthetic-client-assertion";
    fetchMock.mockResolvedValueOnce(createResponse(JSON.stringify({ ok: true })));

    await expect(controlApiJsonRequest("/api/legacy-read")).resolves.toEqual({ ok: true });

    const requestInfo = getLastRequest(fetchMock);
    expect(requestInfo.headers.get("Authorization")).toBe("Bearer synthetic-user-token");
    expect(requestInfo.headers.get("X-Actor-Id")).toBe("synthetic-actor");
  });

  it("does not override FormData Content-Type for Control API JSON requests", async () => {
    sessionState.clientAssertion = "synthetic-client-assertion";
    const formData = new FormData();
    formData.append("file", new Blob(["synthetic"]), "synthetic.txt");
    fetchMock.mockResolvedValueOnce(createResponse(JSON.stringify({ uploaded: true })));

    await expect(
      controlApiJsonRequest("/api/media/upload-begin", {
        method: "POST",
        body: formData,
      }),
    ).resolves.toEqual({ uploaded: true });

    const requestInfo = getLastRequest(fetchMock);
    expect(requestInfo.headers.has("Content-Type")).toBe(false);
  });

  it("uses the shared Control API auth headers for stream requests", async () => {
    sessionState.token = "synthetic-user-token";
    sessionState.clientAssertion = "synthetic-client-assertion";
    const response = createResponse("");
    fetchMock.mockResolvedValueOnce(response);

    await expect(
      controlApiStreamRequest("/api/playground/chat", {
        method: "POST",
        body: JSON.stringify({ synthetic: true }),
      }),
    ).resolves.toBe(response);

    const requestInfo = getLastRequest(fetchMock);
    expect(requestInfo.url).toBe("/api/playground/chat");
    expect(requestInfo.headers.get("X-Actor-Id")).toBe("synthetic-actor");
    expect(requestInfo.headers.get("Authorization")).toBe("Bearer synthetic-client-assertion");
    expect(requestInfo.headers.get("Content-Type")).toBe("application/json");
    expect(requestInfo.headers.get("Accept")).toBe("text/event-stream");
  });

  it("preserves the envelope request helper behavior", async () => {
    sessionState.token = "synthetic-user-token";
    fetchMock.mockResolvedValueOnce(
      createResponse(JSON.stringify({ success: true, data: { value: "synthetic" } })),
    );

    await expect(request("/api/legacy-read")).resolves.toEqual({ value: "synthetic" });

    const requestInfo = getLastRequest(fetchMock);
    expect(requestInfo.headers.get("Content-Type")).toBe("application/json");
    expect(requestInfo.headers.get("Authorization")).toBe("Bearer synthetic-user-token");
  });

  it("maps invalid and non-OK Control API responses to ApiRequestError", async () => {
    fetchMock.mockResolvedValueOnce(createResponse("not-json", 200));

    await expect(controlApiJsonRequest("/api/jobs")).rejects.toMatchObject({
      code: "CONTROL_API_INVALID_RESPONSE",
      status: 200,
    });

    fetchMock.mockResolvedValueOnce(createResponse(JSON.stringify({ detail: "Synthetic forbidden" }), 403));

    await expect(controlApiJsonRequest("/api/jobs")).rejects.toMatchObject({
      message: "Synthetic forbidden",
      status: 403,
    });

    fetchMock.mockResolvedValueOnce(createResponse(JSON.stringify({ error: "Synthetic string error" }), 403));

    await expect(controlApiJsonRequest("/api/jobs")).rejects.toMatchObject({
      message: "Synthetic string error",
      status: 403,
    });
  });

  it("throws the stable legacy write disabled error for blocked legacy mutations", () => {
    expect(() => assertNoLegacyMutatingRequest("/api/legacy-write", { method: "POST" })).toThrow(ApiRequestError);

    try {
      assertNoLegacyMutatingRequest("/api/legacy-write", { method: "POST" });
    } catch (error) {
      expect(error).toMatchObject({
        code: "LEGACY_WRITE_DISABLED",
        status: 410,
      });
    }
  });
});
