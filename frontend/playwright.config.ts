import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig, devices } from "@playwright/test"

const here = path.dirname(fileURLToPath(import.meta.url))
const backendDir = path.resolve(here, "../backend")
/** 与 vite.config.ts 的 build.outDir 同址：单进程交付时页面从这里被 FastAPI 托管。 */
const buildOutput = path.join(backendDir, "app/frontend/index.html")

/**
 * E2E 打的是「单进程交付」形态：前端构建产物落进 backend/app/frontend，
 * 由一个 uvicorn 进程在同一端口托管页面 + /api。因此这里不起 vite dev，
 * 而是起 uvicorn；8000 留给人手开的开发实例，测试固定用 8123。
 */
const PORT = 8123
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`
const ownServer = !process.env.PLAYWRIGHT_BASE_URL

// FastAPI 只在 app/frontend 存在时挂载前端（见 backend/app/main.py）。没构建就跑，
// 症状是 webServer 等 / 超时；这里提前把原因说清楚，省一次两分钟的等待。
if (ownServer && !existsSync(buildOutput)) {
  throw new Error(
    `找不到前端构建产物 ${buildOutput}。先在 frontend/ 跑 \`pnpm build\`，再跑 \`pnpm test:e2e\`。`,
  )
}

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  /* CI 上禁止把 test.only 混进来。 */
  forbidOnly: !!process.env.CI,
  /* 用例只读仓内已提交的 runs/，没有网络与并发依赖：重试只会掩盖真实缺陷。 */
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  /* P0 只保 Chromium 一条浏览器线。 */
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: ownServer
    ? {
        command: `uv run uvicorn app.main:app --port ${PORT}`,
        cwd: backendDir,
        env: { UV_CACHE_DIR: ".cache/uv" },
        url: baseURL,
        timeout: 120 * 1000,
        reuseExistingServer: !process.env.CI,
      }
    : undefined,
})
