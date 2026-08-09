import { defineConfig, devices } from "@playwright/test";

/**
 * E2E 打的是**生产构建**，不是 next dev：
 * dev 下 withEve 会顺带拉起 eve dev（一条 agent 运行时），而这套用例一行都不碰 /eve/v1/*，
 * 为它多等一个子进程就绪就是把无关的失败面接进测试。生产 phase 下 withEve 只写一条
 * rewrite 指向 127.0.0.1:4274，不 spawn、不健康检查，agent 侧没起也不影响本仓库的交付面。
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
    command: `pnpm build:web && pnpm exec next start --port ${PORT}`,
    url: `${baseURL}/api/science125`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
