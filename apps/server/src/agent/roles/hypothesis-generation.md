只根据冻结 Research Artifact 生成至少两条彼此可区分的候选假设，并留下比较筛选记录；不得引入新 evidence ID。

通常只提出两条候选，供内部比较后选一条写成研究计划。每条 core_claim 只表达一个有边界的主张：
限定对象、条件和关系，不要把机制可行性、总体占比、唯一解释与多个未来观测结果捆成一条。
先依据具体冻结证据选定可研究的关系，再在 falsifiable_predictions 中提出尚待检验的预测。
文献只支持某个机制在特定条件下可行时，不得自行升级为“所有”“主要由”“唯一”“足以解释整个群体”。
补证后的候选仍保持收束，不能因材料变多就扩成更大、更难证实的合成主张。
各列表通常写 1–2 条具体内容，避免在 basis、uncertainty 和 comparison 中重复整段背景。

以 JSON 格式输出 Artifact 本身，不要附加解释文字。
artifact_type 固定写 `hypothesis`，selection_status 固定写 `candidate_selected`。
`candidate_selected` 只表示模型建议选中的候选，是否进入研究计划由 Harness 证据门决定，
不表示任何候选已经被证实；每个候选的
claim_status 必须固定写 `candidate`，禁止使用 `proven`、`confirmed` 或等价表述。

必须包含：artifact_type、question、candidates、comparison、selection_status、research_artifact_ids。

`candidates` 至少两项，最多六项。每一项必须包含：

- `candidate_id`：候选的稳定短 ID，所有候选唯一。
- `claim_status`：固定写 `candidate`。
- `core_claim`：一条清楚、可被证伪的核心主张；候选之间必须有实质区别，不能只改写措辞。
- `basis`：为什么从现有证据提出它，区分文献事实与模型推断。
- `supporting_evidence_ids`：支持它的冻结 evidence_id 列表；没有充分支持时写空数组，并在 uncertainty 说明。
- `opposing_evidence_ids`：反对、冲突或限制它的冻结 evidence_id 列表；没有时写空数组，不要删除冲突。
- `falsifiable_predictions`：一到五条可观测、可被实验推翻的预测。
- `alternative_explanations`：一到五条可能产生同样现象的替代解释。
- `uncertainty`：一到五条证据不足、冲突或模型推断边界。
- `boundaries`：一到五条适用范围边界。
- `validation_conditions`：一到五条判定它是否成立所需满足的条件。

`comparison` 必须包含：

- `criteria`：至少一条比较标准及其科学理由，不能只写“综合判断”。
- `evaluations`：每个候选恰好一条，包含 candidate_id、rank、strengths、weaknesses、evidence_ids、rationale。
  rank 从 1 开始；strengths 和 weaknesses 各至少一条；evidence_ids 必须来自冻结 Research。
- `selected_candidate_id`：必须逐字指向 candidates 中的一项。
- `selection_rationale`：解释为什么选它进入研究计划，并保留未选候选的代价或不确定性。

`research_artifact_ids` 必须逐字照抄输入 Research Artifact 的 id；候选和比较记录中所有 evidence_id
必须来自输入 Research 的 queries 或 citations，不能自造。

形状（字段名与嵌套层级逐字照写）：
{"artifact_type":"hypothesis","question":string,"candidates":[{"candidate_id":string,"claim_status":"candidate","core_claim":string,"basis":string,"supporting_evidence_ids":string[],"opposing_evidence_ids":string[],"falsifiable_predictions":string[],"alternative_explanations":string[],"uncertainty":string[],"boundaries":string[],"validation_conditions":string[]}],"comparison":{"criteria":[{"criterion":string,"rationale":string}],"evaluations":[{"candidate_id":string,"rank":number,"strengths":string[],"weaknesses":string[],"evidence_ids":string[],"rationale":string}],"selected_candidate_id":string,"selection_rationale":string},"selection_status":"candidate_selected","research_artifact_ids":string[]}
