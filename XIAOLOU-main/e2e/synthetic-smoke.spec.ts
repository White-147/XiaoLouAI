import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { installSyntheticControlApi } from "./support/synthetic-control-api";

const STATIC_SMOKE_PATHS = [
  "/home",
  "/admin/login",
  "/playground",
  "/assets",
  "/create/image",
  "/create/video",
] as const;

async function expectRenderedShell(page: Page) {
  await expect(page.locator("#root")).toBeVisible();
  await expect
    .poll(
      async () =>
        page.locator("#root").evaluate((element) => element.textContent?.trim().length ?? 0),
      { timeout: 5_000 },
    )
    .toBeGreaterThan(20);
}

test.describe("synthetic browser smoke", () => {
  for (const path of STATIC_SMOKE_PATHS) {
    test(`renders ${path} without real backend material`, async ({ page, baseURL }) => {
      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      const harness = await installSyntheticControlApi(page, baseURL ?? "http://127.0.0.1:3100");

      page.on("pageerror", (error) => {
        pageErrors.push(error.message);
      });
      page.on("console", (message) => {
        if (message.type() === "error" && !/Failed to load resource/i.test(message.text())) {
          consoleErrors.push(message.text());
        }
      });

      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expectRenderedShell(page);
      await expect
        .poll(
          () => harness.requests.some((request) => request.path.startsWith("/api/me")),
          { timeout: 5_000 },
        )
        .toBe(true);

      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
    });
  }

  test("renders /api-center through client navigation with synthetic fixtures", async ({ page, baseURL }) => {
    const harness = await installSyntheticControlApi(page, baseURL ?? "http://127.0.0.1:3100");

    await page.goto("/home", { waitUntil: "domcontentloaded" });
    await expectRenderedShell(page);
    await page.evaluate(() => {
      window.history.pushState(null, "", "/api-center");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect.poll(() => page.evaluate(() => window.location.pathname), { timeout: 5_000 }).toBe("/api-center");
    await expectRenderedShell(page);
    await expect
      .poll(
        () => harness.requests.some((request) => request.path.startsWith("/api/api-center")),
        { timeout: 5_000 },
      )
      .toBe(true);
  });

  test("serves playground data from synthetic fixtures only", async ({ page, baseURL }) => {
    const harness = await installSyntheticControlApi(page, baseURL ?? "http://127.0.0.1:3100");

    await page.goto("/playground", { waitUntil: "domcontentloaded" });
    await expect
      .poll(
        () =>
          harness.requests.filter((request) => request.path.startsWith("/api/playground/")).length,
        { timeout: 5_000 },
      )
      .toBeGreaterThan(0);

    expect(harness.blockedExternalUrls).toEqual([]);
    expect(harness.requests.every((request) => request.path.startsWith("/api/"))).toBe(true);
  });
});
