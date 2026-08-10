import { defineConfig, devices } from "@playwright/test";

/**
 * E2E 打的是**生产构建**，不是 next dev：交付面就是 `next start` 起的那一个进程
 * （agent 流水线经 /api/runs 起子进程，不在 web 进程里），dev 特有的编译/水合时序
 * 不该混进对交付面的断言。
 *
 * 端口取 3210 而不是 3000：本机常年有别的 next dev 占着 3000，撞上去 reuseExistingServer
 * 会拿错服务，测出来的绿是别人的绿。
 */
const PORT = Number(process.env.LUUP_E2E_PORT ?? 3210);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: ".playwright/results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],

  use: {
    baseURL,
    // 数据源是仓库里 8 个真实 run，页面全 force-dynamic，没有需要等的水合以外的异步
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        // 深浅自动是设计的一部分，但断言与截图必须落在同一套配色上，否则对比度基线会漂
        colorScheme: "light",
      },
    },
  ],

  webServer: {
    command: `pnpm build && pnpm exec next start --port ${PORT}`,
    url: `${baseURL}/api/science125`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
