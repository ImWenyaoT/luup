import type { Config } from "@react-router/dev/config";

export default {
  // SPA mode: Elysia serves the static client build (no RR runtime SSR).
  ssr: false,
  // Align with turbo outputs dist/** and historical apps/web/dist layout.
  // Client assets land in dist/client → LUUP_WEB_DIST=apps/web/dist/client
  buildDirectory: "dist",
} satisfies Config;
