# memory 设计（run-scoped + campaign-scoped 两层）

v4（2026-08-15）：随 ADR-0004 改指 TS 栈。无 RAG 红线不变：文件 + 确定性字符匹配，零 embedding。
agent 现场契约见 `memory/SCHEMA.md`；代码是 `src/campaign/campaign.ts`，读写同一个文件——
TS 栈没有 `memory_search` 工具，模型没有自主读记忆的通路，注入只发生在 run 开局那一次。

## 第一层：run-scoped（永久保留）

**存储已随 ADR-0004 变更**：这层不再是 `runs/<ts>/memory/` 目录，而是 SQLite 里的证据台账
（`src/agent/evidence.ts` 写，`src/verify/` 读）。语义一字未变——存在理由 = criteria B1 的
证据链语义：引用必须来自**本次运行**实检。这层是 provenance，不是知识库。
Python 期已落盘的 `runs/<ts>/memory/` 保留为只读归档。

## 第二层：campaign-scoped（跨 run，服务 125 题战役）

repo 根 `memory/`：`log.md`（时序）、`questions/q<id>.md`（每题战役页）、`lessons.md`（运营教训）、
`library/`（TS 栈遗留的历史文献库，现只读）。职责分开：`questions` 管「这题试过什么」，`log` 管「发生过什么」。

## 写入：agent 不参与

TS 栈的 `memory_note` 工具与 `campaignMemory.ts` 已删除且未重建，模型没有写本目录的通路。
现在只有一条路径：run 收尾 `campaign.record_run` 确定性追加，零 LLM、append-only、原子替换。

- `log.md`：`## [date] run | q<id> | SUCCESS|FAILED` + 一行 run 目录与摘要。
- `questions/q<id>.md`：一行 verdict + 胜出标题（或失败分类）+ 引用 id 列表；无题号的 run 只写 log。
- 事实来源是本 run 自己的 `proposal.json` 与 `RunOutcome`，不经模型转述，因此没有「声称写了但没写」的空间。

## 读取：分桶配额，不灌上下文

`memory_search` 按桶扫描，先到先得填满 `limit`：`lessons.md` + `questions/**` 保底优先，
`library/index.md` 次之，其余 `*.md` 兜底，`library/papers/**` 排除出检索面
——122 篇文献卡正文会把唯一一条「这条路走死过」的题页命中挤出结果。

派工注入：有题号时 Harness 开局读本题页末 3 条，作为 `priorAttempts` 进 Scientist 首条 message（trace 可证）。
这是防止跨 run 反复端上同一条死路的唯一凭据，且不依赖模型自觉调用工具。

## 消融臂

`--no-memory` 传 `None` 给 `LuupTools`，`memory_search` 走 `enabled:false` 分支，读写双向全关，
`meta.json` 记 `memoryArm: "on"|"off"`。记忆是加速层不是依赖，这条开关就是它的证明。

## B1 语义不放松

`library/` 命中只是线索。任何要进 proposal references 的 arXiv id，仍必须经 `arxiv_save` 落到本 run 的
`papers/`。防虚构四道防线一道不减。

## 未实现（有意留白）

- **compaction**：`log.<YYYY-MM>.md` 分片与 `q<id>.archive.md` 归档随 TS 栈删除，未重建。当前量级
  （题页上界 125、每 run 一行）不需要。将来若做，两条约束照抄：只搬不改、不经 LLM 摘要。
- `memory/index.md`、`library/index.md` 的自动重建：同上，现无代码派生。
- mermaid 假设谱系图：v2 设计里的构想，未实现，不阻塞任何判据。

## 验收标准

①同题二跑，第二跑的 trace 首条 message 里出现第一跑的记录；②`memory_search` 命中里题页优先于文献索引；
③删掉整个 `memory/` 或跑 `--no-memory` 后流水线照常跑通；④本目录任何一行都不是模型写的。

## 外部佐证（记录在案）

- karpathy llm-wiki（gist 442a6bf）：先 index 再钻页，"avoids the need for embedding-based RAG infrastructure"。
  原版给规模留了 qmd（BM25/vector）后门，我们不留——有意比原版更严。
- 某 DB 厂商的记忆产品知识正文不入库（"正文留磁盘"），其 SQLite 动因是千页×多租户下全文索引 OOM，
  luup 量级不具备；且引入 DB 会直接废掉验收标准③。
