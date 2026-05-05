import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  installSyntheticControlApi,
  SYNTHETIC_E2E_ACTOR_ID,
} from "./support/synthetic-control-api";

type SyntheticRequest = {
  method: string;
  path: string;
  body?: unknown;
};

type SyntheticHarness = {
  requests: SyntheticRequest[];
  storageRequests: SyntheticRequest[];
  blockedExternalUrls: string[];
};

const SYNTHETIC_BASE_URL = "http://127.0.0.1:3100";
const AUTH_MODAL_URL = "/home?googleLoginError=synthetic&message=synthetic";
const SYNTHETIC_IMAGE_PROMPT = "Synthetic browser image prompt";
const SYNTHETIC_ASSET_NAME = "Synthetic Uploaded Asset";
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

function baseUrl(baseURL?: string) {
  return baseURL ?? SYNTHETIC_BASE_URL;
}

async function waitForRequest(
  harness: SyntheticHarness,
  predicate: (request: SyntheticRequest) => boolean,
) {
  await expect.poll(() => harness.requests.some(predicate), { timeout: 5_000 }).toBe(true);
  const request = harness.requests.find(predicate);
  expect(request).toBeTruthy();
  return request!;
}

function requestBody(request: SyntheticRequest) {
  expect(request.body).toEqual(expect.any(Object));
  return request.body as Record<string, unknown>;
}

async function openSyntheticAuthModal(page: Page) {
  await page.goto(AUTH_MODAL_URL, { waitUntil: "domcontentloaded" });
  const modal = page.locator("div.fixed.inset-0").filter({ has: page.locator("input") }).last();
  await expect(modal.locator('input[type="email"]').first()).toBeVisible();
  return modal;
}

test.describe("synthetic browser interaction smoke", () => {
  test("submits synthetic email login without real auth material", async ({ page, baseURL }) => {
    const harness = await installSyntheticControlApi(page, baseUrl(baseURL), {
      preloadAuth: false,
      unauthenticatedMe: true,
    });
    const authModal = await openSyntheticAuthModal(page);

    await authModal.locator('input[type="email"]').fill("login-e2e@example.invalid");
    await authModal.locator('input[type="password"]').fill("synthetic-password");
    await authModal.locator("button.h-11.w-full").click();

    const loginRequest = await waitForRequest(
      harness,
      (request) => request.method === "POST" && request.path === "/api/auth/login",
    );
    expect(requestBody(loginRequest)).toMatchObject({
      email: "login-e2e@example.invalid",
      password: "synthetic-password",
    });
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem("xiaolou-current-actor-id")), {
        timeout: 5_000,
      })
      .toBe(SYNTHETIC_E2E_ACTOR_ID);
    expect(harness.blockedExternalUrls).toEqual([]);
  });

  test("submits synthetic personal registration without provider material", async ({ page, baseURL }) => {
    const harness = await installSyntheticControlApi(page, baseUrl(baseURL), {
      preloadAuth: false,
      unauthenticatedMe: true,
    });
    const authModal = await openSyntheticAuthModal(page);

    await authModal.locator("button").nth(2).click();
    const inputs = authModal.locator("input");
    await inputs.nth(0).fill("Synthetic Registered User");
    await inputs.nth(1).fill("register-e2e@example.invalid");
    await inputs.nth(3).fill("synthetic-password");
    await authModal.locator("button.h-11.w-full").click();

    const registerRequest = await waitForRequest(
      harness,
      (request) => request.method === "POST" && request.path === "/api/auth/register/personal",
    );
    expect(requestBody(registerRequest)).toMatchObject({
      displayName: "Synthetic Registered User",
      email: "register-e2e@example.invalid",
      password: "synthetic-password",
    });
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem("xiaolou-current-actor-id")), {
        timeout: 5_000,
      })
      .toBe(SYNTHETIC_E2E_ACTOR_ID);
    expect(harness.blockedExternalUrls).toEqual([]);
  });

  test("submits synthetic image creation and refreshes job polling data", async ({ page, baseURL }) => {
    const harness = await installSyntheticControlApi(page, baseUrl(baseURL));

    await page.goto("/create/image", { waitUntil: "domcontentloaded" });
    const promptInput = page.locator("textarea").last();
    await promptInput.fill(SYNTHETIC_IMAGE_PROMPT);
    await promptInput.locator("xpath=ancestor::div[contains(@class, 'glass-panel')]").locator("button").last().click();

    const jobRequest = await waitForRequest(
      harness,
      (request) =>
        request.method === "POST" &&
        request.path === "/api/jobs" &&
        request.body !== null &&
        typeof request.body === "object" &&
        (request.body as Record<string, unknown>).jobType === "create_image_generate",
    );
    const jobBody = requestBody(jobRequest);
    expect(jobBody).toMatchObject({ jobType: "create_image_generate" });
    expect(jobBody.payload).toEqual(expect.objectContaining({ prompt: SYNTHETIC_IMAGE_PROMPT }));
    await waitForRequest(
      harness,
      (request) => request.method === "GET" && request.path.startsWith("/api/jobs?"),
    );
    await expect(page.getByText(SYNTHETIC_IMAGE_PROMPT).first()).toBeVisible({ timeout: 5_000 });
    expect(harness.blockedExternalUrls).toEqual([]);
  });

  test("uploads a synthetic asset through fake object storage", async ({ page, baseURL }) => {
    const harness = await installSyntheticControlApi(page, baseUrl(baseURL));

    await page.goto("/assets", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "新增资产" }).click();
    const assetModal = page.locator(".fixed").filter({ has: page.locator('input[type="file"]') }).last();
    await expect(assetModal).toBeVisible();

    await assetModal.locator('input:not([type="file"])').first().fill(SYNTHETIC_ASSET_NAME);
    await assetModal.locator('input[type="file"]').setInputFiles({
      name: "synthetic-e2e.png",
      mimeType: "image/png",
      buffer: ONE_PIXEL_PNG,
    });
    await assetModal.locator("textarea").fill("Synthetic-only uploaded asset");
    await assetModal.locator("button").last().click();

    await waitForRequest(
      harness,
      (request) => request.method === "POST" && request.path === "/api/media/upload-begin",
    );
    await expect
      .poll(
        () =>
          harness.storageRequests.some(
            (request) => request.method === "PUT" && request.path.startsWith("/upload/synthetic-object"),
          ),
        { timeout: 5_000 },
      )
      .toBe(true);
    await waitForRequest(
      harness,
      (request) => request.method === "POST" && request.path === "/api/media/upload-complete",
    );
    await waitForRequest(
      harness,
      (request) => request.method === "POST" && request.path === "/api/media/move-temp-to-permanent",
    );
    await waitForRequest(
      harness,
      (request) => request.method === "POST" && request.path === "/api/media/signed-read-url",
    );
    const assetRequest = await waitForRequest(
      harness,
      (request) => request.method === "POST" && /^\/api\/projects\/[^/]+\/assets$/.test(request.path),
    );
    expect(requestBody(assetRequest)).toMatchObject({
      name: SYNTHETIC_ASSET_NAME,
      mediaKind: "image",
    });
    expect(harness.blockedExternalUrls).toEqual([]);
  });

  test("runs toolbox synthetic route and polls its job from browser context", async ({ page, baseURL }) => {
    const harness = await installSyntheticControlApi(page, baseUrl(baseURL));

    await page.goto("/home", { waitUntil: "domcontentloaded" });
    const result = await page.evaluate(async () => {
      const run = await fetch("/api/toolbox/motion-transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountOwnerType: "user",
          accountOwnerId: "synthetic-e2e-actor",
          regionCode: "CN",
          currency: "CNY",
          projectId: "synthetic-project",
          target: "Synthetic Project",
          note: "Synthetic toolbox run",
          idempotencyKey: "frontend:synthetic-e2e:toolbox",
        }),
      });
      const runBody = await run.json();
      const job = await fetch(`/api/jobs/${runBody.taskId}`);
      return {
        runStatus: run.status,
        runBody,
        jobStatus: job.status,
        jobBody: await job.json(),
      };
    });

    expect(result.runStatus).toBe(200);
    expect(result.runBody.taskId).toBe("synthetic-toolbox-job");
    expect(result.jobStatus).toBe(200);
    expect(result.jobBody.id).toBe("synthetic-toolbox-job");
    await waitForRequest(
      harness,
      (request) => request.method === "POST" && request.path === "/api/toolbox/motion-transfer",
    );
    await waitForRequest(
      harness,
      (request) => request.method === "GET" && request.path === "/api/jobs/synthetic-toolbox-job",
    );
    expect(harness.blockedExternalUrls).toEqual([]);
  });
});
