# memory 设计（run-scoped + campaign-scoped 两层）

v2（2026-08-08）：吸收 karpathy llm-wiki（gist 442a6bf）与 hermes 实践研究后定稿。
无 RAG 红线不变：全部是文件 + 确定性索引 + agent 主动模糊搜索，零 embedding。karpathy 原版给规模留了 qmd（BM25/vector）后门——**我们不留**，这是有意比原版更严。

## 第一层：run-scoped（现状，永久保留）

`runs/<ts>/memory/`：papers/（本次实检文献卡）、index.md、rejected.md。
存在理由 = criteria B1 的证据链语义：引用必须来自**本次运行**实检。这层是 provenance，不是知识库。

## 第二层：campaign-scoped 长期记忆（跨 run，服务 125 题战役）

repo 根 `memory/`：

```
memory/
  SCHEMA.md            # 本目录的行为契约（llm-wiki 惯例：约定放在 memory 内部给 agent 读，
                       # 含 non-goals：永不引入 embedding/vector 检索；硬约束仍在代码层）
  index.md             # 内容目录（L0：每页一行；确定性代码派生，禁手写）
  log.md               # 时序日志（append-only，固定前缀 `## [date] <action> | q<id> | <verdict>`，
                       # run 收尾由代码兜底写；grep 可解析——index 管"有什么"，log 管"发生过什么"）
  library/
    papers/<id>.md     # 全局文献卡 L2（工具写入，含 fetchedAt；arXiv 元数据不可变，永不过期）
    index.md           # L0/L1 全局索引：每篇一行 + 按学科分组（确定性代码派生，禁手写）
  questions/q<id>.md   # 每题战役页（llm-wiki 的"query 好答案回填成页"）：状态、成功 run 指针、
                       # 跨 run 负结果（被拒假设+理由）、有效检索词、领域文献覆盖评估
  lessons.md           # 运营级教训（哪些学科 arXiv 覆盖差、检索策略经验）
```

index.md 与 log.md 职责严格分开（llm-wiki 规则）；agent 的读取姿势 = 先 index 后钻页（"先读 index 再钻页面"就是无 RAG 的替代，gist 原文："avoids the need for embedding-based RAG infrastructure"）。

## 写入纪律（书 ch3：知识更新走 PR；agent 是 Proposer，代码是 Reviewer）

- `library/` **agent 不可直写**：arxiv_save 落 run 卡后，由确定性代码同步 upsert 全局卡并重建 index——与 run 内 index 同一条纪律（索引是派生物，不靠模型自觉）。
- `questions/` 由 master 经新工具 `memory_note` 追加（append-only、结构化字段）；run 结束时驱动脚本把 verdict/FAILED 摘要自动归档——写入有两条独立路径（agent 主动 + 代码兜底），漏写不致命。
- **落盘校验**（hermes 血教训：模型批量写文件半数失败却声称全写）：`memory_note` 返回结构化 `{written[], failed[]}`，写后读回验证；「声称写了」永远不等于「写了」。
- raw evidence（runs/）/ knowledge（memory/）/ serving index（index.md）三层分离。

## 读取（agent 主动 search，不是灌上下文）

- 新工具 `memory_search`：对 library/index.md + questions/ 做 grep 式模糊搜索，返回 L0 行 + 命中路径；agent 要细节再按路径读 L2（分层加载，不撑爆上下文）。
- master 派工注入：literature 节点带上本题 q<id>.md 摘要 + "先 memory_search 后 arxiv_search"；hypothesis 重派时带跨 run 负结果（防止跨 run 端上同一条死路——4 家 harness 共同缺失的 gap）。
- 跨题复用：Q54（宇宙线）攒下的文献可被 Q61（脉冲星）经 search 命中——125 题战役里 library 随跑随厚。

## B1 语义不放松

library 命中的文献**仍必须**经 arxiv_save 落到本 run 的 papers/ 才能被引用。工具内部可拿 library 当缓存加速，但落 run 卡前必须重验 id 存在（arXiv API HEAD/查询）。防虚构四道防线一道不减。

## compaction（v3 增补，裁决自 TencentDB-Agent-Memory 研究——llm-wiki 的第二个工程实现）

前提纠正：`questions/` 有硬上界 125、文件名稳定，**不会膨胀**；真正无界的是 log.md 行数与单个题页字数，分开治：

- **log.md：只分片，永不压缩**。超行数阈值（代码判定）→ 滚动为 `log.<year-month>.md`，主 log 留最近段。时序审计线一字不改。
- **题页：大页追加 + 归档**。超字数预算（代码判定，非模型自觉）→ LLM 只准产**增量摘要片段**，旧正文一字节不动；被归并的旧条目移入 `q<id>.archive.md`（降层不删除）；run 指针（provenance）是**不可压缩字段**。触发 100% 代码算，LLM 只产文本 + 写后读回。
- **不可压缩清单**：run 目录指针、被拒假设的原始陈述与理由（负结果一旦被摘要就会失去"防重蹈"的比对精度）。

## mermaid 结构化索引（v3 增补）

- **用**：题页内的**假设谱系图**——派生/分支/被拒/跨 run 复用是真图结构。约束三条一起抄：硬字符预算（≤4000）、节点格式强制可正则解析（`H1[假设短语]:::rejected` 式）、每节点挂证据指针（run 目录或 verdict 路径）。被拒假设用 `:::rejected` 样式保留在图上——认知墓碑，不删。
- **不用**：index/学科地图——学科分类是树不是图，改成 mermaid 会同时损失 grep 可检索、确定性派生、diff 可读三样，纯花架子。

## 外部佐证（记录在案）

- 一个 DB 厂商的记忆产品，知识正文**不入库**（"正文留磁盘"）；其上 SQLite 的唯一动因是千页×多租户下全文索引 20GB OOM——luup 量级不具备。与我们的存储裁决（不引入 DB）互为印证；且 DB 会直接废掉下方验收标准④。
- 它整体拥抱 embedding，但**同源于 llm-wiki 的 Wiki 层全程无 embedding**（检索= FTS + wikilink 图遍历）——无 RAG 红线的又一外部佐证。

## 实施状态

- 设计定稿：2026-08-08。实施排在 withEve 迁移验收之后（避免并发改 agent/）。
- 验收标准：①同题二跑命中 library 缓存且 B1 仍过；②跨 run 负结果在重跑时出现在 hypothesis 派工 message 里（trace 可证）；③memory_search 在 literature trace 里先于 arxiv_search 出现；④删除 memory/ 后一切照常（长期记忆是加速层，不是依赖）。
