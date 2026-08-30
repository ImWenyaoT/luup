# ADR-0010 · Next.js App Router 与 Vercel 形制

## 状态

已接受，2026-08-30。取代 ADR-0008 的 React Router/Vite 与单进程静态托管结论；历史 ADR 原样保留。

## 决定

- `apps/web` 使用 Next.js 16 App Router；路由约定落在 `app/layout.tsx`、`app/page.tsx`、
  `app/error.tsx` 与 `app/not-found.tsx`，不保留第二套路由配置。
- `apps/server` 是独立 Node/Elysia API，不再读取或托管 Web 构建产物。
- Web 只访问同源 `/api`；`next.config.ts` 通过 `LUUP_API_ORIGIN` rewrite 到 API，支持本地双进程、
  Vercel Web + 持久化 API origin 两种形态。
- monorepo 保持 `apps/*` 为可部署应用；没有第二个消费者前不创建空的 `packages/ui`、`packages/config`
  或模板目录。共享代码出现真实复用后再下沉 `packages/*`。
- Turborepo 只编排 `dev/build/typecheck/test/start`，每个应用拥有自己的入口、依赖和产物。

## 后果

Web 与 API 可独立扩缩、发布和回滚，目录/文件命名与 Next/Turborepo 默认约定一致；代价是本地与生产均为
两个进程。SQLite、后台 Run 与文件制 memory 必须留在持久化 API origin，不能部署进 Vercel Function。

## 验收

- 显式设置 `LUUP_API_ORIGIN` 后，`next build` 产出静态 `/` 和 `/_not-found`；
- 浏览器通过 Next origin 的 `/api/health`、SSE 与写接口完成确定性 E2E；
- `apps/server` 对非 API 路径返回 JSON 404，不含静态文件接线。
