import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRouteModulePrefetcher,
  normalizeRoutePrefetchPath,
  type RoutePrefetchEntry,
} from "./routePrefetch";

let cleanupWindow: (() => void) | null = null;

function installBrowserWindow() {
  cleanupWindow?.();
  const target = globalThis as unknown as { window?: unknown };
  target.window = {};
  cleanupWindow = () => {
    delete target.window;
  };
}

function flushPromises() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function createPlaygroundPrefetcher(load: () => Promise<unknown>) {
  const entries: RoutePrefetchEntry[] = [
    {
      matches: (path) => path === "/playground" || path.startsWith("/playground/"),
      loaders: [load],
    },
  ];

  return createRouteModulePrefetcher(entries);
}

afterEach(() => {
  cleanupWindow?.();
  cleanupWindow = null;
  vi.restoreAllMocks();
});

describe("route module prefetch", () => {
  it("normalizes query and hash before matching routes", () => {
    expect(normalizeRoutePrefetchPath("/playground?conversationId=one#messages")).toBe("/playground");
    expect(normalizeRoutePrefetchPath("")).toBe("/");
  });

  it("does not load route modules outside the browser", () => {
    const load = vi.fn(() => Promise.resolve());
    const prefetch = createPlaygroundPrefetcher(load);

    prefetch("/playground");

    expect(load).not.toHaveBeenCalled();
  });

  it("dedupes repeated browser intent for the same normalized route", async () => {
    installBrowserWindow();
    const load = vi.fn(() => Promise.resolve());
    const prefetch = createPlaygroundPrefetcher(load);

    prefetch("/playground?conversationId=one");
    prefetch("/playground#composer");
    await flushPromises();

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("allows a later intent to retry when a prefetch fails", async () => {
    installBrowserWindow();
    const load = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("chunk failed"))
      .mockResolvedValueOnce(undefined);
    const prefetch = createPlaygroundPrefetcher(load);

    prefetch("/playground");
    await flushPromises();
    prefetch("/playground");
    await flushPromises();

    expect(load).toHaveBeenCalledTimes(2);
  });
});
