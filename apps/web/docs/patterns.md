# apps/web 设计模式（C2a）

> 一类功能一种 pattern，避免各组件各自 fetch/EventSource。

## 1. Projection Types（wire 边界）

**问题**：server 内部字段不可信；TypeScript interface 不剥离多余 JSON 字段。

**做法**：
- `lib/types/wire.ts` 手写，注释锚定 `projection.ts` 的 `public*Schema`
- 前端**不** import server zod；契约测试对比 fixture JSON（来自 `apps/server/test/projection.test.ts` 导出或 snapshot）
- 未知 SSE kind 的 `diagnostic: "unsupported_event"` 由 UI 降级展示，不 crash

## 2. ApiClient（Executive Service）

**问题**：散落的 `fetch` + 重复错误解析 + Bearer 注入。

**做法**：
```typescript
// lib/api/client.ts — 单一 executive
createApiClient({ getToken }) → { get, post, put }
// 域模块只接收 ApiClient，不直接 fetch
createRun(client, question)
```

**规则**：
- 非 2xx → `ApiError(status, detail)`
- `fetchRun` 带 `AbortSignal.timeout`
- live 模式写操作自动加 `Authorization: Bearer`

## 3. Query + SSE Bridge

**问题**：SSE 推送增量信号，完整状态在 snapshot REST。

**做法**：
```text
useRunEvents ──onTick──► useRun.refetch()
                ▲
subscribeRunEvents (13 UI kinds)
```

|  Concern | Owner |
|----------|-------|
| 连接/重连/close | `lib/sse/subscribe.ts` |
| 何时 refetch | hook（debounce 可选，≤300ms） |
| snapshot 合并 | `useRun`（整包替换，不做 CRDT） |
| 游标 | `after=snapshot.version`；`Last-Event-ID` 由浏览器管理 |
| 终态 | `TERMINAL_STATUSES.has(status)` → close SSE |

**不测 EventSource 本身**：注入 `eventSourceFactory` mock。

## 4. Error Boundary（路由 + 域）

| 层级 | 位置 | 捕获 |
|------|------|------|
| 路由 | `app/root.tsx` `ErrorBoundary` | 渲染崩溃、404 |
| 域 | `features/workspace/RunErrorPanel` | `ApiError`、无效 `?run=` |
| 非阻塞 | banner 组件 | refetch 失败但保留 `lastSnapshot` |

**原则**：新建 run 失败不清空当前工作台 snapshot（E2E 要求）。

## 5. URL as State（深链）

**模式**：`?run=<id>` 为单一 run 指针；`history.replaceState` + `popstate` 同步。

```typescript
// features/shell/url-run.ts
readRunId(searchParams): string | null
writeRunSearchParams(id: string | null): Record<string, string>
```

RR8 路由可选升级为 `/run/:runId`；pattern 不变。

## 6. Feature Module（竖切）

```
features/workspace/
  index.ts          # 公开组件
  components/       # 私有
  selectors.ts      # 纯函数：从 Snapshot 派生视图模型
  workspace.test.ts
```

**禁止** feature 互 import 深层路径；只通过 `index.ts` 或 shared hooks。

## 7. Selector / ViewModel

**问题**：组件内重复过滤 `tool_evidence`、`attempts`。

**做法**：纯函数 selectors（可单测）：
```typescript
selectTrajectoryStages(snapshot): StageViewModel[]
selectSubagentLineage(snapshot): SubagentRow[]
selectTerminalBadge(snapshot): BadgeViewModel
```

## 8. Settings as Controlled Overlay

**模式**：`useConfig` 提供数据；`SettingsDialog` 只负责表单 UI；保存成功后 `reload()` + toast。

凭据三态文案映射在 selector，不散落在 JSX。

## 9. Test Pyramid

| 层 | 工具 | 覆盖对象 |
|----|------|----------|
| 单元 | Vitest | `lib/api`, `lib/sse`, selectors |
| 组件 | Vitest + RTL | hooks（wrapper）、纯组件 |
| E2E | Playwright | G2 三路径 + 刷新恢复 |

**TDD 顺序（C3）**：契约测试 → api 模块 → hooks → features。

## 10. 依赖注入点（可测性）

```typescript
createApiClient({ fetchImpl, getToken })
subscribeRunEvents(..., { eventSourceFactory })
useRun(runId, { client: defaultClient }) // 测试 override
```

默认导出绑定生产实现；测试注入 mock。
