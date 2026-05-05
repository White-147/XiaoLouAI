import { afterEach, describe, expect, it, vi } from "vitest";
import { createMediaService } from "../media";
import { createSyntheticMediaScope, parseJsonBody, type RequestCall, type RequestHandler } from "./synthetic-fixtures";

type MediaServiceDeps = Parameters<typeof createMediaService>[0];

type FetchCall = {
  input: unknown;
  init?: RequestInit;
};

function createUploadFile(name = "Synthetic Portrait 01.png", type = "image/png") {
  return new File(["synthetic file bytes"], name, { type });
}

function createServiceHarness({
  actorId = "synthetic actor@example",
  clientId = "synthetic-media-client",
  handler = () => ({}),
}: {
  actorId?: string;
  clientId?: string;
  handler?: RequestHandler;
} = {}) {
  const calls: RequestCall[] = [];
  const clientIdPrefixes: string[] = [];
  const errors: Array<{ message: string; options?: { code?: string; status?: number } }> = [];
  const mediaScopeActorIds: string[] = [];

  const deps: MediaServiceDeps = {
    controlApiJsonRequest: async <T>(path: string, init?: RequestInit): Promise<T> => {
      calls.push({ path, init });
      return (await handler(path, init)) as T;
    },
    getCurrentActorId: () => actorId,
    buildControlMediaScope: (scopeActorId) => {
      mediaScopeActorIds.push(scopeActorId);
      return createSyntheticMediaScope(scopeActorId);
    },
    createClientId: (prefix) => {
      clientIdPrefixes.push(prefix);
      return clientId;
    },
    createApiRequestError: (message, options) => {
      errors.push({ message, options });
      return new Error(`${options?.code ?? "MEDIA_ERROR"}:${message}`);
    },
  };

  return {
    calls,
    clientIdPrefixes,
    errors,
    mediaScopeActorIds,
    service: createMediaService(deps),
  };
}

function installSyntheticFetch(handler: (input: unknown, init?: RequestInit) => Promise<unknown> | unknown) {
  const fetchCalls: FetchCall[] = [];
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    fetchCalls.push({ input, init });
    return (await handler(input, init)) as Response;
  });
  return fetchCalls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createMediaService", () => {
  it("uploads a File through stable Control API routes and normalized object keys", async () => {
    const signedReadUrl = "https://synthetic-storage.example/read/media-object";
    const { calls, clientIdPrefixes, mediaScopeActorIds, service } = createServiceHarness({
      handler: (path) => {
        if (path === "/api/media/upload-begin") {
          return {
            media_object_id: "synthetic-media-object",
            upload_session_id: "synthetic-upload-session",
            upload_url: "https://synthetic-storage.example/upload/media-object",
          };
        }
        if (path === "/api/media/signed-read-url") {
          return {
            signed_read_url: signedReadUrl,
          };
        }

        return { ok: true };
      },
    });
    const fetchCalls = installSyntheticFetch(() => ({
      ok: true,
      status: 200,
    }));

    await expect(service.uploadFile(createUploadFile(), "image")).resolves.toEqual({
      id: "synthetic-media-object",
      kind: "image",
      originalName: "Synthetic Portrait 01.png",
      storedName: "synthetic-media-client-Synthetic-Portrait-01.png",
      sizeBytes: 20,
      contentType: "image/png",
      url: signedReadUrl,
      urlPath: signedReadUrl,
      mediaObjectId: "synthetic-media-object",
      objectKey: "media/frontend/synthetic-actor-example/synthetic-media-client-Synthetic-Portrait-01.png",
      signedReadUrl,
    });

    expect(calls.map((call) => call.path)).toEqual([
      "/api/media/upload-begin",
      "/api/media/upload-complete",
      "/api/media/move-temp-to-permanent",
      "/api/media/signed-read-url",
    ]);
    expect(calls.every((call) => call.init?.method === "POST")).toBe(true);
    expect(parseJsonBody(calls[0])).toEqual({
      accountOwnerType: "user",
      accountOwnerId: "synthetic actor@example",
      regionCode: "CN",
      currency: "CNY",
      idempotencyKey: "frontend:synthetic actor@example:synthetic-media-client",
      objectKey: "media/frontend/synthetic-actor-example/synthetic-media-client-Synthetic-Portrait-01.png",
      mediaType: "image",
      contentType: "image/png",
      byteSize: 20,
      data: {
        originalName: "Synthetic Portrait 01.png",
        frontendKind: "image",
      },
    });
    expect(parseJsonBody(calls[1])).toEqual({
      accountOwnerType: "user",
      accountOwnerId: "synthetic actor@example",
      regionCode: "CN",
      currency: "CNY",
      uploadSessionId: "synthetic-upload-session",
      mediaObjectId: "synthetic-media-object",
      byteSize: 20,
    });
    expect(parseJsonBody(calls[2])).toEqual({
      accountOwnerType: "user",
      accountOwnerId: "synthetic actor@example",
      regionCode: "CN",
      currency: "CNY",
      mediaObjectId: "synthetic-media-object",
      permanentObjectKey: "media/frontend/synthetic-actor-example/synthetic-media-client-Synthetic-Portrait-01.png",
      reason: "frontend-image",
    });
    expect(parseJsonBody(calls[3])).toEqual({
      accountOwnerType: "user",
      accountOwnerId: "synthetic actor@example",
      regionCode: "CN",
      currency: "CNY",
      mediaObjectId: "synthetic-media-object",
      expiresInSeconds: 3600,
    });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].input).toBe("https://synthetic-storage.example/upload/media-object");
    expect(fetchCalls[0].init?.method).toBe("PUT");
    expect(fetchCalls[0].init?.headers).toEqual({
      "Content-Type": "image/png",
    });
    expect(fetchCalls[0].init?.body).toBeInstanceOf(File);
    expect(clientIdPrefixes).toEqual(["media"]);
    expect(mediaScopeActorIds).toEqual(["synthetic actor@example"]);
  });

  it("converts data URLs to synthetic files and accepts camelCase upload responses", async () => {
    const { calls, service } = createServiceHarness({
      actorId: "synthetic-actor",
      clientId: "synthetic-data-url-client",
      handler: (path) => {
        if (path === "/api/media/upload-begin") {
          return {
            mediaObjectId: "synthetic-data-url-media",
            uploadSessionId: "synthetic-data-url-session",
            uploadUrl: "https://synthetic-storage.example/upload/data-url",
          };
        }
        if (path === "/api/media/signed-read-url") {
          return {
            signedReadUrl: "https://synthetic-storage.example/read/data-url",
          };
        }

        return { ok: true };
      },
    });
    const dataBlob = new Blob(["synthetic png bytes"], { type: "image/png" });
    const fetchCalls = installSyntheticFetch((input) => {
      if (String(input).startsWith("data:")) {
        return {
          blob: async () => dataBlob,
        };
      }

      return {
        ok: true,
        status: 200,
      };
    });

    await expect(
      service.uploadDataUrlAsFile("data:image/png;base64,c3ludGhldGlj", "image", " Synthetic Avatar "),
    ).resolves.toMatchObject({
      id: "synthetic-data-url-media",
      kind: "image",
      originalName: "Synthetic-Avatar.png",
      storedName: "synthetic-data-url-client-Synthetic-Avatar.png",
      contentType: "image/png",
      url: "https://synthetic-storage.example/read/data-url",
      signedReadUrl: "https://synthetic-storage.example/read/data-url",
      objectKey: "media/frontend/synthetic-actor/synthetic-data-url-client-Synthetic-Avatar.png",
    });

    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[0].input).toBe("data:image/png;base64,c3ludGhldGlj");
    expect(fetchCalls[1].input).toBe("https://synthetic-storage.example/upload/data-url");
    expect(fetchCalls[1].init?.method).toBe("PUT");
    expect(fetchCalls[1].init?.body).toBeInstanceOf(File);
    expect(parseJsonBody(calls[0])).toMatchObject({
      objectKey: "media/frontend/synthetic-actor/synthetic-data-url-client-Synthetic-Avatar.png",
      mediaType: "image",
      contentType: "image/png",
      data: {
        originalName: "Synthetic-Avatar.png",
        frontendKind: "image",
      },
    });
    expect(parseJsonBody(calls[1])).toMatchObject({
      uploadSessionId: "synthetic-data-url-session",
      mediaObjectId: "synthetic-data-url-media",
      byteSize: dataBlob.size,
    });
  });

  it("falls back to uploadUrl when signed-read response omits a read URL", async () => {
    const uploadUrl = "https://synthetic-storage.example/upload/fallback";
    const { service } = createServiceHarness({
      handler: (path) => {
        if (path === "/api/media/upload-begin") {
          return {
            media_object_id: "synthetic-fallback-media",
            upload_session_id: "synthetic-fallback-session",
            upload_url: uploadUrl,
          };
        }

        return {};
      },
    });
    installSyntheticFetch(() => ({
      ok: true,
      status: 200,
    }));

    await expect(service.uploadFile(createUploadFile("synthetic.bin", ""), "")).resolves.toMatchObject({
      id: "synthetic-fallback-media",
      kind: "",
      contentType: "application/octet-stream",
      signedReadUrl: uploadUrl,
      url: uploadUrl,
      urlPath: uploadUrl,
    });
  });

  it("reports invalid upload sessions and object upload failures through synthetic errors", async () => {
    const invalidSessionHarness = createServiceHarness({
      handler: () => ({
        media_object_id: "synthetic-invalid-media",
      }),
    });
    installSyntheticFetch(() => {
      throw new Error("unexpected object-storage call");
    });

    await expect(invalidSessionHarness.service.uploadFile(createUploadFile())).rejects.toThrow(
      "MEDIA_UPLOAD_SESSION_INVALID:Control API did not return a usable media upload session",
    );
    expect(invalidSessionHarness.calls).toHaveLength(1);
    expect(invalidSessionHarness.errors).toEqual([
      {
        message: "Control API did not return a usable media upload session",
        options: {
          code: "MEDIA_UPLOAD_SESSION_INVALID",
          status: 502,
        },
      },
    ]);

    const failedUploadHarness = createServiceHarness({
      handler: (path) => {
        if (path === "/api/media/upload-begin") {
          return {
            media_object_id: "synthetic-failed-media",
            upload_session_id: "synthetic-failed-session",
            upload_url: "https://synthetic-storage.example/upload/failure",
          };
        }

        return { ok: true };
      },
    });
    installSyntheticFetch(() => ({
      ok: false,
      status: 503,
    }));

    await expect(failedUploadHarness.service.uploadFile(createUploadFile())).rejects.toThrow(
      "MEDIA_OBJECT_UPLOAD_FAILED:Object storage upload failed",
    );
    expect(failedUploadHarness.calls).toHaveLength(1);
    expect(failedUploadHarness.errors).toEqual([
      {
        message: "Object storage upload failed",
        options: {
          code: "MEDIA_OBJECT_UPLOAD_FAILED",
          status: 503,
        },
      },
    ]);
  });

  it("rejects non-data URLs before fetch or Control API calls", async () => {
    const { calls, errors, service } = createServiceHarness();
    const fetchCalls = installSyntheticFetch(() => {
      throw new Error("unexpected fetch");
    });

    await expect(service.uploadDataUrlAsFile("https://synthetic.example/not-data-url")).rejects.toThrow(
      "MEDIA_UPLOAD_INVALID_DATA_URL:Expected a data URL for media upload",
    );

    expect(calls).toEqual([]);
    expect(fetchCalls).toEqual([]);
    expect(errors).toEqual([
      {
        message: "Expected a data URL for media upload",
        options: {
          code: "MEDIA_UPLOAD_INVALID_DATA_URL",
          status: 400,
        },
      },
    ]);
  });
});
