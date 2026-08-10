# luup

面向《Science》125 前沿科学问题的 AI Scientist：master agent 监督四个互不信任的 subagent（文献挖掘 → 假设生成 → 批判 → 计划撰写），逐项认证、不合格打回，产出引用经确定性反查的《科学假设与研究计划》（10 标准字段）。

赛题：挑战杯揭榜挂帅 XH-202619 赛道一·方向一·维度A。

## 栈

- [OpenAI Agents SDK](https://openai.github.io/openai-agents-js/)（`@openai/agents`：Agent / tool / run，agent-as-tool 派工）
- `openai` SDK → 阿里云百炼 Qwen（`qwen3.7-plus`，OpenAI Responses 协议直连，`enable_thinking` 走 fetch 兼容层）
- zod 4（工具参数 + 产物契约 + strict schema）
- 文献：arXiv API + 文件式 memory（indexing + summarization），无 vector DB
- Next.js 16 + Tailwind 4（web 交付面）；Node 26（直跑 TS）、pnpm

## Compatibility set

`@openai/agents` 内部依赖 `openai`，两者必须解析到**同一个版本**（Model 接口按实例类型对齐，
双版本共存直接类型不兼容）。升级时以 `@openai/agents` 的 dependencies 为准对齐 `openai`，
再跑 `pnpm validate`。

| 包 | 版本 |
|---|---|
| `@openai/agents` | ^0.14.3 |
| `openai` | ^6.49.0（对齐 agents 0.14.3 的内部依赖；agents 升到依赖 v7 时一起动） |
| `zod` | 4.4.3（agents peer：^4.0.0） |

## 快速开始

```sh
pnpm install
# .env：QWEN_API_KEY=...  QWEN_BASE_URL=...（百炼 OpenAI 兼容端点）

pnpm run:pipeline                  # 跑默认题（Science-125 #61）
pnpm run:pipeline "<问题原文>"      # 自由问题
pnpm run:batch 54 125              # 按 Science-125 题号批量
pnpm verify runs/<ts>              # 独立验收（schema + 引用逐条反查 arXiv，零 LLM）
```

## 评估体系（criteria H）

四条纪律：**gate 全确定性，judge 只产诊断分**；**rubric 永不进 agent prompt**（防 Goodhart，由
`pnpm selftest:metrics` 逐字扫 `agent/` 全树把关）；指标只从已有工件派生（零新增采集）；
每个指标必须能翻盘一个真实决定。

```sh
pnpm stats                    # Tier1：M4 交付率 / M5 Pass^2 / M6 成本 / M7 返工 / M8 文献健康
                              #   零 LLM、零网络 → runs/stats.md
pnpm score runs/<ts>          # M9 四维四级 rubric 打分（1 次 judge 调用）→ runs/<ts>/score.json
                              #   题页 memory 只回传事实（胜出假设、关键断言），不回传分数
pnpm calibrate runs/<ts>      # M10 变异体检出率（1 + 5 次 judge 调用）→ runs/<ts>/calibration.md
pnpm selftest:metrics         # 上述全部的零 API 自测（含对现有 runs/ 的可复算断言）
```

judge 与被测 agent 同族（criteria D1 锁死百炼 Qwen），同族自评偏置无法用换族 judge 消解 ——
处置是**结构性降权**：M9 是诊断分，永不进 gate、永不进技术报告的「成绩」栏。

M10 首次实测（`runs/20260808-134046/calibration.md`）：**检出 0/4**，同一份 proposal 三次采样
得分 20/21/22，而变异体效应量落在 −2…+1 —— judge 的自噪声带比它要测的差异还宽。据此
master 2026-08-09 裁决：择优字典序 = **交付 gate（只认确定性判据）→ M9 总分（tie-break）
→ refs → token 升序 → run id**；**M9 的 veto 从 gate 降为 advisory**，只在 stats 的
「⚠ M9 诊断」列展示，不再否掉任何版本。`score.json` 原样保留 veto 字段（动决策权，不动数据）。

## 交付面（Next.js 单项目）

agent 与 web 是**同一个项目**：仓库根既是流水线代码根（`agent/`、`scripts/`），也是 Next
项目根（`app/`、`components/`、`lib/`）。流水线经 `POST /api/runs` 起 `scripts/run.ts`
子进程，web 只读 `runs/` 文件——两侧只有进程边界，没有模块耦合。

```sh
pnpm dev        # next dev → http://localhost:3000
pnpm build      # next build
pnpm start      # next start（生产，单进程）
pnpm validate   # tsgo 全量 typecheck + agent 装配自测（selftest-agents）
pnpm eval:smoke # 冒烟：1 次真调用，验证模型接线与 master 服从性
pnpm eval:full  # 全链路：真跑一题 + 契约/离线验收 gates（≈20 分钟，花真钱）
```

| 路由 | 用途 |
|---|---|
| `/`、`/runs`、`/runs/<id>` | 仪表台 / 历史 / 单 run（SSR 读 `runs/`） |
| `GET /api/runs`、`POST /api/runs` | 列表；触发 pipeline（同源 + `application/json` 双重 CSRF 门） |
| `GET /api/runs/<id>[?view=status\|artifact=<f>]` | run 详情 / 状态视图 / 工件正文（`text/plain`，越界即 400） |
| `GET /api/science125` | `lib/science125.json`（125 题） |

## 运行产物（runs/<ts>/）

| 文件 | 内容 |
|------|------|
| evidence.md / hypotheses.md / critique.json | 各节点 handoff 工件 |
| proposal.{json,md} | 10 字段《科学假设与研究计划》 |
| verdicts/*.json | master 逐节点认证记录（pass/reject + 逐项理由） |
| memory/papers/、memory/index.md | 本次运行实检的 arXiv 文献卡与索引 |
| verification-report.md | 确定性验收报告（A/B1–B4 逐项） |
| FAILED.md | 预算耗尽时的如实失败报告（成功则无） |
| usage.jsonl | 每次模型调用的 token 用量（D1 凭证 + M6 成本会计的数据源） |
| score.json | M9 诊断分 + 断言归因 + veto 位（跑过 `pnpm score` 才有；**全部不进 gate**） |
| calibration.md | M10 变异体检出率（跑过 `pnpm calibrate` 才有） |

评估层自己的 judge 调用落在 `runs/.eval/usage.jsonl` —— 点开头，不被当成一次 run，
评估开销与被评估开销不混账。

## 引用防虚构（四道防线）

1. `arxiv_save` 只收 id，元数据从 arXiv 实取，模型不能手填
2. References 仅允许本次运行落盘的文献 id（确定性代码校验）
3. pipeline 内 `verify_references`：master 拿不到 `ok:true` 不得宣布成功
4. 离线验收器重放：标题重合度 ≥0.8 + 作者姓氏/第一作者核验（B4）

## 文档

- 架构与判据：`docs/design/architecture.md`、`docs/design/criteria.md`
- 节点 instructions：`docs/design/prompts.md`（agent/ 下为接线后的实体）
- 赛题原文：`docs/specs/`
