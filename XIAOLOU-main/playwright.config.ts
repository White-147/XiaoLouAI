import { defineConfig, devices } from "@playwright/test";

const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL || "chrome";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report/synthetic-smoke", open: "never" }],
  ],
  outputDir: "test-results/synthetic-smoke",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
  },
  webServer: {
    command: "npm run build && npm run preview:e2e:synthetic",
    url: "http://127.0.0.1:3100/home",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_CORE_API_BASE_URL: "",
      VITE_ALLOW_LEGACY_MUTATIONS: "false",
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: browserChannel,
      },
    },
  ],
});
