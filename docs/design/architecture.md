# luup 架构设计

赛题 XH-202619 赛道一·方向一·A。验收锚点见 [criteria.md](criteria.md)。

> 本文记录当前 Ultra 实现，不能作为需求来源。Pro 简化的目标、保留项与删除候选以 [product-contract.md](product-contract.md) 为准；在消融实验完成前不继续扩张本文架构。

## 一句话

master agent 以判据清单驱动 goal-driven loop，监督一组互不信任的 subagent 按 DAG 产出《科学假设与研究计划》；文献证据只认 arXiv API 实检结果；不合格就打回，预算耗尽就如实报失败。

## 原则

1. 对抗式协作：任何 subagent 的产出默认是错的，未经 master 对照判据认证不得进入下游。
2. 上下文不完全共享：subagent 间只通过显式 handoff 工件（结构化文件）传递；预期累计上下文 >50% 窗口即隔离。
3. 无 RAG：文献层 = arXiv 检索工具 + 文件式 memory（indexing + summarization），agent 自己搜。
4. 失败诚实：轮次预算耗尽仍不达标 → 输出失败报告与最近一次产物，不硬编。

## DAG

> **2026-08-10 拓扑收敛**：实现已按 [product-contract.md](product-contract.md) 收敛为
> `scientist → reviewer → 至多一次返修 → verify`（工件 evidence.md / proposal.json /
> review.json；见 agent/instructions.md）。下方 4 节点 DAG、角色表与「循环控制」是
> Ultra 期记录，保留作设计依据与消融对照，不描述现行为。

```
question (input)
   │
   ▼
[L] literature-miner ──── evidence.md（事实卡片 + arXiv id）
   │                        │
   ▼                        ▼
[H] hypothesis-generator ─ hypotheses.md（含推导链）
   │                        │
   ▼                        ▼
[C] critic ────────────── critique.json（可行性/自洽性/新颖性批判）
   │
   ▼
[W] plan-writer ────────── proposal.json（10 字段全量）
   │
   ▼
[M] master verify ──┬─ pass → runs/<ts>/proposal.{json,md}
                    └─ reject(逐项理由) → 打回对应节点重做（≤N 轮）
```

- master 在每条边上都设检查点：L→H 查证据卡片是否每条带 arXiv id；H→C 查假设是否基于证据卡片；C→W 查批判是否被回应；W→M 全量 10 字段 + 引用逐条 resolve。
- 打回是定向的：缺证据回 L，假设站不住回 H，计划字段缺回 W；不整体重跑。

## 角色与上下文策略

| 节点 | 输入（handoff 工件） | 产出 | 上下文 |
|------|---------------------|------|--------|
| L 文献挖掘 | question | evidence.md：≥N 张事实卡片（claim + arXiv id + 摘要句） | 独立；可多轮调 arXiv 工具 |
| H 假设生成 | question + evidence.md | hypotheses.md：2~3 个候选假设 + 归纳/演绎推导链 | 独立，不见 L 的过程 |
| C 批判 | question + evidence.md + hypotheses.md | critique.json：逐假设批判 + 选优 + 修改要求 | 独立，立场 = 默认假设是错的；**必须带工具**（arXiv 反查/数值可行性），纯 prompt 批判无信息增量（书 ch10 表 10-2） |
| W 计划撰写 | question + evidence.md + 胜出假设 + critique.json | proposal.json（10 字段） | 独立 |
| M master | 判据 + 各工件 | verdict.json（逐项 pass/reject + 理由） | 全局，唯一看到全部工件的角色 |

## 引用真实性防线（criteria B）

1. L 只能通过 arxiv_search / arxiv_get 工具获得文献；工具结果落盘 memory/papers/<id>.md（含标题、作者、摘要、日期）。
2. W 的 References 字段只允许填 memory/papers/ 中存在的 id —— 确定性代码校验（非 LLM），未知 id 直接拒绝。
3. 引用核验不看任何 agent 的推理过程，只拿最终条目反查 arXiv API 核对标题（拜占庭故障假设，书 ch10）。虚构引用 = 一票否决，不是扣分项。
4. E2E 验收再独立重放一遍 2–3。

## memory 布局（无向量库，书 ch3 文件系统范式）

```
runs/<ts>/memory/
  papers/<arxivId>.md    # L2 全文卡：标题/作者/摘要/日期/事实句
  index.md               # L0/L1：每篇一行摘要 + 主题分组，agent 靠它模糊检索
```
写入 papers/ 的条目必须同步登记 index.md（代码强制，不靠模型自觉）。

## 循环控制（吸收 4-harness 实测模式）

- 每节点最大重做轮数 N=3；全局 master 认证轮 ≤3。
- **预算是代码，不是提示词**（`lib/rework.ts`，openclaw child-admission 模式）：轮数 / 熔断 / 格式重试的判定是纯函数，执行点在 `artifact_write` 写 `verdicts/` 的路径上——第 4 轮直接拒写，返回带 `governingCap`（哪条上限在管事）与 `remaining`（余额）。计数器就是 `verdicts/` 目录本身，无额外状态、崩溃后照样算得出。收编前这三条只写在 `agent/instructions.md` 里由 master 自己数，eval#1 的事故正是它数错了。
- **熔断器**（codex guardian 模式）：同节点连续 3 次 reject → 不做第 4 次重试，升级处理（换策略重派或整体 FAILED），防无限打回。拒写即熔断。
- **fail-closed 认证**：verdict 必须是合法结构化 JSON；解析失败/超时一律按 reject 处理，不宽松解析放行。
- **两套重试分开计数**（hermes 模式）：schema 格式错误重试 ≤1 次（打回消息只带校验错误原文，不重贴 schema）；语义 reject 走节点轮数预算。
- **typed 回传**（hermes SubagentResult 模式）：subagent 结果区分 exit_reason ∈ {completed, max_turns, error}——"做完但不合格"与"预算耗尽被截断"处置不同（前者定向打回，后者直接升级）。
- **handoff 预算**（loopx 模式）：节点间 handoff 工件走文件，master 上下文只保留结构化摘要（≤20 行/工件）；token 烧在 subagent 内部。
- **负结果记忆**：被 reject 的假设及理由写入 runs/<ts>/memory/rejected.md，重派时必带——防 master 反复批准同一条死路（4 家 harness 共同缺失的 gap，我们补上；跨 run 版本为 post-MVP）。
- 每轮 verdict 落盘 runs/<ts>/verdicts/；token 用量累计记录。
- 超预算 → FAILED 报告（差哪几项判据、最近产物路径）。

## run 终态判定（状态表 + 崩溃表）

判定的唯一 owner 是 `lib/runOutcome.ts` 的纯函数 `runOutcome(evidence)`。下面两张表是**从代码抄下来的**（判定顺序见该文件 `runOutcome()`），不是另写一份规格：改代码必须同步改表，`scripts/selftest-outcome.ts` 第 [11] 节按崩溃表逐格断言。

**证据**（全部一眼可从 run 目录看出）：`FAILED.md` 在否、`proposal.md` 在否、`verification-report.md` 原文、`meta.json`、`exit.json`。判定顺序：`FAILED.md` → `proposal.md` → 非零退出码 → 其余。

**状态表**（当前 phase × 新落盘的证据 → 下一 phase）：

| 当前 | 触发（某个证据落盘） | 下一状态 | 说明 |
|---|---|---|---|
| unsettled | `FAILED.md` | **failed** | 失败凭据压过一切 |
| unsettled | `proposal.md`（无报告或报告非 ALL PASS） | **rendered** | 跑到终点 ≠ 验收通过 |
| unsettled | `meta.exitCode` / `exit.exitCode` 非零 | **failed** | 只在没有 proposal 正文时才由退出码定性 |
| unsettled | `verification-report.md`（但无 `proposal.md`） | unsettled | phase 不动，`terminal` 变真（报告只可能在 master 退出后写） |
| rendered | 报告 `结果: ALL PASS` 且无非零退出码 | **verified** | 唯一的 `deliverable=true` |
| rendered | 非零退出码 | rendered | 退出码在 proposal 分支里只挡 verified，不倒推成 failed |
| verified | 非零退出码后补落盘 | **rendered** | 降级：交付资格被退出码收回（web `passed` 与续跑认领由此同判） |
| rendered / verified | `FAILED.md` | **failed** | 同上，失败凭据压过一切 |
| failed | 任何后续证据 | failed | 吸收态 |

`terminal` 与 phase 正交，五个凭据任一即真：`FAILED.md` / 报告存在 / `proposal.md` / meta 落了 `finishedAt` 或 `exitCode` / exit.json 落了 `endedAt` 或 `exitCode`。`deliverable` 有且只有 `phase === "verified"`。

**崩溃表**（`scripts/run.ts` 的落盘顺序：question.md → meta.json(startedAt) → master run → invoke-result.json → proposal.md → meta 预写 exitCode → 离线验收报告 → meta 回写 finishedAt/最终 exitCode → memory 归档 / 索引重建）：

| 进程死在 | 盘上留下什么 | 终态判定 | 恢复动作 |
|---|---|---|---|
| meta.json 写之前 | 只有 `question.md`（或空目录） | unsettled，**非** terminal，续跑认领 null | 整题重跑；起始时间从 run id 解析 |
| invoke 尚未结束 | meta 有 `startedAt`，`finishedAt`/`exitCode` 皆 null；工件停在死掉那一刻 | phase 看已落盘工件；没有 proposal 时通常 unsettled | 整题重跑——续跑粒度是「题」不是「节点」 |
| provisional exitCode 已落、验收报告未落 | meta 有 `exitCode: 0`、`finishedAt: null`，proposal 已渲染 | rendered、terminal，`deliverable=false` | 整题重跑；不能拿 pipeline 成功冒充验收成功 |
| ALL PASS 报告已落、最终 meta 尚未回写 | proposal + ALL PASS + provisional `exitCode: 0` | verified、terminal、`deliverable=true` | 不重跑；验收结果和退出凭据均已落盘，后续 memory/index 只是可重建派生面 |
| 最终收尾之后 | meta 有 `finishedAt` + 最终 `exitCode` | terminal 必真；phase 由 `FAILED.md` / `proposal.md` / 报告决定 | 不重跑；`deliverable` 且 meta 有题号才算该题已交付 |

不可消除的不确定区间只在 **invoke 仍进行且 provisional exitCode 尚未落盘**。这段里 run 目录既可能是"正在跑"也可能是"已死"，两者从目录本身分不出来——「谁在跑」由 `runs/.active.json` 单并发锁回答，并作为显式入参进 `deriveStatus`。

## 模型接线（2026-08-10 迁至 @openai/agents，端点事实不变）

- 全部走百炼 Qwen responses API（一手实测：/responses 可用、function tool 可用——strict zod schema 亦实收、response_format 无效 → 结构化输出走 artifact_write 的 Zod 校验 + 格式重试；qwen3.7-plus 默认开 reasoning，token 放大 ~7x，仅 H/C/M 保留思考，L/W 限制）。
- `@openai/agents` 0.14.3 绑定（`agent/lib/model.ts` 是唯一接线点）：
  - 每个 Agent 显式传 `new OpenAIResponsesModel(qwenClient(thinking), modelId)` —— Model 实例绕过 SDK 全局解析，OPENAI_API_KEY 相关默认永不触发；`setTracingDisabled(true)` 在模块初始化时关掉 tracing exporter。
  - `enable_thinking`（百炼私有 body 字段）与 usage.jsonl 记账都在 client 的 fetch 兼容包装里 —— 与 eve 时代同一手法，单点管理 wire facts。
  - 架构映射：master = 带 5 个工具的薄调度 Agent（scientist / reviewer 两个派工工具 + artifact_write / artifact_read / verify_references）；节点 = 独立 Agent，经**同名派工工具**内的独立 `run()` 触发，除 message 外什么都不继承——显式 handoff 原则由机制成立。scientist/reviewer 的结构化返回由派工工具做 JSON 提取/规范化（ScientistOutputSchema / ReviewSchema），验收权单点在 artifact_write（fail-closed）。
  - **熔断映射**：eve 的 session token limits → `maxTurns × 131k 窗口` 上界（master 60≈8M，scientist 22≈3M，reviewer 19≈2.5M）+ 1h AbortSignal。撞线 = typed 回传 `max_turns`/`error`，master 按「被截断」写 FAILED。paused/Approve 人工续跑通道随之消失——超限即诚实 FAILED（human over the loop）。
  - **已知边界**：无自动 compaction（eve 0.8 阈值摘要不复存在）。master 上下文靠 handoff 预算（工件摘要 ≤20 行）自律；若真溢出 131k，端点报错 → run 诚实失败 → 救援道。后续若成为承重项，SDK 的 `callModelInputFilter` / `sessionInputCallback` 是现成的客户端裁剪钩子（R2 context 工作的落点）。
  - 外层驱动 = `scripts/run.ts` 进程内 `run(master)`（不再有 headless host / 子进程 / 退出码 3）。

### KV cache 经营（2026-08-09，判据来自 ai-agent-book ch2，端点事实为一手实测）

**判据**（`book-en/chapter2.md`「KV Cache-Friendly Context Design」）：

> "The prerequisite is that the context token prefix you want to reuse remains unchanged: if the token sequence first differs at some position, the KV states for that token and everything after it must be recomputed."
>
> "Always append dynamic information to the end—changing content like timestamps and user status should be appended as new messages at the end of the conversation, not by modifying the existing system prompt."

落到本仓三条：① instructions 一经定稿不动（连空格都算改）；② 工具定义顺序固定，不按用途重排；③ 每 run 变的东西（题号、run 目录、题目）一律排在不变的后面。

**端点事实**（百炼 `/compatible-mode/v1/responses`，qwen3.7-plus，逐条有请求凭证）：

| 事实 | 证据 |
|---|---|
| 隐式前缀缓存默认开，无需任何参数 | 同前缀连发：1st `in=2297 cached=0` → 2nd/3rd `cached=2048`，延迟 1801→1239→897ms |
| **最小可缓存前缀 ≈ 2048 token，且按整块计** | 连发同前缀：`in=2106` → `cached=0`；`in=2168` → `cached=2048`。真实 run 里 cached 值全为 128 的整数倍，块间距 2048/2176 |
| **TTL 在 3~5 分钟之间** | 预热后停 180s 再发 → `cached=2048`；停 300s → `cached=0`；停 420s → `cached=0` |
| `prompt_cache_key` / `prompt_cache_retention` **是死参数** | 传了不报错，但换 key 仍命中同一前缀、不传 key 也命中；响应两字段恒为 `null`。**显式 key 无收益，不接线** |
| thinking 两档各走各的缓存 | 同一前缀 `enable_thinking:false` 预热后，`true` 首发 `cached=0`（且 input 差 2 token → chat template 本身不同） |
| `status:"incomplete"`（撞 `max_output_tokens`）的响应不带 `usage` | 这类调用在 `usage.jsonl` 里没有记录，用量统计天然偏低 |

**基线**（`runs/20260808-134046`，124 次调用；这是目前唯一带 `usage.jsonl` 的 run）：

| 分组 | n | input | cached | 命中率 | 逐调用 p25/p50/p90 | cached=0 |
|---|---|---|---|---|---|---|
| 全部 | 124 | 2,253,346 | 1,995,648 | **88.6%** | 78.6% / 89.7% / 97.4% | 7 |
| thinking=true | 76 | 1,738,505 | 1,552,000 | 89.3% | 79.7% / 90.2% / 97.5% | 5 |
| thinking=false | 48 | 514,841 | 443,648 | 86.2% | 78.5% / 89.2% / 95.1% | 2 |

未命中的 11.4% 拆开看：**块尾余量 7.5%**（每次调用最后不足一块的部分，结构性不可消除）、**冷启动 2.6%**（7 次会话首发）、**真正的新增内容 1.4%**。

**结论：这一面已经接近天花板，不值得再优化。** 即便每次冷启动都能命中跨 run 的热前缀，命中率上限也只有 91.2%。而那 2.6% 里大部分还够不着——「subagent instructions 跨 125 run 稳定，是 125× 杠杆」这个直觉，实测不成立：

- master：instructions 单量 ~2943 token，过了 2048 底线。实测换一条完全不同的用户消息重发，仍 `cached=2048` → **跨 run 复用真实存在**，且相邻 run 只要在 TTL 内就自动吃到，无需接线。
- 四个 subagent：instructions 只有 503~868 token。以 literature（最大的一个：instructions + 4 个真实工具 schema）实测，**整条请求含用户消息才 1897 token**，连发三次 `cached` 恒为 0 —— 稳定前缀落在一个缓存块之内，**跨 run 复用结构性为 0**。hypothesis / critique / proposal 的 instructions 更短、工具更少，同理。

唯一的解法是把 subagent instructions 撑到 2048 token 以上——为缓存去灌 prompt，本末倒置，不做。记为已知边界：**在这个端点上，短 prompt 的 agent 拿不到任何前缀缓存**。

TTL 只有 3~5 分钟，还有一条操作性后果：`run:batch` 跑 125 题必须**连着跑**，中途停几分钟再续，master 的跨 run 前缀就凉了（重新冷启动，每次约一块）。这不值得为它加机制，但排期时知道就行。

**已做**：`scripts/run.ts` 的 `buildPrompt` 把三行执行规格从易变段之后移到之前（易变段 = 题号/run 目录/题目）。当前规模下无可测收益（重排前后同为 `in=3110 cached=2048`，~90 token 的差被整块粒度吞掉），价值在于把顺序钉成判据、防止后续往稳定段前面塞易变内容。派工 message 天生易变且天生后置，符合判据，不动。

## 问题源（官网维度 A）

输入题库 = 《Science》125 前沿科学问题（lib/science125.json，权威来源抓取）。E2E 默认用例从中选天文类一题；批量 runner 支持按题号列表串行出多份结果（提交期跑全量 125）。

## 目录布局法理（2026-08-09 依 next 本地文档 + steve 考证；2026-08-10 迁移后复核不变）

- Next 只认领 `app/ pages/ public/ src/` 四个顶层目录（本版本 02-project-structure.md:11-28），`lib/`/`components/` 是官方明说的无框架语义占位名，唯一规范是"选一种策略保持一致"——我们用文档策略 A（应用代码在根、app/ 纯路由）。
- `agent/` 布局沿用原约定（instructions.md 同目录、subagents/<节点>/、共享实现在 agent/lib/）——迁移只换了装配方式（约定式发现 → 显式工厂 `buildMasterAgent`），文件地理未动。
- 数据文件归属：官方四个静态 JSON 先例全部与消费者共置并 import——`lib/science125.json` 与之同形；`public/` 定义是"served directly without processing"，数据文件放那反而违反定义。
- **架构约束（比配置更本质）**：luup 是**有状态自托管应用**（runs/、memory/ 是运行期读写的本地状态），不做 serverless/standalone 部署；`outputFileTracingIncludes` 之类的 serverless 追踪配置因此不适用。若将来要上无持久卷平台，先回头看存储裁决的 PG 路径。
- `lib/` 的双内容（web 消费 + harness）判定为"共享内核 + 三消费者"（paths/runId/nodes/mdTable/types 被 web+scripts+agent 三方共用），不拆——拆散会破坏 REPO_ROOT 单一定义点。

## 存储裁决（2026-08-08，依 loopx/hermes/steve 三方取证）

**不引入数据库。** 判据与证据（详见会话 db-evaluation 报告）：
- 触发条件一条不满足：写者恒为 1（百炼配额刻意串行）；runs/ 全量外推仅 ~21MB；且 runs/ 是交付物与防虚构证据链本身，进 DB 净损失。
- 参照系：loopx 零 DB（许可 SQLite 而终未用，查询走可丢弃的派生缓存）；hermes 迁 SQLite 的触发是 6 类真并发写者 + 全局 FTS（我们都没有），且其记忆本体仍是平文件；steve 的 PG 只装 eve workflow 引擎内部状态，业务数据不进。
- 边界即 .gitignore：runs/ + memory/（不 ignore = source of truth = 永远是文件）vs 构建产物（ignore = 可丢弃派生态）。
- 将来唯一可能的引入路径：PG + @workflow/world-postgres（eve 官方线），触发三选一——真并行跑 / 无持久卷部署 / 磁盘不可删。
- **允许集（用户 2026-08-09 限定）**：若上 DB 只在 {SQLite, MongoDB, PostgreSQL} 内选。当前裁决在此约束下：PG 是唯一触发路径；SQLite 的候场理由（跨 run 统计）由确定性脚本覆盖；Mongo 维持排除（无文档型查询需求）。DuckDB 类"SQL 透镜"方案不在允许集内，作废。
- 2026-08-09 二次评估（战役末态实测外推：runs ~18MB/125 目录、library ~1750 卡、单写者经 D 加固）：结论不变。

**（已消解）评估曾暴露的真雷**：.eve/.workflow-data 纯重放工件外推 125 题 ≈20GB/125 万文件，当时以保留策略（lib/retention.ts）对冲。2026-08-10 迁至 @openai/agents 后 durable 流数据这一层整体不存在，保留策略连同其 selftest 一并删除；仍然成立的两条：②派生 runs/index.json 缓存 ③web 列表 mtime memo。

## MVP 之外（技术方案文档中论述，不实现）

前端可视化、演示视频、SFT、多模态数据处理、全量 125 题生产跑（预算动作，能力已具备）。
