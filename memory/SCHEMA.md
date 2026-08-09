# campaign memory 行为契约

跨 run 的长期记忆（125 题战役）。设计权威是 `docs/design/memory.md`；本文件是给 **agent 在工作现场读的约定**，只讲「写什么、写多细、什么时候不写」。硬约束不在这里 —— 它们在代码里（`agent/lib/campaignMemory.ts`）。

## 两层记忆

| 层 | 位置 | 语义 | 谁写 |
|---|---|---|---|
| run-scoped | `runs/<ts>/memory/` | **本次运行实检**的证据链（criteria B1 的 provenance） | `arxiv_save` 独占 |
| campaign-scoped | 本目录 | 跨 run 累积的知识与战役记录（**加速层**） | 确定性代码 + `memory_note` |

## 目录

```
memory/
  SCHEMA.md          本文件
  index.md           内容目录（代码派生，禁手写）
  log.md             时序日志（append-only，`## [date] <action> | q<id> | <verdict>`）
  log.<YYYY-MM>.md   log.md 的分片（代码滚出，整条搬移；禁手改、禁删除）
  library/
    papers/<id>.md   全局文献卡 L2（代码派生自 run 卡，含 fetchedAt / questionIds）
    index.md         全局文献索引 L0/L1，按 arXiv 学科分组（代码派生，禁手写）
  questions/q<id>.md 每题战役页（append-only）
  questions/q<id>.archive.md  该题的旧条目归档（代码搬入，整条搬移；禁手改、禁删除）
  lessons.md         运营级教训（append-only）
```

`index.md` 管「有什么」，`log.md` 管「发生过什么」—— 职责不混。读取姿势固定为**先 index / search，再按路径钻页**。

## 写入纪律（agent 是 Proposer，代码是 Reviewer）

- `library/**` 与两个 `index.md` **agent 不可直写**。它们由 `savePaper → upsertLibraryPaper` 在文献落 run 卡的同一时刻确定性重建。索引是派生物，不靠模型自觉登记。
- `questions/` 与 `lessons.md` 经 `memory_note` 追加，**append-only**：新记录写在文末，旧记录不改写、不删除（覆盖会让已经走死的路重新变得可走）。
- **落盘校验**：`memory_note` 返回 `{written[], failed[]}`，每条都是写后读回验证的结果。`failed` 非空时不得在收尾摘要里声称写入成功 ——「声称写了」永远不等于「写了」。
- 双写路径：`memory_note`（agent 主动）+ `scripts/run.ts` 收尾（代码兜底）。漏写不致命。

## compaction（文件长大之后会发生什么）

阈值判定 100% 在代码里（`agent/lib/campaignMemory.ts`），随写入自动发生，**你不需要也不应该去触发它**。两条规则：

| 文件 | 触发 | 动作 | 结果 |
|---|---|---|---|
| `log.md` | 超行数阈值（默认 500） | 较早条目按其自身日期滚进 `log.<YYYY-MM>.md` | 主 log 只留最近段；时序审计线一字不改 |
| `questions/q<id>.md` | 超字数预算（默认 16KB） | 除最近 3 条外的条目搬进 `q<id>.archive.md` | 主页面留最近 3 条 + 一行 `> 更早记录见 …` 指针 |

- **只搬不改**：条目整条搬移，逐字节不改写 —— 不摘要、不裁剪、不合并、不经模型。
- **不可压缩字段**：run 目录指针、被拒假设的原始陈述与理由。它们随条目原样进归档文件；负结果一旦被摘要就会失去「防重蹈」的比对精度。
- **降层 ≠ 删除**：`memory_search` 照常扫描 `q<id>.archive.md`，被归档的知识仍然搜得到。分片与归档文件请勿手改、勿删除。
- 刚写完的条目永远还在主页面/主 log 上（保留最近 N 条这条保证的）。

## 读取

`memory_search` 对 `library/index.md` + `questions/**`（含 `*.archive.md`）+ `lessons.md` 做 grep 式模糊匹配，返回命中行（L0）与路径。要细节再按路径读 L2。

## B1 不放松

`library/` 命中**只是线索**。任何要出现在 proposal references 里的 arXiv id，仍必须经 `arxiv_save` 在**本次 run** 实检落盘到 `runs/<ts>/memory/papers/`。防虚构四道防线一道不减。

## Non-goals（写死，防止后人好心加回来）

- **永不引入 embedding / vector 检索**，也不引入 hybrid BM25+vector（qmd 之类）。检索面只有确定性字符匹配。karpathy 的 llm-wiki 给规模留了向量后门；我们不留 —— 这是有意比原版更严。
- 不做手写 `[[wikilink]]` 互链、不做每页最少出链数：agent 手写链接又是一个「靠自觉」的一致性来源，反向索引由代码派生（见 `library/index.md` 的「用于题号」列）。
- 不做 tag 分类法 / 完整 YAML frontmatter 契约：页面类型是闭集（library / questions / lessons）。
- 不做 sha256 漂移检测与陈旧检测：arXiv 元数据不可变，本目录没有过期语义。
- **compaction 不引入 LLM 摘要**：搬移是确定性的、逐字节可校验的；摘要会引入模型、引入不确定性、引入「摘丢了什么」这个新问题。「LLM 产增量摘要片段」只作为将来的钩子留在代码注释里，未启用。
- 不做「一次写入触碰 10-15 个页面」的扩散式写入：与 handoff 预算冲突，写入面保持窄。
- **不让主流程依赖本目录**：删掉整个 `memory/` 后流水线必须照常跑通（全部相关函数静默 no-op）。这是可删除性红线，任何新特性都不得越过。
