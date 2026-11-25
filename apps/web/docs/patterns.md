# Web UI 模式（现行）

栈：**Next.js 16 App Router** + **Astryx** + **TanStack Query** + **AI SDK `useChat`**。  
Science-125 emotion workspace 已移除；历史路径以 ADR / git 留档。

## Server-state

| 通道 | Hook / 入口 | 说明 |
| --- | --- | --- |
| Config | `useConfig` | React Query；`GET`/`PUT /api/config` |
| Mill | `lib/api/mill.ts` | `GET /api/autoresearch/mill`、`POST .../start|stop` |
| SIWC | `lib/api/siwc.ts` | `POST /api/auth/siwc/start|logout`、`GET .../status` |
| Chat | `@ai-sdk/react` `useChat` | `POST /api/autoresearch/chat`（DefaultChatTransport） |

`ApiProvider`（`providers/api.tsx`）注入 `ApiClient`；组件不直接 `fetch` 业务路径。

## 路由与壳

- `/` 与 `/autoresearch` → `AutoresearchChat`（Mill + single-question chat）
- 壳：`features/shell/LuupShell.tsx`（Astryx shell-nav）；设置挂 TopNav
- 无 `/legacy`；无 `/?run=` 产品入口

## 错误面

| 场景 | UI |
| --- | --- |
| Mill / chat 调用失败 | Astryx `Banner` |
| 设置保存 / SIWC 失败 | SettingsDialog 内 alert / status |

## 禁止当作现行事实

- `research-workspace.tsx` / `features/workspace/*` / emotion `AppShell`
- `useRun` / `useScience125` / `/?run=` URL 编排
- RR8 / Vite SPA / Bun 前端工具链（见 ADR）
