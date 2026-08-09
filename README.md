# luup

面向《Science》125 前沿科学问题的 AI Scientist：master agent 监督四个互不信任的 subagent（文献挖掘 → 假设生成 → 批判 → 计划撰写），逐项认证、不合格打回，产出引用经确定性反查的《科学假设与研究计划》（10 标准字段）。

赛题：挑战杯揭榜挂帅 XH-202619 赛道一·方向一·维度A。

## 栈

- [eve](https://eve.dev)（declared subagents / tools / headless invoke）
- AI SDK `@ai-sdk/openai` `.responses()` → 阿里云百炼 Qwen（`qwen3.7-plus`，OpenAI Responses API）
- 文献：arXiv API + 文件式 memory（indexing + summarization），无 vector DB
- Node 26（直跑 TS）、pnpm

## Compatibility set

eve 与 AI SDK 处在 canary 期，四者是一组**联动版本**：eve 的 peer 约束锁 `ai`，`ai` 的内部接口锁 `@ai-sdk/openai`，两者的 schema 层锁 `zod`。全部精确 pin，升级时**必须四个一起动**并重跑 `pnpm validate`；单独升任何一个都可能编不过或在运行期静默行为漂移。

| 包 | 版本 |
|---|---|
| `eve` | 0.31.3 |
| `ai` | 7.0.0-canary.171 |
| `@ai-sdk/openai` | 4.0.0-canary.73 |
| `zod` | 4.4.3 |

## 快速开始

```sh
pnpm install
# .env：QWEN_API_KEY=...  QWEN_BASE_URL=...（百炼 OpenAI 兼容端点）

pnpm run:pipeline                  # 跑默认题（Science-125 #61）
pnpm run:pipeline "<问题原文>"      # 自由问题
pnpm run:batch 54 125              # 按 Science-125 题号批量
pnpm verify runs/<ts>              # 独立验收（schema + 引用逐条反查 arXiv，零 LLM）
```

## 交付面（Next.js + eve 单项目）

`next.config.ts` 用 `withEve()` 包裹，agent 与 web 是**同一个项目**：仓库根既是 eve app root（`agent/`），
也是 Next 项目根（`app/`、`components/`、`lib/`）。eve 的 `/eve/v1/*` 与我们自己的 `/api/*` 同源共存。

```sh
pnpm dev        # next dev：同时拉起 eve dev 并把 /eve/v1/* rewrite 过去 → http://localhost:3000
pnpm dev:eve    # 只跑 agent（TUI/headless），不要 web
pnpm build      # eve build && next build
pnpm validate   # tsgo 全量 typecheck + eve info
```

生产（本机）要**同时**起两个进程——`withEve()` 只做反向代理，不代管 eve 进程：

```sh
pnpm build
pnpm start:eve &   # eve start --host 127.0.0.1 --port 4274（EVE_NEXT_PRODUCTION_PORT 默认值）
pnpm start         # next start，把 /eve/v1/* 代理到 4274
```

| 路由 | 用途 |
|---|---|
| `/`、`/runs`、`/runs/<id>` | 仪表台 / 历史 / 单 run（SSR 读 `runs/`） |
| `GET /api/runs`、`POST /api/runs` | 列表；触发 pipeline（同源 + `application/json` 双重 CSRF 门） |
| `GET /api/runs/<id>[?view=status\|artifact=<f>]` | run 详情 / 状态视图 / 工件正文（`text/plain`，越界即 400） |
| `GET /api/science125` | `lib/science125.json`（125 题） |
| `/eve/v1/*` | eve channel，由 `withEve()` 挂载 |

## 运行产物（runs/<ts>/）

| 文件 | 内容 |
|------|------|
| evidence.md / hypotheses.md / critique.json | 各节点 handoff 工件 |
| proposal.{json,md} | 10 字段《科学假设与研究计划》 |
| verdicts/*.json | master 逐节点认证记录（pass/reject + 逐项理由） |
| memory/papers/、memory/index.md | 本次运行实检的 arXiv 文献卡与索引 |
| verification-report.md | 确定性验收报告（A/B1–B4 逐项） |
| FAILED.md | 预算耗尽时的如实失败报告（成功则无） |

## 引用防虚构（四道防线）

1. `arxiv_save` 只收 id，元数据从 arXiv 实取，模型不能手填
2. References 仅允许本次运行落盘的文献 id（确定性代码校验）
3. pipeline 内 `verify_references`：master 拿不到 `ok:true` 不得宣布成功
4. 离线验收器重放：标题重合度 ≥0.8 + 作者姓氏/第一作者核验（B4）

## 文档

- 架构与判据：`docs/design/architecture.md`、`docs/design/criteria.md`
- 节点 instructions：`docs/design/prompts.md`（agent/ 下为接线后的实体）
- 赛题原文：`docs/specs/`
