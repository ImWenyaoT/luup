# campaign memory 行为契约

跨 run 的长期记忆（125 题战役）。设计权威是 `docs/design/memory.md`；本文件是给 **agent 在工作现场读的约定**。硬约束在代码里：读写都在 `apps/server/src/campaign/campaign.ts`。

## 两层记忆

| 层 | 位置 | 语义 | 谁写 |
|---|---|---|---|
| run-scoped | sqlite `tool_evidence` 表（Python 期为 `runs/<ts>/memory/`，归档已迁 git tag `archive/phase-a-evidence-20260816`） | **本次运行实检**的证据链（criteria B1 的 provenance） | `arxiv_save` 独占 |
| campaign-scoped | 本目录 | 跨 run 累积的战役记录（**加速层**） | `campaign.record_run`，确定性代码独占 |

## 目录

```
memory/
  SCHEMA.md          本文件
  index.md           目录清单（TS 栈遗留，现无代码派生；人工维护，可删）
  log.md             时序日志（append-only，`## [date] run | q<id> | <verdict>`）
  library/           TS 栈遗留的历史文献库，现无代码写入；只读
    papers/<id>.md   全局文献卡（**不在 memory_search 检索面内**）
    index.md         全局文献索引（在检索面内，次优先级）
  questions/q<id>.md 每题战役页（append-only）
  lessons.md         运营级教训（append-only，人工维护）
```

## 写入（模型不写，代码写）

- **没有 `memory_note` 工具**。它随 TypeScript 栈删除，未重建；模型没有任何写本目录的通路。
- run 收尾时 `campaign.record_run` 确定性追加两处，零 LLM：
  - `log.md`：一段 `## [date] run | q<id> | SUCCESS|FAILED` + 一行 run 目录与摘要；
  - `questions/q<id>.md`：一行 `- [<iso>] <verdict> | run <id> | <胜出标题或失败分类>｜引用 <ids>`。
  - 无题号的 run（自由输入）只写 `log.md`。
- 写法是「读—改—原子替换」：**append-only**，旧行不改写、不删除、不重排。
- `--no-memory` 消融臂下一行都不写，`meta.json` 记 `memoryArm: "off"`。

## 读取

`memory_search` 做确定性字符匹配，按桶扫描、先到先得填满 `limit`：

1. `lessons.md` + `questions/**`（跨 run 判断与已走死的路，保底优先）
2. `library/index.md`（线索表）
3. 其余 `*.md`
4. `library/papers/**` **排除**——上百篇卡片正文会把一条题页命中挤出 limit

派工注入：有题号时 Harness 开局确定性读本题页末 3 条记录，作为 `priorAttempts` 进 Scientist 首条 message。这条路径不经模型。

## TypeScript 栈（`apps/server/src/campaign/campaign.ts`）

同一批文件、同一条 append-only 契约，两处按新事实改写：

- **没有 `memory_search`**。TS 栈的记忆通道只剩确定性注入一条：批跑发起 run 前读本题页末 ≤3 行，接在 researcher 输入的 `prior_attempts` 字段里（`apps/server/src/roles.ts` 的 `buildStageInput`，位置在 `input_artifacts` 之后、纠错材料之前，前缀稳定性因此不破）。模型没有任何自主读本目录的通路，`--no-memory` 关掉的是注入与写回本身。
- **行格式**：run 定位符从 `runs/<ts>` 变成 `<db 仓库相对路径>#<runId>`（run 数据在 sqlite；历史批 db 已迁 git tag `archive/phase-a-evidence-20260816`，既有定位符经该 tag 解析），失败分类从 `分类：x` 变成可机读的 `cls=x`。verdict、标题、`引用 <ids>` 三段不变。

每个 run 落一条 `campaign.prior_attempts{question_id,count}` 事件，是消融生效门的事实来源：`memory_arm=off` 的 run 这个数必须为 0。口径见 `docs/design/experiment-protocol.json` 的 2026-08-14 修订记录。

## B1 不放松

`library/` 命中**只是线索**。任何要出现在 proposal references 里的 arXiv id，仍必须经 `arxiv_save` 在**本次 run** 实检落盘（TS 栈落 sqlite 的 `tool_evidence`；Python 期为 `runs/<ts>/memory/papers/`）。防虚构四道防线一道不减。

## 未实现（不要照着旧文档找）

- **compaction / 分片 / 归档**：`log.<YYYY-MM>.md`、`q<id>.archive.md` 的自动滚动随 TS 栈删除，未重建。当前文件量级不需要；真需要时再实现，并保持「只搬不改、不经模型」。
- `index.md` 与 `library/index.md` 的自动重建：同上，现无代码派生。

## Non-goals（写死，防止后人好心加回来）

- **永不引入 embedding / vector 检索**，也不引入 hybrid BM25+vector。检索面只有确定性字符匹配。
- 不做手写 `[[wikilink]]` 互链、不做每页最少出链数。
- 不做 tag 分类法 / 完整 YAML frontmatter 契约：页面类型是闭集（library / questions / lessons）。
- 不做 sha256 漂移检测与陈旧检测：arXiv 元数据不可变，本目录没有过期语义。
- compaction 若重建，**不引入 LLM 摘要**：搬移必须是确定性、逐字节可校验的。
- **不让主流程依赖本目录**：删掉整个 `memory/`（或跑 `--no-memory`）后流水线必须照常跑通。这是可删除性红线。
