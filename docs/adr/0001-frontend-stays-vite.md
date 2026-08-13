# ADR-0001 · 前端框架保持 Vite + TanStack Router，不换 Next

## 状态

已接受，2026-08-12。

## 背景

### 上游模板的答案

`fastapi/full-stack-fastapi-template` 于 2026-08-12 发布 **0.12.0**，前端栈**仍是 Vite +
TanStack Router**。该模板的全部职责就是回答「FastAPI 该配什么前端」，作者是 FastAPI 本人——
在这个问题上它是最权威的可得信号。

易被误读的一条：模板 `frontend/package.json` 里出现的 `next` 是 `next-themes`（主题库），
**不是 Next.js**。本地 clone 在 `/home/ail510/tian_wenyao/projects/oss/full-stack-fastapi-template`，
可自行复核。

模板 `backend/app/main.py` 里 `app.frontend("/", directory=FRONTEND_DIR)` 仍在，
即**单进程托管仍是官方做法**，正是 luup 采用的模式。

### luup 现状

`vite build` → 静态产物 → `backend/app/frontend` → FastAPI 单进程同端口托管。演示只需一个 uvicorn。

### Next 必然导致双进程

- `next start` 需常驻 Node 服务：双进程双端口。
- 静态导出（`output: 'export'`）走不通：`/runs/:id` 的 id 是**运行时时间戳、构建期不可枚举**，
  只能 catch-all + 客户端路由绕回 SPA——绕回 SPA 之后，Next 的价值随之消失。

### 代价与收益

代价：

- 21 条 Playwright e2e + 52 条 bun 单测重写。
- 偏离刻意对齐的官方模板，而对齐模板正是 2026-08-10 切栈的动机。
- 距 2026-09-05 截止仅 24 天，125 题全量批跑与技术报告尚未完成。

收益：SSR/ISR/RSC 对本项目（三页只读仪表台、数据来自本地 FastAPI）全部不适用，
**零用户可见收益**。

## 决定

赛期不换。前端保持 Vite + TanStack Router，构建产物由 FastAPI 单进程托管。

本决定**只否决「赛期切换」**，不否决赛后作为独立项目用 Next 重建。

## 后果

正：

- 交付面继续与上游模板同构，模板的后续改动可直接借鉴。
- 单进程、单端口、单命令启动，演示与部署路径最短。
- 现有 21 e2e + 52 单测继续有效，24 天全部留给 125 批跑与技术报告。

负：

- **用户明确表示更偏好 Next**，动机是 JD / 就业市场贴合，这是真实动机，不是偏好噪声。
  本决定把这个诉求推迟到赛后，未消灭它。
- 继续绑定 Vite 插件生态（见下条澄清）。

### 附带澄清：router-plugin 的 Vite 绑定不是缺陷

`@tanstack/router-plugin` 基于 unplugin，package exports 只有 `./vite`、`./rspack`、
`./webpack`、`./esbuild`——**没有 Bun bundler 适配器**。这确实把前端钉在这几个打包器里，
实际就是 Vite。

但**因为我们本就不打算离开 Vite，该锁定对 luup 成本为零**。它只是「用 bun build 替换 Vite
代价大」的原因（见 ADR-0002），不是待修缺陷。

## 何时重新审视

任一条成立即重开此决定：

- 竞赛交付完成后（2026-09-05 之后），届时代价侧的时间压力消失；
- 出现真实的 SSR / SEO / 多页需求；
- 单进程交付不再是约束（例如部署形态改为容器编排，双进程无额外成本）。
