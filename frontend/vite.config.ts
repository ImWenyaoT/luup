import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

/**
 * 开发期保持同源 /api：页面不需要知道 FastAPI 的地址，生产环境则由
 * VITE_API_BASE_URL 显式指定。这个 adapter 是迁移期的唯一 HTTP 边界。
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
