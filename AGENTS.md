# luup Agent App

Luup 是 TypeScript 全栈：`@openai/agents` 驱动 Qwen，走百炼的 OpenAI-compatible 端点。
运行时要求 Node.js >=24.20.0，包管理器使用 pnpm，单体工作区编排使用 Turborepo。
修改模型或 Agent 前先查 <https://openai.github.io/openai-agents-js/>，不得回退到默认 OpenAI 客户端。

Python 栈已于 ADR-0004 退役，只存于 git 历史；源码注释里写着「Python 期」的路径都是历史坐标。

## 仓库布局

正常 TS 全栈 monorepo（ADR-0006，形制学 dsh：根零源码，通过 Turborepo + pnpm workspace 编排）：

```text
apps/server/ 后端 `@luup/server`：src/（harness 本体 + 领域 + 工具 + 评估，按子系统分目录）
             + test/（vitest）+ tsconfig
apps/web/    Next.js 16 App Router（`@luup/frontend`），独立 Web 应用；`next.config.ts` 将同源 `/api` rewrite 到 `apps/server`
data/        science125.json，冻结题库，只读
docs/        产品契约、架构、判据、ADR、赛题与报告材料
memory/      跨 run 的战役记忆，文件事实源，append-only
```

根目录脚本是唯一入口（`pnpm run dev:api` / `batch` / `canary` 等都从根起跑，
cwd 相对路径 `data/`、`memory/`、`outputs/` 因此稳定）。

运行期事实存在 SQLite 单文件里（默认 `outputs/runtime/typescript-runs.db`，`LUUP_DATABASE`
可覆盖），不是目录制——`apps/server/src/store/` 是它的唯一写者。`outputs/` 是派生物，不入库。
历史批次证据（pilot/v2/v3 部分批与 Python 期 `runs/`）在 git tag
`archive/phase-a-evidence-20260816`，不在工作树（协议修订 #6）；正式批入库时重建 `runs-ts/`。

`apps/server/src/` 下的分区：`agent/`（角色契约、工具、失败分类）、`api/`（对外投影）、`batch/`（125 题批跑）、
`campaign/`（战役记忆读写）、`domain/`（题库）、`eval/`（离线指标）、`seams/`（可替换接线）、
`store/`（SQLite 事实存储，基于 Node 原生 `node:sqlite`）、`verify/`（B1–B4 确定性引用验收）。
`harness.ts`/`server.ts`/`roles.ts` 是编排本体——harness 是运行时角色，不是子目录。

## seam 纪律

可替换的东西都收在 `apps/server/src/seams/`，宽度由类型系统兜底：模型接线（`seams/model.ts` 是
`QWEN_*` / `LUUP_MODEL_ID` 的**唯一**读取点，别处不碰 `process.env.QWEN_*`）、验收器、
Run 记账面、记忆通道。换 provider 只改 seam，不动编排。

## 验证

```sh
pnpm install --frozen-lockfile
pnpm run ci             # typecheck → lint → format:check → build → test:coverage，与 CI 同序

# 各门单跑
pnpm run typecheck     # server + web TypeScript program，全量 (Turbo)
pnpm run lint          # oxlint（含 typeAware 档）
pnpm run format:check  # oxfmt 格式检查；pnpm run format 原地修复
pnpm run test          # vitest 全量测试
pnpm run test:coverage # 覆盖率地板 80%，只许涨不许降
pnpm run build         # Next.js production build → apps/web/.next
pnpm run test:e2e      # Playwright；确定性 runtime，零 LLM 调用
```

CI 是 `.github/workflows/ts.yml` 的 `check` 与 `e2e` 两个 job，门与上面逐条对应。

## 锚点

- 验收判据：`docs/design/criteria.md`
- 架构：`docs/design/architecture.md`
- 预注册协议：`docs/design/experiment-protocol.json`（已注册内容不可改，改动必须走 amendment）
- 已定案、不再重提的决策：`docs/adr/`
- 领域词汇：`CONTEXT.md`
- Issue 流程：见本文件验证/锚点节；原 `docs/agents/` 已删（历史可查）
