# luup 架构设计

赛题 XH-202619 赛道一·方向一·A。验收锚点见 [criteria.md](criteria.md)。

## 一句话

master agent 以判据清单驱动 goal-driven loop，监督一组互不信任的 subagent 按 DAG 产出《科学假设与研究计划》；文献证据只认 arXiv API 实检结果；不合格就打回，预算耗尽就如实报失败。

## 原则

1. 对抗式协作：任何 subagent 的产出默认是错的，未经 master 对照判据认证不得进入下游。
2. 上下文不完全共享：subagent 间只通过显式 handoff 工件（结构化文件）传递；预期累计上下文 >50% 窗口即隔离。
3. 无 RAG：文献层 = arXiv 检索工具 + 文件式 memory（indexing + summarization），agent 自己搜。
4. 失败诚实：轮次预算耗尽仍不达标 → 输出失败报告与最近一次产物，不硬编。

## DAG

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
- **熔断器**（codex guardian 模式）：同节点连续 3 次 reject → 不做第 4 次重试，升级处理（换策略重派或整体 FAILED），防无限打回。
- **fail-closed 认证**：verdict 必须是合法结构化 JSON；解析失败/超时一律按 reject 处理，不宽松解析放行。
- **两套重试分开计数**（hermes 模式）：schema 格式错误重试 ≤1 次（打回消息只带校验错误原文，不重贴 schema）；语义 reject 走节点轮数预算。
- **typed 回传**（hermes SubagentResult 模式）：subagent 结果区分 exit_reason ∈ {completed, max_turns, error}——"做完但不合格"与"预算耗尽被截断"处置不同（前者定向打回，后者直接升级）。
- **handoff 预算**（loopx 模式）：节点间 handoff 工件走文件，master 上下文只保留结构化摘要（≤20 行/工件）；token 烧在 subagent 内部。
- **负结果记忆**：被 reject 的假设及理由写入 runs/<ts>/memory/rejected.md，重派时必带——防 master 反复批准同一条死路（4 家 harness 共同缺失的 gap，我们补上；跨 run 版本为 post-MVP）。
- 每轮 verdict 落盘 runs/<ts>/verdicts/；token 用量累计记录。
- 超预算 → FAILED 报告（差哪几项判据、最近产物路径）。

## 模型接线（已依 eve 能力图谱定稿）

- 全部走百炼 Qwen responses API（一手实测：/responses 可用、function tool 可用、response_format 无效 → 结构化输出走强制 tool call 或 Zod 校验重试；qwen3.7-plus 默认开 reasoning，token 放大 ~7x，仅 H/C/M 保留思考，L/W 限制）。
- eve 绑定（能力图谱真机验证结论）：
  - `model` 传 AI SDK `LanguageModel` 实例 → routing external，不经 Vercel AI Gateway。共享 `agent/lib/model.ts`。
  - 优先 `@ai-sdk/openai` 的 `.responses()` + 自定义 baseURL 打 `/responses`；不兼容处包 fetch 兼容层。仅当 responses 路线确证不可行才降级 openai-compatible（chat），且必须书面记录原因。
  - **每个 agent.ts（含每个 subagent）必须写 `modelContextWindowTokens`**，否则编译期误导性报错。
  - eve 架构映射：root agent = master（认证循环 instructions + 确定性核验工具）；L/H/C/W = declared subagents（各自独立 instructions/tools，天然不共享父对话历史，`outputSchema` 出结构化 JSON）。外层 `eve invoke` 单次触发，budget 用 maxTurns/token 配额兜底。
  - subagent 从 root 继承 nothing；handoff 内容必须显式打进 message/工件文件——正好符合本设计的显式 handoff 原则。

## 问题源（官网维度 A）

输入题库 = 《Science》125 前沿科学问题（fixtures/science125.json，权威来源抓取）。E2E 默认用例从中选天文类一题；批量 runner 支持按题号列表串行出多份结果（提交期跑全量 125）。

## 存储裁决（2026-08-08，依 loopx/hermes/steve 三方取证）

**不引入数据库。** 判据与证据（详见会话 db-evaluation 报告）：
- 触发条件一条不满足：写者恒为 1（百炼配额刻意串行）；runs/ 全量外推仅 ~21MB；且 runs/ 是交付物与防虚构证据链本身，进 DB 净损失。
- 参照系：loopx 零 DB（许可 SQLite 而终未用，查询走可丢弃的派生缓存）；hermes 迁 SQLite 的触发是 6 类真并发写者 + 全局 FTS（我们都没有），且其记忆本体仍是平文件；steve 的 PG 只装 eve workflow 引擎内部状态，业务数据不进。
- 边界即 .gitignore：runs/ + memory/（不 ignore = source of truth = 永远是文件）vs .eve/（ignore = 可丢弃派生态）。
- 将来唯一可能的引入路径：PG + @workflow/world-postgres（eve 官方线），触发三选一——真并行跑 / 无持久卷部署 / 磁盘不可删。SQLite、Mongo 明确排除。

**评估暴露的真雷（125 全量跑前置修复）**：.eve/.workflow-data 已 1.1GB/7 万文件（仅 7 次 run），外推 125 题 ≈20GB/125 万文件而本机余 95GB，eve 自动 prune 不覆盖 → ①批量跑加保留策略（题间清理已验收 run 的 workflow 状态）②派生 runs/index.json 缓存 ③web 列表 mtime memo。

## MVP 之外（技术方案文档中论述，不实现）

前端可视化、演示视频、SFT、多模态数据处理、全量 125 题生产跑（预算动作，能力已具备）。
