import { defineConfig } from "vitest/config";

// 单测只收 src/ 内共置的 *.test.ts（纯逻辑，node 环境零 DOM 依赖）。
// tests/ 归 Playwright（testDir 指向那里），两边互不拾取。
export default defineConfig({
  resolve: {
    // 与 vite.config 的 "@" → src 对齐；vitest 独立配置不继承那份。
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
