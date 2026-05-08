import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/lib/api/**/*.test.ts", "src/features/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage/advisory",
      reporter: ["text", "json-summary"],
      all: true,
      include: ["src/lib/api/*.ts", "src/features/**/api/*.ts"],
      exclude: ["src/lib/api/__tests__/**", "src/features/**/__tests__/**"],
    },
  },
});
