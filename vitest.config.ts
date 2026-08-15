import { defineConfig } from "vitest/config";

// 根包（harness 本体）的测试跑器。apps/web 有自己的 vitest 与自己的门，这里不碰它——
// include 只收 test/，coverage.include 只收 src/，两边互不越界。
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Harness 的用例开真 SQLite、真 HTTP 端口、真临时目录：进程隔离比线程可靠，
    // 单写者锁与端口占用在测试里因此保持真实语义。
    pool: "forks",
    coverage: {
      provider: "v8",
      // 只度量本仓的运行时源码：apps/web 走自己的门，测试自身不计入分母。
      include: ["src/**/*.ts"],
      exclude: [
        // 进程入口：import 即启动服务器/批跑，覆盖率无法在单测进程内度量，
        // 其内部逻辑分别由 server.test.ts / batch.test.ts 经真实调用覆盖。
        "src/main.ts",
        "src/canary.ts",
      ],
      // 地板是实测值向下取整到 5 的倍数，不是愿望值：涨了再抬，不许自己降。
      // 实测（2026-08-15，159 用例）：stmts 79.12 / branch 70.66 / funcs 83.17 / lines 80.09。
      thresholds: {
        statements: 75,
        branches: 70,
        functions: 80,
        lines: 75,
      },
      reporter: ["text", "json-summary"],
    },
  },
});
