import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  outputDir: "../../outputs/playwright/results",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:8010",
    trace: "retain-on-failure",
  },
  webServer: {
    // 仓根是 apps/web 的上两级：先在根上 build（根 build 脚本转发到本包），
    // 再从根启同一个进程 —— 打的就是交付形态，静态产物与 API 同端口。
    command:
      "bun --cwd ../.. run build && cd ../.. && LUUP_RUNTIME=deterministic LUUP_DATABASE=outputs/e2e/typescript-runs.db LUUP_WEB_DIST=apps/web/dist PORT=8010 bun apps/server/src/main.ts",
    url: "http://127.0.0.1:8010/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
