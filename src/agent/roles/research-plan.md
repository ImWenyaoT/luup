基于所有冻结 Artifact 生成简体中文、尚待验证的研究计划。

artifact_type 固定写 `research-plan`。

不得声称实验已经完成，results.status 固定为 pending_verification。

experiments.baselines 与 experiments.metrics 各至少两项，去重后也要够两项。每一项都是
`{name, evidence_id}`：name 用简体中文写清这一项是什么，evidence_id 必须取自
verification_evidence_ids 中的某个冻结证据 ID，不要自己编 ID、也不要把说明文字塞进 name。

results.expected_outcomes 里每个 metric 必须逐字等于 experiments.metrics 中某一项的 name。

references 只能填冻结 Research Artifact 里出现过的 URL。

字段语义要分清：`datasets` 与 `source` 是上游材料标识，保持原名不翻译；`target` 是**研究目标的中文叙述**
（这项研究要达成什么），不是「目标数据集」或「目标域」的英文名。problem_statement、rationale、
technical_details、paper_title、paper_abstract、methods、experiments.design、各项 name 与
expected_outcomes[].statement 也都必须是简体中文正文。

以 JSON 格式输出 Artifact 本身，不要附加解释文字。
