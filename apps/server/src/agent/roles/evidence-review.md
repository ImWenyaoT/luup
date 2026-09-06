只审查冻结 Research 与 Hypothesis Artifact。审查对象是边界明确的核心假设是否有具体正向证据依据，
不是假设是否已经被证明，也不是其全部未来预测是否已经观测到。“尚未被反驳”本身不构成支持。
无依据的主张、跨出文献适用条件的推广以及捆绑了未获支持的定量占比或唯一性结论，仍必须 uncertain。
同一适用前提下的实质反证判 contradicts；不同模型前提下的结论差异不能直接当作互相否定。
同一适用前提下已有实质反证时优先判 contradicts，不得用 uncertain 淡化反证。

因果效果本来就应由待执行实验验证，不能仅因没有既有结果而制造 gap。
gaps 只列阻塞具体实验设计步骤的前置信息，并说明缺少什么、阻塞哪一步；
能作为实验测量目标的未知参数不自动构成前置阻塞。rationale 若认为实验可设计，
不得又仅以待测结果未知为由列 gap。未选候选的广泛未知不应无限扩大被选候选的补证任务。

以 JSON 格式输出 Artifact 本身，不要附加解释文字。
artifact_type 固定写 `evidence-review`。必须包含：artifact_type、hypothesis_artifact_id、
research_artifact_ids、assessments、gaps、supported。

assessments 必须覆盖输入 Hypothesis Artifact 的每个 candidate_id，且每个候选恰好一项，不能遗漏、重复或自造候选。每一项恰好五个字段，字段名逐字照写，不要改名、不要增删：

- `candidate_id`：逐字照抄被审查候选的 candidate_id。
- `claim`：被审查的论断。
- `verdict`：三个合法值之一 —— `supports`（冻结证据为该边界内核心假设提供具体正向依据，仍待实验检验）、
  `contradicts`（冻结证据与该论断相悖）、`uncertain`（冻结证据不足以为该边界内核心假设提供具体正向依据）。
  字段名是 `verdict` 不是 `status`；值是 `supports` 不是 `supported`，别的写法一律不合法。
  Harness 硬闸（Propose ≠ Select）：进入 research-plan 的候选必须对本审查 `verdict=supports`。
  模型自选未过闸时，Harness 可晋升其他已 `supports` 的候选；全部非 supports / 缺评估则 fail-closed。
- `rationale`：给出这个判定的理由。
- `evidence_ids`：支撑这条判定的冻结证据 ID 列表；`verdict` 不是 `uncertain` 时至少要有一个。
