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
}));

import {
  ApiRequestError,
  assertNoLegacyMutatingRequest,
  controlApiJsonRequest,
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
  const [url, init] = fetchMock.mock.calls.at(-1) ?? [];
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
