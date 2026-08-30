import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  outputDir: "../../outputs/playwright/results",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3010",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command:
        "cd ../.. && LUUP_RUNTIME=deterministic LUUP_DATABASE=outputs/e2e/typescript-runs.db PORT=8010 pnpm exec tsx apps/server/src/main.ts",
      url: "http://127.0.0.1:8010/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command:
        "cd ../.. && LUUP_API_ORIGIN=http://127.0.0.1:8010 pnpm --filter @luup/frontend build && LUUP_API_ORIGIN=http://127.0.0.1:8010 pnpm --filter @luup/frontend exec next start --hostname 127.0.0.1 --port 3010",
      url: "http://127.0.0.1:3010/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
