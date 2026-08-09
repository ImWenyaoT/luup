# luup 领域词汇（domain glossary）

架构词汇（module/interface/depth/seam/adapter/leverage/locality）见 codebase-design skill；本文件只记 luup 自己的领域语言。架构审查与重构必须使用这些词，不得漂移。

| 术语 | 含义 | 代码锚点 |
|------|------|---------|
| **run** | 一次完整流水线执行：question → L→H→C→W → master 认证 → 验收。工件全部落在 `runs/<ts>/` | scripts/run.ts |
| **run outcome** | 一次 run 的终态判定：phase（进行到哪）+ terminal（是否终结）+ deliverable（是否可交付 = 通过独立验收）+ 起止时间。全系统唯一 owner，纯函数，入参是一份 RunEvidence（锁不在其中：「谁在跑」由调用方显式带入） | lib/runOutcome.ts |
| **工件（artifact）** | 节点产出的落盘文件（evidence.md / hypotheses.md / critique.json / proposal.json …）。注册表 NODES 是其单一事实源：节点↔工件↔tab↔清单 | lib/phase.ts NODES |
| **认证（verdict）** | master 对节点产物的逐项判定（pass/reject + checks + rework）。写出端契约与读入端视图是两个类型（VerdictView 分裂中） | agent/lib/contracts.ts |
| **判据（criterion）** | 验收锚点 criteria.md 中可核验的检查项（A 契约 / B 引用真实性 / C 闭环 / D 合规 / E 复现 / G 交付） | docs/design/criteria.md |
| **独立验收（offline verification）** | 零 LLM 的确定性重放：schema + 引用逐条反查 arXiv（B1–B4）。与环内 verify_references 共享判据、独立数据通路 | scripts/verify-proposal.ts |
| **战役（campaign）** | 跨 run 的 Science-125 全量作业。战役记忆 = repo 根 memory/（library / 题页 / log），run 证据链 = runs/<ts>/memory/（B1 语义，永不复用） | agent/lib/campaignMemory.ts |
| **续跑（resume）** | 批量跑跳过「已交付」题：meta.questionId 命中 + exitCode 0 + 报告 ALL PASS 双条件 | scripts/run-batch.ts |
| **handoff 工件** | 节点间显式传递的文件（subagent 不共享上下文，message 里只放需要的一切） | agent/instructions.md |
| **负结果（negative result）** | 被拒假设及理由。run 内在 rejected.md，跨 run 在题页——防止重蹈死路 | memory/questions/ |
| **单写者假设** | campaignMemory 无锁 read-modify-write 的前提。现由 web 锁 + CLI 串行两套不相交机制"保证"（候选 D 要给它一个 owner） | campaignMemory.ts 头注 |
| **保留策略（retention）** | eve durable 流数据（纯重放工件）在 run 终结后可清；runs/ 与 memory/ 永不清 | lib/retention.ts |
