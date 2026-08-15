# luup

面向《Science》125 前沿科学问题的科研 Agent：五个角色串行接力检索证据、生成假说、审阅证据、
形成研究计划并独立复审，最后由确定性 verifier 决定是否交付。

赛题：挑战杯揭榜挂帅 XH-202619，赛道一·方向一·维度 A。

## 设计边界

- `Agent = Model + Harness`；工具、状态、预算、证据与确定性验证由 Harness 拥有。
- 五阶段固定串行，两条上界（补证 ≤2 轮、修订 ≤2 轮）写在 `src/harness.ts` 的控制流里，
  不交给任务依赖图算。
- 运行事实存 `node:sqlite` 单文件；战役记忆 `memory/` 维持文件制，append-only。
- 公开运行状态固定为 `running → completed | review_rejected | failed`（`src/store/schema.ts`）。
- Reviewer 必须检索到上游未见的新信息；无法证明即失败。

## 仓库

```text
src/       harness 本体、领域、工具、评估（根单包）
apps/web/  Vite/React 交付面，产物由同一个 Node 进程托管
data/      science125.json，冻结题库
docs/      产品契约、架构、验收标准、ADR、赛题与报告材料
runs-ts/   Phase A 批跑的证据归档
runs/      Python 期运行归档，只读（ADR-0004）
memory/    跨 run 的战役记忆（事实数据）
```

## 快速开始

需要 Node 24（见 `.nvmrc`）与 pnpm 11（`corepack enable pnpm` 即可，版本从 `packageManager` 读）。

```sh
pnpm install --frozen-lockfile
```

凭据二选一。写进仓根 `.env`（每个入口都带 `--env-file-if-exists=.env`，无需 export）：

```sh
cp .env.example .env   # 填 QWEN_API_KEY / QWEN_BASE_URL
```

或直接 export 系统环境变量——同名时**系统环境变量优先**，`.env` 只是兜底：

```sh
export QWEN_API_KEY='your-key'
export QWEN_BASE_URL='your-openai-compatible-base-url'
```

`LUUP_RUNTIME=deterministic` 用内置替身跑完整条流水线，不发一次模型请求，也不需要凭据。

### 起服务

单进程交付：一个 Node 进程同端口给出 API 与页面，静态产物从 `apps/web/dist` 读。
**先 build 再起**——`dist` 不存在时 `/` 是 404（`/api` 不受影响）。

```sh
pnpm build     # → apps/web/dist
pnpm start     # http://127.0.0.1:8000，build 也会被它再跑一遍
```

改前端时用 dev server（`/api` 代理到 8000），另一终端起 API：

```sh
pnpm dev:api   # 确定性 runtime，不花钱
pnpm dev       # http://127.0.0.1:5173
```

`pnpm dev:api:live` 是同一个服务的 live 版本，会真的调 Qwen。

### 跑题

```sh
pnpm canary                              # 单题冒烟，走 live 模型
pnpm batch --ids 1-125 --dry-run         # 先看计划，零执行
pnpm batch --ids 3,54,61                 # 串行、断点续跑：已交付的题自动跳过
pnpm batch --ids 1-30 --no-memory        # 记忆消融臂
pnpm eval --db outputs/runtime/typescript-runs.db   # 离线指标，不调模型
```

批跑默认写 `outputs/runtime/typescript-runs.db`，`--db` 或 `LUUP_DATABASE` 可改。

## 验证

```sh
pnpm run ci            # typecheck → lint → build → test:coverage，与 CI 同序
pnpm run test:e2e      # Playwright；首次先 pnpm --filter @luup/frontend exec playwright install chromium
```

各门单跑与 seam 纪律见 `AGENTS.md`。

## 运行工件

每个 run 在 SQLite 里至少留下：冻结的问题、逐阶段 Attempt 与 Artifact、证据台账
（每次检索的 query、结果与结局）、事件流、token 用量、终态与失败分类。
`src/api/projection.ts` 是它对外的字段 allowlist——审计字段不出网。

引用只允许使用本 run 已经 arXiv 实检并落库的 paper card；标题、作者、第一作者与数量由
`src/verify/` 的 B1–B4 fail-closed 验证。

## 文档

- 产品契约：`docs/design/product-contract.md`
- 当前架构：`docs/design/architecture.md`
- 验收标准：`docs/design/criteria.md`
- 预注册协议：`docs/design/experiment-protocol.json`
- 已定案决策：`docs/adr/`
- 赛题原文：`docs/specs/`
