# luup

面向《Science》125 前沿科学问题的科研 Agent：五个角色串行接力检索证据、生成假说、审阅证据、
形成研究计划并独立复审，最后由确定性 verifier 决定是否交付。

赛题：挑战杯揭榜挂帅 XH-202619，赛道一·方向一·维度 A。

## 设计边界

- `Agent = Model + Harness`；工具、状态、预算、证据与确定性验证由 Harness 拥有。
- 五阶段固定串行，两条上界（补证 ≤2 轮、修订 ≤2 轮）写在 `apps/server/src/harness.ts` 的控制流里，
  不交给任务依赖图算。
- 运行事实存 `bun:sqlite` 单文件；战役记忆 `memory/` 维持文件制，append-only。
- 公开运行状态固定为 `running → completed | review_rejected | failed`（`apps/server/src/store/schema.ts`）。
- Reviewer 必须检索到上游未见的新信息；无法证明即失败。

## 仓库

```text
apps/server/  后端 @luup/server：harness 本体、领域、工具、评估 + 用例
apps/web/     Vite/React 交付面 @luup/frontend，产物由同一个 Bun 进程托管
data/         science125.json，冻结题库
docs/         产品契约、架构、验收标准、ADR、赛题与报告材料
memory/       跨 run 的战役记忆（事实数据）
spikes/dsh/   deepseek-harness 参考学习件（ADR-0005），独立 workspace
```

历史批次证据在 git tag `archive/phase-a-evidence-20260816`（协议修订 #6）。

## 快速开始

需要 Bun 1.4.0（版本由 `packageManager` 与 `engines.bun` 共同固定）。

```sh
bun install --frozen-lockfile
```

凭据二选一。写进仓根 `.env`（Bun 从仓根自动加载，无需 export）：

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

单进程交付：一个 Bun 进程同端口给出 API 与页面，静态产物从 `apps/web/dist` 读。
**先 build 再起**——`dist` 不存在时 `/` 是 404（`/api` 不受影响）。

```sh
bun run build     # → apps/web/dist
bun run start     # http://127.0.0.1:8000，build 也会被它再跑一遍
```

开发用一条命令，前后端一起起（vite 热更新 + `/api` 代理到 8000）：

```sh
bun run dev       # 前端 http://127.0.0.1:5173 + API :8000（确定性 runtime，不花钱）
```

也可分开起：`bun run dev:api`（仅后端）、`bun run dev:web`（仅前端）。
`bun run dev:api:live` 是后端的 live 版本，会真的调 Qwen。

### API 合同与示例

默认 API 只绑定 `127.0.0.1`；`LUUP_RUNTIME=deterministic` 下不会调用模型。写接口只接受
`Content-Type: application/json`，因此复制下面的请求即可做零费用冒烟：

| 方法 | 路径                           | 作用                                         | 是否触发模型费用 |
| ---- | ------------------------------ | -------------------------------------------- | ---------------- |
| GET  | `/health` 或 `/api/health`     | 健康检查                                     | 否               |
| GET  | `/readyz` 或 `/api/readyz`     | 部署就绪检查（SQLite、live 凭据、API token） | 否               |
| GET  | `/api/config`                  | 查看 runtime、模型与凭据三态（不返回密钥）   | 否               |
| PUT  | `/api/config`                  | 设置本进程的 Qwen key/model/base URL 覆盖    | 后续 Run 会触发  |
| POST | `/api/runs`                    | 创建 Run，返回 `202` 与 `id`                 | 是（live 模式）  |
| POST | `/api/runs/:id/feedback`       | 首轮 Reviewer 执行期间提交一次研究者反馈     | 否               |
| GET  | `/api/runs/:id`                | 读取 Run、Attempt、Artifact 摘要与反馈状态   | 否               |
| GET  | `/api/runs/:id/events?after=0` | SSE 事件流，可用 `Last-Event-ID` 续读        | 否               |
| GET  | `/api/artifacts/:id`           | 读取公开 Artifact 投影                       | 否               |
| GET  | `/api/artifacts/:id/markdown`  | 读取研究计划 Markdown 投影                   | 否               |

```sh
BASE=http://127.0.0.1:8000
curl -sS "$BASE/api/health"
curl -sS -X POST "$BASE/api/runs" \
  -H 'content-type: application/json' \
  -d '{"question":"冻结证据能降低无来源引用吗？"}'
# 把上一步返回的 id 替换到下面两条命令：
curl -sS "$BASE/api/runs/<run_id>"
curl -N "$BASE/api/runs/<run_id>/events?after=0"
```

live 模式必须设置 `.env` 中的 `LUUP_API_TOKEN`，且 `POST /api/runs` 与 `PUT /api/config` 必须带；
deterministic 本地开发可不设置：

```sh
curl -sS -X POST "$BASE/api/runs" \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <LUUP_API_TOKEN>' \
  -d '{"question":"冻结证据能降低无来源引用吗？"}'
```

研究者反馈使用同一 Bearer token，只在首轮 Reviewer Attempt 仍为 `running` 时接受一次；反馈会作为
`feedback.received{source=researcher, feedback_source=human}` 持久化，并强制进入已有的第二轮计划修订。
终态 Run、其他角色阶段、第二轮或重复提交均明确返回 `409`，不会静默丢弃：

```sh
curl -sS -X POST "$BASE/api/runs/<run_id>/feedback" \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <LUUP_API_TOKEN>' \
  -d '{"feedback_id":"researcher-1","feedback":"补充失败结果对应的回退条件"}'
```

进程内同时执行/排队的 Run 默认最多 8 个（`LUUP_MAX_QUEUED_RUNS` 可调），满载返回 `429`；这只是
最后一道费用闸，不是公网身份系统或计费系统。当前 `main.ts` 仍默认绑定 loopback，Bun SQLite 也不能
直接作为 Cloudflare Worker 的持久化层；因此本仓此阶段不宣称已经完成公网部署，正式 API 地址、反向
代理/TLS、外部鉴权、持久化适配和限流策略仍是部署 blocker。

当前部署边界与 Cloudflare Tunnel runbook 见 [`docs/deployment.md`](docs/deployment.md)。

### SQLite 备份、校验与恢复

运行事实库必须用 SQLite 一致性快照操作，不能只复制主 `.db` 文件：

```sh
bun run db:verify -- --source outputs/runtime/typescript-runs.db
bun run db:backup -- \
  --source outputs/runtime/typescript-runs.db \
  --target outputs/backups/typescript-runs-$(date +%Y%m%d-%H%M%S).db
bun run db:restore -- \
  --source outputs/backups/typescript-runs-<timestamp>.db \
  --target outputs/restore/typescript-runs.db
```

`backup` 使用 SQLite `VACUUM INTO`，包含 WAL 中已提交事实；`verify` 执行
`integrity_check`、外键检查和 Luup 核心表/列检查。`backup` 与 `restore` 都拒绝覆盖已有目标，
`restore` 完成后会再次校验。正式操作前先停止批跑或确认写入窗口，备份文件和恢复目标都应位于持久磁盘。

### 跑题

正式 live 批跑要求 Bun 1.4.0；启动前会拒绝其他版本。`--dry-run` 只做规划，不受版本门限制。

```sh
bun run canary                              # 单题冒烟，走 live 模型并持久化证据
bun run batch --ids 1-125 --dry-run         # 先看计划，零执行
bun run batch --ids 1-125 --preflight --confirm-science125 --release-commit <40hex> \
  --db outputs/runtime/science125-formal.db  # 正式 Phase A 零费用就绪检查；不建库、不建 manifest
bun run batch --ids 3,54,61                 # 断点续跑：已交付的题自动跳过
bun run batch --ids 1-125 --confirm-science125 --release-commit <40hex> \
  --db outputs/runtime/science125-formal.db --concurrency 3  # 正式全量首次开跑
bun run batch --manifest-id <id> --confirm-science125 --release-commit <40hex> \
  --db outputs/runtime/science125-formal.db  # 正式全量续跑；只处理遗漏/未通过 durable gate 的题
bun run batch --ids 1,8,12,16,17,19,27,28,32,35,40,46,49,50,55,64,72,77,79,86,90,91,95,100,102,107,110,117,120,121 \
  --no-memory --confirm-memory-ablation --release-commit <40hex> \
  --db outputs/runtime/science125-formal.db --concurrency 3  # 预注册 Phase B 记忆消融臂；与 Phase A 配对
bun run batch:export --manifest-id <id> \
  --db outputs/runtime/typescript-runs.db \
  --out outputs/submission/science125-index.json  # 只导出逐题索引，不复制正文
bun run batch:export --manifest-id <id> \
  --db outputs/runtime/science125-formal.db \
  --out outputs/submission/science125-index.json \
  --require-science125  # 严格要求完整的 1–125；失败仍写诊断索引
bun run usage:export -- \
  --db outputs/runtime/typescript-runs.db \
  --out outputs/submission/usage.jsonl \
  --markdown outputs/submission/usage.md  # 无价格配置时成本保持 N/A
bun run usage:export -- \
  --db outputs/runtime/science125-formal.db --manifest-id <id> \
  --out outputs/submission/science125-usage.jsonl \
  --markdown outputs/submission/science125-usage.md  # 只读该 manifest 的有效 Run
bun run usage:export -- \
  --db outputs/runtime/typescript-runs.db \
  --out outputs/submission/usage.jsonl \
  --input-price-per-million <input单价> \
  --output-price-per-million <output单价> \
  --currency CNY --model <Qwen模型> \
  --price-source '<官方价目表/控制台凭证>'
bun run eval --db outputs/runtime/typescript-runs.db   # 全库离线指标，不调模型
bun run eval --db outputs/runtime/science125-formal.db --manifest-id <id> \
  --out outputs/submission/science125-metrics.md      # 只读该 manifest 的有效 Run
bun run score --db outputs/runtime/typescript-runs.db --out outputs/scoring.md
bun run score --db outputs/runtime/science125-formal.db --manifest-id <id> \
  --out outputs/submission/science125-scoring.md       # 只读该 manifest 的有效 Run
bun run submission:check -- outputs/submission/编号-学校-申报人姓名-作品名称.pdf
bun run submission:case -- --db /private/tmp/luup-science125-canary-final-20260822.db \
  --run-id <run_id> --out outputs/submission/science125-representative-case.json \
  --strict  # 严格要求冻结题号、completed、两轮反馈/修订、B1–B4 和用量事实
```

批跑默认写 `outputs/runtime/typescript-runs.db`，`--db` 或 `LUUP_DATABASE` 可改。
Canary 默认写 `outputs/runtime/canary.db`，并在 stdout 返回 `database` 与 `run_id`；可用
`LUUP_DATABASE` 改写位置。除非只做临时诊断，不要把 live canary 指到 `:memory:`。
每次 live 批跑都会在执行前输出 durable `manifestId`；纯 `--ids ... --dry-run` 使用内存规划且不创建
SQLite 或 manifest。使用 `--manifest-id` 时可省略 `--ids`，若同时提供则必须与原 manifest 的题集完全一致。
`--preflight` 复用正式付费启动门，额外检查 Bun 1.4.0、题库、确认参数、Qwen 凭据、clean release commit
以及 Phase A 的 fresh DB/sidecar（Phase B 则核对预注册 30 题），输出结构化 admitted plan 后退出；它不会打开
SQLite、创建 manifest、构造 executor 或调用模型。它不能与 `--dry-run` 或 `--manifest-id` 混用：resume 的
source/arm/terminal 一致性必须开库核对，不能伪装成零副作用检查。
非 dry-run 且题集恰为 1–125 时必须显式传 `--confirm-science125`。首次正式全量开跑还要求 Git source
identity 可取得、工作树 clean，并拒绝目标 DB 或任何 SQLite/writer-lock sidecar 已存在。正式全量续跑
还要求当前工作树 clean、commit 与 manifest 已有 Run 一致，且 memory arm 与本次 `--no-memory` 选择一致；
空 manifest 只校验当前 source identity。dry-run 与非全量题集不受此保护影响。
正式 Phase A 与付费 Phase B（含 resume）还必须传 `--release-commit <40hex>`；它必须精确等于当前 clean
source identity 的 commit。入口会在读取模型凭据或打开 SQLite 前拒绝缺失、格式错误或不匹配的值。
非 dry-run 的 `--no-memory` 是付费消融，必须显式传 `--confirm-memory-ablation`，且 `--ids` 的集合必须精确对应
`docs/design/experiment-protocol.json` 的 `phase_b_subset.question_ids`（当前为上述 30 题）；即使续跑也不能省略
`--ids`。开库前会要求当前 source identity 可取得且 tree clean；续跑还要求已有 Run 与当前 commit、clean 状态一致，
且 `memoryArm=off`。该臂允许复用 Phase A 的 SQLite 以形成配对，completed skip 按 memory arm 隔离。
Manifest 只有在每条记录都能回查到同题号的 SQLite 终态 Run 时才 complete；`success` 只接受 `completed`，`human_review` 只接受 `review_rejected`。
`batch:export` 从指定 manifest 和 SQLite 事实生成机器可读 JSON：每个 expected ID 恰好一行，
显式列出 `success`、`partial`、`failure`、`human_review`、`omitted`、`invalid`、聚合 counts、
Run ID 与相对 API 链接；它不嵌入问题正文或 Artifact 正文。默认模式保留诊断导出；`--require-science125`
另加官方门：expected IDs 必须精确为 1–125，manifest 必须 complete 且没有 invalid、omitted、duplicate、unexpected
记录。严格门失败时命令返回非零，但仍写出索引供审计。

`usage:export` 从 SQLite 的 `sdk.usage` 事件生成 JSONL 和可选 Markdown：逐 Attempt、逐角色、逐 Run、逐题，
并保留未知用量为 `null`。它不会从模型名或网络环境推断价格；只有同时显式提供 input/output 每百万 token 单价、
币种、模型和价格来源时才计算成本，并在每条成本记录中标明三者。缺少任一项时成本为 `N/A`，不会伪造 `¥0`。
给 `usage:export`、`eval` 或 `score` 传 `--manifest-id` 时，三者只读取该 manifest 关联且能回查到同题号、匹配终态的有效 Run；
报告会写出 manifest ID、纳入数量和被排除的 DB Run 数/ID。manifest 不存在或没有有效 Run 时命令非零退出，避免把空 cohort 当成结果。
不传该参数仍保持全库读取口径。

`submission:check` 只对单个 PDF/MP4 做确定性检查：文件名四段、PDF 文件头/页数/200 MiB、MP4 文件头/`mvhd`
时长/10 分钟。PPTX/DOCX、身份水印、盖章报名表、Qwen 凭证、125 逐题是否真实完成仍会明确列为人工/材料检查，
checker 不会把这些缺失项伪装成通过。

`submission:case` 从指定 SQLite `runId` 生成同目录的 JSON 与 Markdown 代表性案例；它保留题号、终态、两轮
原始 Artifact ID、反馈来源、修订字段、评分/用量/限制变化和 B1–B4 验收计数，并通过与公开 API 相同的白名单
投影输出候选比较、两轮研究计划和评审反馈。prompt、内部 rationale、工具原始返回、内部错误正文或凭证不会进入
导出；失败、缺失和 unknown 会显式保留。该命令只读 SQLite，不会启动模型。默认模式仍是诊断模式；`--strict`
要求 science125_id 属冻结题库、Run 已 completed、round1/round2 及 feedback/revision 事实齐全、verification 事件含
B1/B2/B3/B4 且均通过、用量记录完整。严格门失败会在 JSON 中保留 `strict.reasons` 并返回非零。

## 验证

```sh
bun run ci            # typecheck → lint → format:check → knip → build → test:coverage，与 CI 同序
bun run test:e2e      # Playwright；首次先 bunx playwright install chromium
```

各门单跑与 seam 纪律见 `AGENTS.md`。

## 运行工件

每个 run 在 SQLite 里至少留下：冻结的问题、逐阶段 Attempt 与 Artifact、证据台账
（每次检索的 query、结果与结局）、事件流、token 用量、终态与失败分类。
`apps/server/src/api/projection.ts` 是它对外的字段 allowlist——审计字段不出网。

引用只允许使用本 run 已经通过 arXiv 或 DOI/Crossref 实检并落库的 paper card；标题、作者、第一作者与数量由
`apps/server/src/verify/` 的 B1–B4 fail-closed 验证。

## 文档

- 产品契约：`docs/design/product-contract.md`
- 当前架构：`docs/design/architecture.md`
- 验收标准：`docs/design/criteria.md`
- 预注册协议：`docs/design/experiment-protocol.json`
- 已定案决策：`docs/adr/`
- 赛题原文：`docs/specs/`
