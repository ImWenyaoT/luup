# Web UI 模式（现行）

栈：**Next.js 16 App Router** + **TanStack Query** + **Emotion** + **SSE**。  
历史路径（RR8 / Vite SPA / Bun 前端工具链）以 ADR 留档，**不是**当前事实。

## Server-state

| 通道 | Hook / 入口 | 说明 |
| --- | --- | --- |
| HTTP 缓存 | `useRun` / `useConfig` / `useArtifact` / `useScience125` | 一律经 React Query；`QueryClient` 在 `providers/query.tsx` |
| SSE | `useRunEvents` | 不进 Query 缓存；订阅 `lib/sse/subscribe.ts`，tick 后 `refetch` snapshot |
| 本机 tabs | `useRunWorkingSet` | localStorage 工作集，非服务端权威 |

`ApiProvider`（`providers/api.tsx`）注入 `ApiClient`；组件不直接 `fetch` 业务路径。

## URL

- 权威读写：`features/shell/url-run.ts`（`readRunId` / `writeRunSearchParams`）
- 形状：`/?run=<id>`；清 run 时删掉 `run` 参数
- 编排：`research-workspace.tsx` 用 `useSearchParams` + `router.replace`

## Composer

`ResearchQuestionInput` 两种变体：

- `welcome` — `WelcomePanel`（无 snapshot）
- `footer` — `AppShell` footer（有 snapshot）

提交都走父级 `onStartResearch`；错误不上推到 input，由 workspace 横幅承接。

## 错误面

| 场景 | UI | 行为 |
| --- | --- | --- |
| 冷加载失败（有 `runId`、无可用 snapshot） | `ErrorPanel`（`data-testid="run-error"`） | 阻塞主区，不可「关闭」掉真相 |
| 创建 run / artifact 拉取失败 / refetch 失败 / tabs 持久化失败 | `AlertRow`（`data-testid="error-banner"`） | 非阻塞，可关闭 |
| Artifact 跨 run 粘滞 | `useStickyArtifactErrors` | 旧失败可跟到新 run；新 run 终态后清粘滞 |

## 禁止当作现行事实

- React Router 8 / TanStack Router 路由
- Vite 前端构建、`apps/web/dist` 扁平产物
- Bun 作为前端 runtime / test runner / bundler

以上见 ADR-0001 / 0002 / 0008（历史）与 ADR-0010（现行 Next）。
