# luup Agent App

Luup 是 TypeScript 全栈。**产品主轴（ADR-0013）是 Autoresearch**：Vercel AI SDK
（`ToolLoopAgent` + `@ai-sdk/react`）多 agent / sub-agent，多 Provider Responses
（OpenAI / DeepSeek / openai-compatible），浏览器工具走 `agent-browser`。
森林语义（ADR-0012）仍由宿主 Harness 硬闸拥有。

Science-125 五角色流水线（`@openai/agents` + 可选 Qwen/百炼）保留为 **legacy**。
新功能以 `apps/server/src/autoresearch/` 与 `/autoresearch` UI 为准；改 AI SDK
前先查安装版 `node_modules/ai/docs/`，不得凭记忆写旧 API。

运行时要求 Node.js >=24.20.0，包管理器使用 pnpm，单体工作区编排使用 Turborepo。

Python 栈已于 ADR-0004 退役，只存于 git 历史；源码注释里写着「Python 期」的路径都是历史坐标。

## 仓库布局

正常 TS 全栈 monorepo（ADR-0006，形制学 dsh：根零源码，通过 Turborepo + pnpm workspace 编排）：

```text
apps/server/  后端 `@luup/server`：src/（harness 本体 + 领域 + 工具 + 评估，按子系统分目录）
              + test/（vitest）+ tsconfig
apps/web/     Next.js 16 App Router（`@luup/frontend`）；`next.config.ts` 将同源 `/api` rewrite 到 API
apps/desktop/ Electron 壳 `@luup/desktop`（ADR-0014）：窗口 + 本机进程监督，默认开 /autoresearch
data/         science125.json，冻结题库，只读
docs/         产品契约、架构、判据、ADR、赛题与报告材料
memory/       跨 run 的战役记忆，文件事实源，append-only
```

根目录脚本是唯一入口（`pnpm run dev:api` / `batch` / `canary` 等都从根起跑，
cwd 相对路径 `data/`、`memory/`、`outputs/` 因此稳定）。

运行期事实存在 SQLite 单文件里（默认 `outputs/runtime/typescript-runs.db`，`LUUP_DATABASE`
可覆盖），不是目录制——`apps/server/src/store/` 是它的唯一写者。`outputs/` 是派生物，不入库。
历史批次证据（pilot/v2/v3 部分批与 Python 期 `runs/`）在 git tag
`archive/phase-a-evidence-20260816`，不在工作树（协议修订 #6）；正式批入库时重建 `runs-ts/`。

`apps/server/src/` 下的分区：`autoresearch/`（AI SDK 多 agent 编排，产品主轴）、
`agent/`（legacy 五角色契约/工具）、`api/`（对外投影）、`batch/`（125 题批跑，legacy）、
`campaign/`（战役记忆读写）、`domain/`（题库）、`eval/`（离线指标）、`seams/`（可替换接线；
`providers.ts` 是多 Provider 唯一读取点，`model.ts` 仍服务 legacy Qwen）、
`store/`（SQLite 事实存储，基于 Node 原生 `node:sqlite`）、`verify/`（B1–B4 确定性引用验收）。
`harness.ts`/`server.ts`/`roles.ts` 是 legacy 编排本体；autoresearch 的 coordinator/subagent
在 `autoresearch/orchestrator.ts`。

## seam 纪律

可替换的东西都收在 `apps/server/src/seams/`，宽度由类型系统兜底：
- Autoresearch：`seams/providers.ts` 是 `LUUP_PROVIDER` / `OPENAI_*` / `DEEPSEEK_*` /
  `LUUP_API_KEY` / `LUUP_BASE_URL` 的**唯一**读取点
- Legacy：`seams/model.ts` 仍独占 `QWEN_*`（过渡）
- 另有验收器、Run 记账面、记忆通道。换 provider 只改 seam，不动编排。

## 验证

```sh
pnpm install --frozen-lockfile
pnpm run ci             # typecheck → lint → format:check → build → test:coverage，与 CI 同序

# 各门单跑
pnpm run typecheck     # server + web TypeScript program，全量 (Turbo)
pnpm run lint          # oxlint（含 typeAware 档）
pnpm run format:check  # oxfmt 格式检查；pnpm run format 原地修复
pnpm run test          # vitest 全量测试
pnpm run test:coverage # server + web；functions/lines 地板各 80%，只许涨不许降
pnpm run build         # Next.js production build → apps/web/.next
pnpm run test:e2e      # Playwright；确定性 runtime，零 LLM 调用
```

CI 是 `.github/workflows/ts.yml` 的 `check`（=`pnpm run ci`）与 `e2e` 两个 job。
`check` 含双包 typecheck、oxlint、oxfmt、build、server/web 覆盖率门；`e2e` 另跑确定性双进程。

## 锚点

- Autoresearch 产品/架构：`docs/design/autoresearch.md`（ADR-0013）
- 桌面客户端：`docs/adr/0014-electron-desktop-client.md` · `apps/desktop/README.md`
- Legacy 验收判据：`docs/design/criteria.md`
- Legacy 架构：`docs/design/architecture.md`
- 预注册协议：`docs/design/experiment-protocol.json`（已注册内容不可改，改动必须走 amendment）
- 已定案、不再重提的决策：`docs/adr/`
- 领域词汇：`CONTEXT.md`
- Issue 流程：见本文件验证/锚点节；原 `docs/agents/` 已删（历史可查）

## Learned User Preferences

- 优先把现有技术栈用全、用精，而不是为现代化引入新依赖或平行工具链
- 测试要扎实、覆盖率尽量拉高；认真对待 CI，避免弄乱 main
- 多 agent / harness 协作按森林语义：默认真错、独立 critique、允许高拒收，仅 verified 有用才 merge 进共享知识面；拒绝公司式互相改稿
- 大块工作倾向并行 subagents 提案、由父 agent 做核实与合并
- 实质设计偏好自上而下：先 specs / 需求与架构接口，再往下分层；同类能力先想清模式再减少重复

## Learned Workspace Facts

- 前端现行栈是 Next.js App Router（`apps/web`），不再以 Vite/Remix 为当前方向
- Harness 方向已定案为森林理论（ADR-0012）：propose → critique → hard gate → merge；角色产出默认不信任
- 赛题结束后产品主轴切到 Autoresearch（ADR-0013）：AI SDK 多 Provider + subagent，而非继续独占 Qwen
- 桌面形态走 Electron 壳监督本机 Web/API（ADR-0014），不把 Next 塞进 Electron 同上下文
