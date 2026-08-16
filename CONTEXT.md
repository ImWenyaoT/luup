# luup 领域词汇

| 术语 | 含义 | 代码锚点 |
|------|------|---------|
| **run** | 一次 `question → 五角色串行 → 确定性验收` 的执行；全部事实落在 SQLite 单库里 | `apps/server/src/harness.ts` |
| **Harness** | 确定性调度器（循环引擎），运行时角色而非子目录；拥有工具执行、预算、状态、证据和验证，不是另一个 LLM Agent | `apps/server/src/harness.ts` |
| **五角色** | researcher → hypothesis-generation → evidence-review → research-plan → reviewer，固定串行 | `apps/server/src/agent/roles/` |
| **上界** | 补证 ≤2 轮、修订 ≤2 轮，写成 `for` 循环而不是依赖图；顺序由代码决定不由数据决定 | `apps/server/src/harness.ts` |
| **Attempt** | 一个角色的一次执行。含一次结构化纠错（`attempts.corrections`），但**没有隐式重试**——纠错不是重试 | `apps/server/src/roles.ts` |
| **工件（artifact）** | 角色输出的冻结结构化产物；发布后不可变，下游只能读冻结版本 | `apps/server/src/store/store.ts` |
| **证据台账** | 每次检索的 query、结果与结局（八个 `EvidenceStatus`）；失败的 Attempt 也留台账 | `apps/server/src/agent/evidence.ts` |
| **handoff** | 角色之间只传冻结 Artifact，不共享隐藏上下文 | `apps/server/src/harness.ts` 的 `toInput` |
| **独立验收** | 零 LLM 的 B1–B4 引用真实性检查；失败必须 fail-closed；模型不可见，属 harness 角色 | `apps/server/src/verify/verifier.ts` |
| **run outcome** | 对外只有 `running → completed \| review_rejected \| failed`；内部阶段不扩大 HTTP 契约 | `apps/server/src/store/schema.ts` |
| **公开投影** | 出网字段的 allowlist；审计、恢复、rationale、原始 payload 一律不公开 | `apps/server/src/api/projection.ts` |
| **seam（接缝）** | 可整块替换的四个位置：模型接线、验收器、Run 记账面、记忆通道 | `apps/server/src/seams/index.ts` |
| **战役记忆** | 根 `memory/`；文件制 Markdown，确定性字符匹配零 embedding；只在开局注入一次，模型没有自主读取通路 | `apps/server/src/campaign/campaign.ts` |
| **消融臂** | `--no-memory` 关掉的是记忆**数据通道**本身，不是一个返回空结果的工具 | `apps/server/src/batch/runner.ts` |
| **失败分类** | 终态失败的权威枚举；`INFRASTRUCTURE_*` 与质量类失败分桶报 | `apps/server/src/agent/failures.ts` |
| **离线评估** | 从既有 SQLite 库复算 gate、版本选择与 McNemar 配对比较，不调用模型或网络 | `apps/server/src/eval/metrics.ts` |
| **HTTP adapter** | `node:http` 暴露运行接口并同端口托管 `apps/web/dist`；前端只消费 HTTP | `apps/server/src/server.ts` |
