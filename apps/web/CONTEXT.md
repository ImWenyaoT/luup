# Understand the Web context

This file defines the ownership rules for the `frontend` workspace.

## Thin frontend

Web 是 Vite + React 单页应用，展示 Harness 的 Run snapshot、Server-Sent Events (SSE)、Artifact 和允许命令。开发时 Vite dev server 把 `/api` 和 `/health` 代理到后端；生产时构建产物是静态文件。Web 不拥有 Agent、Task、Attempt、Artifact、工具执行、SQLite 或完成判断。

页面只显示研究问题、Run 进度、工具证据和冻结 Artifact。比赛背景和架构说明属于 `docs/`。不要把 Web 扩展为软件即服务 (SaaS) 工作台。

## Styling

Tailwind CSS v4 加 shadcn/ui (Base UI)。布局和外观写在组件的工具类里，`src/index.css` 只声明主题令牌。Tailwind 曾经被移除过一次，原因是它只覆盖了五个小组件、其余 900 行仍是手写 CSS，两套系统并存。回归的前提正是这一点：**要么全用工具类，要么别用**。新增样式不要再往 `index.css` 里加规则。

## Browser-safe observability projection

Harness 的内部 snapshot、Event 和 Artifact 包含审计与恢复数据。后端使用字段 allowlist 生成 public view，Web 只消费该 public view。`src/types.ts` 声明这个 public view 的 wire type，不得从服务端模块导入类型。

Activity 默认只显示可验证、可操作的阶段 Event。查询、版本和 Event type 只显示在展开的技术详情中。Web 不得发送 `rationale`、instructions、chain of thought、原始 payload、stack trace、idempotency key、credential 或本地 path。未知字段默认不公开。
