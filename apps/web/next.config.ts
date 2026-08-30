import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

function resolveApiOrigin(phase: string): string {
  const configured = process.env.LUUP_API_ORIGIN?.trim();
  if (!configured && phase !== PHASE_DEVELOPMENT_SERVER) {
    throw new Error("生产构建/运行必须显式设置 LUUP_API_ORIGIN；禁止静默代理到 localhost。");
  }
  const raw = configured || "http://127.0.0.1:8000";
  let url: URL;
  try {
    url = new URL(raw);
  } catch (cause) {
    throw new Error(`LUUP_API_ORIGIN 不是有效 URL：${raw}`, { cause });
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.pathname !== "/") {
    throw new Error("LUUP_API_ORIGIN 必须是无路径的 http(s) origin。");
  }
  return url.origin;
}

export default function nextConfig(phase: string): NextConfig {
  const apiOrigin = resolveApiOrigin(phase);
  return {
    async rewrites() {
      return [
        { source: "/api/:path*", destination: `${apiOrigin}/api/:path*` },
        { source: "/health", destination: `${apiOrigin}/health` },
        { source: "/readyz", destination: `${apiOrigin}/readyz` },
      ];
    },
  };
}
