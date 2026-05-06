import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadMediaFile, guessMediaFilename } from "../../download-media";
import { retireStaticBuildServiceWorkers } from "../../service-worker-retirement";

type FetchCall = {
  input: unknown;
  init?: RequestInit;
};

type SyntheticAnchor = {
  href: string;
  download: string;
  rel: string;
  style: Record<string, string>;
  click: ReturnType<typeof vi.fn>;
};

function installSyntheticBrowserGlobals({
  origin = "https://app.example",
  pathname = "/create/image",
}: {
  origin?: string;
  pathname?: string;
} = {}) {
  const anchors: SyntheticAnchor[] = [];
  const appendChild = vi.fn((node: unknown) => node);
  const removeChild = vi.fn((node: unknown) => node);
  const open = vi.fn();
  const createObjectUrl = vi.fn((_blob: Blob) => "blob:synthetic-download");
  const revokeObjectUrl = vi.fn((_objectUrl: string) => undefined);
  const NativeURL = globalThis.URL;

  const createElement = vi.fn((tagName: string) => {
    if (tagName !== "a") {
      throw new Error(`Unexpected synthetic element: ${tagName}`);
    }

    const anchor: SyntheticAnchor = {
      href: "",
      download: "",
      rel: "",
      style: {},
      click: vi.fn(),
    };
    anchors.push(anchor);
    return anchor;
  });

  class SyntheticURL extends NativeURL {
    static createObjectURL(blob: Blob) {
      return createObjectUrl(blob);
    }

    static revokeObjectURL(objectUrl: string) {
      revokeObjectUrl(objectUrl);
    }
  }

  vi.stubGlobal("URL", SyntheticURL);
  vi.stubGlobal("document", {
    createElement,
    body: {
      appendChild,
      removeChild,
    },
  } as unknown as Document);
  vi.stubGlobal("window", {
    location: {
      origin,
      pathname,
    },
    open,
  } as unknown as Window & typeof globalThis);

  return {
    anchors,
    appendChild,
    removeChild,
    open,
    createObjectUrl,
    revokeObjectUrl,
  };
}

function installSyntheticFetch(handler: (input: unknown, init?: RequestInit) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      calls.push({ input, init });
      return handler(input, init);
    }),
  );
  return calls;
}

function syntheticResponse({
  ok = true,
  status = 200,
  blob = new Blob(["synthetic media bytes"], { type: "image/png" }),
}: {
  ok?: boolean;
  status?: number;
  blob?: Blob;
} = {}) {
  return {
    ok,
    status,
    blob: async () => blob,
  } as Response;
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("browser fetch and background cleanup boundaries", () => {
  it("guesses media filenames from sanitized ids and URL extensions", () => {
    expect(guessMediaFilename("https://cdn.example/render/final-shot.webp?token=synthetic", "shot / 42", "image")).toBe(
      "xiaolou-image-shot42.webp",
    );
    expect(guessMediaFilename("not a url", "???", "video")).toBe("xiaolou-video-export.mp4");
  });

  it("downloads remote media by trying same-origin first and revoking blob URLs", async () => {
    const browser = installSyntheticBrowserGlobals();
    const fetchCalls = installSyntheticFetch((input) => {
      if (String(input) === "https://app.example/media/synthetic.png") {
        return syntheticResponse({ ok: false, status: 404 });
      }

      return syntheticResponse({
        blob: new Blob(["synthetic fetched image"], { type: "image/png" }),
      });
    });

    await downloadMediaFile("https://cdn.example/media/synthetic.png", "synthetic.png");

    expect(fetchCalls.map((call) => String(call.input))).toEqual([
      "https://app.example/media/synthetic.png",
      "https://cdn.example/media/synthetic.png",
    ]);
    expect(fetchCalls.every((call) => call.init?.credentials === "include" && call.init.mode === "cors")).toBe(true);
    expect(browser.anchors).toHaveLength(1);
    expect(browser.anchors[0]).toMatchObject({
      href: "blob:synthetic-download",
      download: "synthetic.png",
      rel: "noopener",
    });
    expect(browser.anchors[0].click).toHaveBeenCalledTimes(1);
    expect(browser.appendChild).toHaveBeenCalledWith(browser.anchors[0]);
    expect(browser.removeChild).toHaveBeenCalledWith(browser.anchors[0]);
    expect(browser.createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(browser.revokeObjectUrl).toHaveBeenCalledWith("blob:synthetic-download");
    expect(browser.open).not.toHaveBeenCalled();
  });

  it("uses direct data/blob downloads without fetch or popup fallback", async () => {
    const browser = installSyntheticBrowserGlobals();
    const fetchCalls = installSyntheticFetch(() => {
      throw new Error("direct data URL downloads must not call fetch");
    });

    await downloadMediaFile("data:image/png;base64,c3ludGhldGlj", "synthetic-data.png");

    expect(fetchCalls).toEqual([]);
    expect(browser.anchors).toHaveLength(1);
    expect(browser.anchors[0]).toMatchObject({
      href: "data:image/png;base64,c3ludGhldGlj",
      download: "synthetic-data.png",
      rel: "noopener",
    });
    expect(browser.anchors[0].click).toHaveBeenCalledTimes(1);
    expect(browser.open).not.toHaveBeenCalled();
  });

  it("falls back to opening the original URL after synthetic fetch attempts fail", async () => {
    const browser = installSyntheticBrowserGlobals();
    const fetchCalls = installSyntheticFetch(() => syntheticResponse({ ok: false, status: 503 }));

    await downloadMediaFile("https://cdn.example/missing/synthetic.png", "missing.png");

    expect(fetchCalls.map((call) => String(call.input))).toEqual([
      "https://app.example/missing/synthetic.png",
      "https://cdn.example/missing/synthetic.png",
    ]);
    expect(browser.anchors).toEqual([]);
    expect(browser.open).toHaveBeenCalledWith(
      "https://cdn.example/missing/synthetic.png",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("retires only current-scope service workers and retired static caches", async () => {
    const unregisterCurrent = vi.fn(async () => true);
    const unregisterOtherPath = vi.fn(async () => true);
    const unregisterOtherOrigin = vi.fn(async () => true);
    const cacheApi = {
      keys: vi.fn(async () => [
        "xiaolou-static-v1",
        "vite-precache-assets",
        "runtime-cache",
        "other-cache",
      ]),
      delete: vi.fn(async (_cacheName: string) => true),
    };
    const serviceWorker = {
      getRegistrations: vi.fn(async () => [
        {
          scope: "https://app.example/create/",
          unregister: unregisterCurrent,
        },
        {
          scope: "https://app.example/admin/",
          unregister: unregisterOtherPath,
        },
        {
          scope: "https://other.example/create/",
          unregister: unregisterOtherOrigin,
        },
      ]),
    };

    vi.stubGlobal("window", {
      location: {
        origin: "https://app.example",
        pathname: "/create/image",
      },
      caches: cacheApi,
    } as unknown as Window & typeof globalThis);
    vi.stubGlobal("navigator", { serviceWorker } as unknown as Navigator);
    vi.stubGlobal("caches", cacheApi);

    retireStaticBuildServiceWorkers();
    await flushMicrotasks();

    expect(serviceWorker.getRegistrations).toHaveBeenCalledTimes(1);
    expect(unregisterCurrent).toHaveBeenCalledTimes(1);
    expect(unregisterOtherPath).not.toHaveBeenCalled();
    expect(unregisterOtherOrigin).not.toHaveBeenCalled();
    expect(cacheApi.keys).toHaveBeenCalledTimes(1);
    expect(cacheApi.delete.mock.calls.map(([cacheName]) => cacheName)).toEqual([
      "xiaolou-static-v1",
      "vite-precache-assets",
    ]);
  });
});
