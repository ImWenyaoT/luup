# ADR-0009 · Node.js 能力范围与 pnpm 统一运行时

## 状态

已接受，2026-08-28。取代 ADR-0007 的“Bun 唯一运行时”结论；ADR-0007 保留为历史决策记录。

## 背景

现行仓库已经不满足 ADR-0007 的验收条件：根包声明 `engines.node ^22.13.0 || >=23.4.0` 与
`packageManager=pnpm@10.5.0`，工作区由 `pnpm-workspace.yaml` 和 Turborepo 编排，CI 在 Node.js 22.13.0
上执行 `pnpm install --frozen-lockfile` 与 `pnpm run ci`。服务端使用 `node:sqlite`、
`@hono/node-server` 和 `tsx`，单元测试使用 Vitest；仓库不存在 Bun 版本门、`bun.lock`、
`Bun.serve`、`bun:sqlite` 或 `bun:test` 的现行实现。

`node:sqlite` 在 Node.js 22.5.0 加入；22 分支到 22.13.0、23 分支到 23.4.0 才无需
`--experimental-sqlite` 即可使用。因此不能用一个跨主版本的 `>=22.13.0`：那会错误接纳
23.0–23.3；精确能力范围是 `^22.13.0 || >=23.4.0`。

继续把 ADR-0007 标成当前决策会让开发命令、正式批跑门和可复现报告彼此冲突。这里记录已经落地的
执行事实，不追改 ADR-0007 或预注册协议中的历史坐标。

## 决定

- API、Harness、批跑、评估与测试支持 Node.js 22.13+、23.4+ 与更高主版本；正式 live batch
  在读取模型凭据或打开数据库前拒绝 22.0–22.12、23.0–23.3、更低主版本和畸形版本字符串。
- pnpm 10.5.0 是唯一包管理器，`package.json#packageManager`、`pnpm-lock.yaml` 与
  `pnpm-workspace.yaml` 是安装和 workspace 事实源；Turborepo 只负责编排。
- TypeScript 源码入口由 `tsx` 执行；HTTP 适配使用 Node server，事实存储使用 `node:sqlite`，
  单元测试使用 Vitest，浏览器验收使用 Playwright。
- 不保留 Bun 兼容层或双份脚本。ADR-0007 与实验协议修订 #7 中的 Bun 命令只作为历史坐标保留；
  当前命令以根 `package.json` 与 README 为准。

## 后果

正：开发、CI、部署、正式批跑和报告重新指向同一套已实际运行的工具链；Node 原生 SQLite 与现有
持久化实现无需兼容适配。

负：ADR-0007 主张的 Bun 原生 API 与单锁文件目标不再成立；如再次切换运行时，必须另立 ADR，
同时追加实验协议 amendment，不能直接改写历史记录。

## 验收

- `pnpm install --frozen-lockfile`、`pnpm run ci` 与 `pnpm run test:e2e` 全绿；
- CI 显式安装最低受支持版本 Node.js 22.13.0 和 pnpm，且不安装 Bun；
- 正式 live batch 的 Node.js 能力门、clean release commit 门与 Phase A/B cohort 门继续 fail-closed；
- 现行产品合同、架构与报告只把 Node.js/pnpm 写作当前事实。
