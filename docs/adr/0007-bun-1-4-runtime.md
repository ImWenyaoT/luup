# ADR-0007 · Bun 1.4 统一运行时与工具链

## 状态

**已被 [ADR-0009](0009-node-pnpm-runtime.md) 取代**，2026-08-28。下文保留为历史决策记录。
本 ADR 曾于 2026-08-21 接受，并取代 ADR-0002 中“不采纳 `--bun` 运行时”的结论。

## 背景

Luup 的目标不是让 Node 项目“也能被 Bun 启动”，而是以 Bun 为唯一 JavaScript 运行时。
继续保留 Node HTTP、Node SQLite、pnpm 和 Vitest 会形成两套隐含语义，也无法证明 Science-125
正式批跑使用的就是开发和 CI 验收过的执行栈。

ADR-0002 的测量对象是已经退役的旧前端形态。当前仓库是 Vite/React 交付面与 TypeScript Harness，
且用户于 2026-08-21 明确重开并裁决运行时边界，因此旧结论不再约束当前实现。

## 决定

- 固定 Bun 1.4.0；`packageManager`、`engines.bun` 与 CI 只从这一版本事实源读取。
- Bun 负责依赖安装、workspace 脚本、TypeScript 源码运行与单元测试。
- HTTP 服务使用 `Bun.serve`，SQLite 使用 `bun:sqlite`，测试使用 `bun:test`。
- 仓库只保留 `bun.lock`；删除 pnpm lock/workspace 与 Node 版本文件。
- Vite、TypeScript、oxlint、oxfmt、knip 继续各自负责构建、类型、静态检查与死代码门；
  “Bun 唯一运行时”不等于重写成熟的静态工具。
- Playwright 继续做真实浏览器验收，但它启动和管理的应用进程必须是 Bun。

## 后果

正：开发、CI、API、批跑与测试共享同一运行时；Node/Bun 差异不再被兼容层静默掩盖。

负：Bun 原生 API 使服务端源码不再支持 Node 直接执行。这是目标边界，不提供降级路径。

## 验收

`bun install --frozen-lockfile`、`bun run ci` 与 `bun run test:e2e` 全绿；仓库的现行配置与源码主路径中
不得残留 pnpm、Vitest、`node:http`、`node:sqlite` 或 Node 版本门。
