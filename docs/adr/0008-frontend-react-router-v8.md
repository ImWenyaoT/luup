# ADR-0008 · 前端绿field 重写为 React Router 8 SPA

## 状态

已接受，2026-08-26。废止 ADR-0001（「赛期保持 Vite + TanStack Router」）；ADR-0001 保留为历史记录。

## 背景

`apps/web` 在 C2–C4 阶段按 **绿field 重写**，不是对旧 TanStack Router 前端的渐进迁移。
旧交付面（`apps/web/src/`、TanStack Router 路由树与组件）已整体替换。

下列裁决在 ADR-0001 中仍成立，但落点已变：

- **不换 Next.js**——动态 `/runs/:id` 仍走客户端路由，无 SSR 收益；
- **单进程交付**——API 与静态页面同端口，演示路径最短。

已不成立或需重写的部分：

- 「赛期保持 TanStack Router」——栈已换；
- 产物路径 `apps/web/dist`（扁平 Vite 输出）——RR 构建为 `dist/client`。

## 决定

1. **栈**：React Router 8（当前锁 `^8.3`）+ Vite 8 作为 dev/build 工具链，`ssr: false`（纯 SPA）。
2. **Mode A**：API 仍由 `apps/server`（Elysia / Node HTTP）提供；前端只通过 HTTP + SSE 消费，不 import 服务端模块。
3. **构建命令**：`react-router build`（经 `@react-router/dev` Vite 插件），非独立 `vite build` 脚本。
4. **产物路径**：客户端静态资源输出到 `apps/web/dist/client`；`apps/server/src/server.ts` 默认
   `LUUP_WEB_DIST=apps/web/dist/client` 同端口托管。
5. **开发**：`react-router dev`（`:5173`），`/api` 与 `/health` 经 Vite proxy 到 API `:8000`；
   也可用 `pnpm run dev` 前后端一并起。

## 后果

正：

- 文件路由、`react-router typegen` 与 RR 8 生态对齐当前社区默认 SPA 形态；
- 单进程、同源 `/api` 交付不变；E2E 与 server 投影契约无需改端口模型；
- `apps/web/app/` 分层（routes → features → hooks → lib）边界清晰，wire type 仍在 web 侧手写。

负：

- ADR-0001 中关于 TanStack Router 插件锁定的论据作废；需以 RR 8 为准重新评估 dev HMR 等行为；
- 旧 `apps/web/src/**` 路径与文档引用需逐条清扫（见 C5 文档对齐）；
- Vite 仍是 bundler——「离开 Vite」未达成，只是路由层从 TanStack 换为 React Router。

## 验收

- `pnpm --filter @luup/frontend build` 产出 `apps/web/dist/client/index.html` 与 hashed assets；
- `LUUP_WEB_DIST` 未设置时 `pnpm run start` 可托管 `/` 与 `/api`；
- `pnpm run test:e2e` 在确定性 runtime 下全绿；
- 仓库文档（README、architecture、deployment）与 `LUUP_WEB_DIST` 默认一致。

## 何时重新审视

- 需要 SSR/SEO 或多 origin 拆分静态与 API；
- React Router 与 Elysia 静态托管之间出现无法接受的构建或路由冲突；
- 单进程交付约束消失（例如静态站与 API 分服务部署且 CORS/SSE 已适配）。
