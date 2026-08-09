# 架构 backlog（2026-08-09 架构轮收官存档）

架构轮已落地：候选 0（critique tab bug 热修）、B（工件注册表 lib/nodes.ts）、A（run outcome owner lib/runOutcome.ts + runId.ts）、D（单并发锁 seam 双 adapter）、compaction、simplify pass（四镜片 30 修）。以下为**有意不做**与**推迟**项，重提前先读存档理由。

## 推迟（触发条件明确）

| 项 | 内容 | 触发时机 |
|---|------|---------|
| E | 进程间契约成对化（runHandoff emit+parse）+ run.ts 收尾抽 finalizeRun + exit.json 并入 RunMeta | 下次改 run.ts 收尾编排或 stdout 协议时一并做 |
| F | questionId 收编进 runContext（memory_note 不再收模型入参）+ model.ts 改走 resolveRunDir（usage.jsonl 在 eval 路径缺失的根因） | 提交期整理 D1 凭证面时 |
| C 残余 | Scan 持内容惰性 memo（E2 的 reportOf 已消掉最大重复读，剩余收益小） | 列表页出现真实延迟时 |
| G 残余 | B4 判据纯函数化 (claimed,truth)→RefCheck；Verdict 读写端命名分裂（VerdictView） | 下次改验收器时 |
| F7 | proposal.md 字面量提为 nodes.ts 常量（5 处） | 下次要改这个文件名之前 |

## 有意不做（裁决记录，勿重提）

- **proposal/verify tab 手写**：端的是派生视图非工件原文，注册表泛化只增间接层（Altitude F1）。
- **LUUP_LOCK_PID 父子交接**：env 是指认非授权，锁文件才是权威；机制不绑层数（F2）。
- **runOutcome 双证据构造器**：同一 narrow waist 的两个 adapter，成本模型不同，等价性有 241 断言护栏（F3）。
- **RUNS_INDEX_VERSION 换内容 hash**：版本号管代码语义、dirMtime 管数据新鲜度，职责已分清（F5 已实现）。
- **compaction thresholds 私有化**：test seam，注释已写明不做配置面（F6/S4）。
- **selftest fixture 共享（R7）/ p 与 p2 合并（R8）**：低于共享阈值。
- **DB / vector 检索 / LLM compaction 摘要 / mermaid 谱系图**：见 architecture.md 存储裁决与 memory.md non-goals；谱系图等真实战役数据积累后再议。

## openclaw/pi 研究裁决（2026-08-09 增补）

采纳（战役前采纳包执行中）：预算裁决器 lib/rework.ts（openclaw child-admission 模式——轮次预算从 prompt 层收归 artifact_write 机制层）；backlog F 全量（usage 走 resolveRunDir + questionId 收编 runContext）；pi 工具 replay 声明；pi 状态×崩溃表落档。

推迟（带触发）：
- openclaw 截断会计（BootstrapInjectionStat 模式，handoff 注入的三级预算与被截断可见性）——触发 = 首次观测到 handoff 截断问题或 R2 context 工作启动时。
- 全量 trace.jsonl 统一——**有意不做**：现有异构工件链（verdicts/usage/invoke-result）已过 MVP 审计且本身是交付物，再造统一 trace 是勿增实体。

技术报告素材（G4）：「为什么自研而非基于 OpenClaw」三个结构性错配论据（session vs run 执行形态、验证环空 vs 验证环主体、证据链可判定性）+ 10 条概念对标（见会话 openclaw-study.md，报告期取用）；pi 的 explicit-state 纸面稿作为"同代 harness 的收敛趋势"引用（其树不变式与我们 .eve/ vs runs/ 边界独立同划）。

已知洞（已文档化于代码注释）：dirMtime 新鲜度检测不到"就地重写已有文件"（唯一这么干的 run.ts 收尾回写 meta 恰在自己重建索引之时）；run-batch 两题之间不持锁，web 可插队导致下一题显式 failed（符合设计）。
