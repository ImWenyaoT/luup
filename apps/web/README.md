# @luup/frontend

React Router（SPA，`ssr: false`）交付面。构建产物由 `apps/server` 同端口托管。

```bash
pnpm --filter @luup/frontend dev        # http://127.0.0.1:5173 ，/api 与 /health 代理到 :8000
pnpm --filter @luup/frontend build        # → dist/client
pnpm --filter @luup/frontend typecheck
pnpm --filter @luup/frontend test       # Vitest 单元测试
```

静态产物目录：`apps/web/dist/client`（对应 `LUUP_WEB_DIST`）。
