import { defineConfig, devices } from "@playwright/test";

const webmcp = process.env.NEXT_PUBLIC_LUUP_WEBMCP === "1";

export default defineConfig({
  testDir: "./tests",
  outputDir: "../../outputs/playwright/results",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3010",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command:
        "cd ../.. && LUUP_RUNTIME=deterministic LUUP_DATABASE=outputs/e2e/typescript-runs.db PORT=8010 pnpm exec tsx apps/server/src/main.ts",
      url: "http://127.0.0.1:8010/api/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command:
        "cd ../.. && LUUP_API_ORIGIN=http://127.0.0.1:8010 pnpm --filter @luup/frontend build && LUUP_API_ORIGIN=http://127.0.0.1:8010 pnpm --filter @luup/frontend exec next start --hostname 127.0.0.1 --port 3010",
      url: "http://127.0.0.1:3010/api/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: "chromium",
      testIgnore: "**/webmcp.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    ...(webmcp
      ? [
          {
            name: "webmcp",
            testMatch: "**/webmcp.spec.ts",
            use: { ...devices["Desktop Chrome"], launchOptions: { args: ["--enable-blink-features=WebMCP"] } },
          },
        ]
      : []),
  ],
});
