import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

// dev server 之外的 API 进程：`pnpm dev:api`（src/main.ts）默认监听 8000。
const api = "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: api,
        changeOrigin: true,
        // Keep SSE frames unbuffered and uncompressed end to end.
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            // Without compression the proxy can never sit on a partial gzip block.
            proxyReq.setHeader("accept-encoding", "identity");
          });
          proxy.on("proxyRes", (proxyRes) => {
            const contentType = proxyRes.headers["content-type"];
            if (
              typeof contentType !== "string" ||
              !contentType.includes("text/event-stream")
            )
              return;
            delete proxyRes.headers["content-encoding"];
            delete proxyRes.headers["content-length"];
            proxyRes.headers["cache-control"] = "no-cache, no-transform";
            proxyRes.headers["x-accel-buffering"] = "no";
          });
        },
      },
      "/health": { target: api, changeOrigin: true },
    },
  },
});
