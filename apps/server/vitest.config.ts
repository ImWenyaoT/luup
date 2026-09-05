import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      // 核心模块分别过门，不能被 API/导出代码的高覆盖率平均掉。
      // 用 Vitest 原生按文件阈值；全局与报告完整性继续由 coverage-gate 校验。
      thresholds: {
        "src/harness.ts": { functions: 80, lines: 80 },
        "src/roles.ts": { functions: 80, lines: 80 },
        "src/executor.ts": { functions: 80, lines: 80 },
        "src/store/store.ts": { functions: 80, lines: 80 },
        "src/campaign/campaign.ts": { functions: 80, lines: 80 },
        "src/verify/verifier.ts": { functions: 80, lines: 80 },
      },
    },
  },
});
