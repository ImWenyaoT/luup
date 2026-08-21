基于所有冻结 Artifact 生成简体中文、尚待验证的研究计划。

artifact_type 固定写 `research-plan`。

不得声称实验已经完成，results.status 固定为 pending_verification。
预注册采用 bounded comparison，不做显著性主张；`results.expected_outcomes` 不得使用“显著”、
“统计显著”或 significant，只能写方向、差值、区间及继续/停止条件。

results.validation_basis 固定为 `formula_derivation`。results.feasibility_argument 必须是非空的简体中文有限公式或逻辑推导，
说明关键假设、预期指标关系或范围，以及如何据此判定实验设计可行；论证至少写清这些关系，不能只写“可行”或其他空洞短语。
这只是可行性论证，不是实验结果；不得声称实验已经执行、已经观测到数据或已经验证假设。

`execution_plan` 是必须填写的可执行闭环，不得用“进一步研究”代替具体步骤：

- `predictions` 至少一项，每项绑定输入假设的 `candidate_id`，写可观测预测和明确的
  `falsification_criterion`；预测是待检验命题，不是已证实结论。
- `data_requirements` 至少一项，每项写数据/资料 `source`、要测量的 `variables` 和实际 `conditions`。
- `steps` 至少两步，按 `order` 写动作及其 `expected_output`；`analysis` 写分析方法、输入和决策规则。
- `result_interpretations` 至少两条，分别说明不同观测结果的含义；还必须写
  `stop_conditions`、`rollback_conditions` 和 `supplement_evidence_conditions`，分别说明何时停止、回退或补证。

experiments.baselines 与 experiments.metrics 各至少两项，去重后也要够两项。每一项都是
`{name, evidence_id}`：name 用简体中文写清这一项是什么，evidence_id 必须取自
verification_evidence_ids 中的某个冻结证据 ID，不要自己编 ID、也不要把说明文字塞进 name。

results.expected_outcomes 里每个 metric 必须逐字等于 experiments.metrics 中某一项的 name。

references 至少 5 条，且只能填冻结 Research Artifact 里出现过的 URL。冻结来源不足 5 条时照实填全部，
不要为了凑数编造链接 —— 终局验收会逐条把 arXiv 引用拿去官方 API 独立反查，编的会被当场查出来。

`datasets`、`source`、`target` 是三个**平铺的顶层字段**，不是一个嵌套对象，也不许把后两个塞进
`datasets` 的元素里：`datasets` 是字符串数组，每项写一个数据集的名字；`source` 是一个字符串，
写上游材料出处 —— 这两个都保持原名不翻译。`target` 是**研究目标的中文叙述**（这项研究要达成什么），
不是「目标数据集」或「目标域」的英文名。problem_statement、rationale、technical_details、
paper_title、paper_abstract、methods、experiments.design、各项 name 与
expected_outcomes[].statement 也都必须是简体中文正文。

两个绑定字段必填，逐字照抄输入里已有的 ID，不要自造：`input_artifact_ids` 写输入 Artifact
的全部 id（至少三个）；`verification_evidence_ids` 写这份计划要核验的冻结证据 ID，不能为空。

以 JSON 格式输出 Artifact 本身，不要附加解释文字。

形状（以约定的输出 schema 为准，字段名与嵌套层级逐字照写）：{"artifact_type":"research-plan","problem_statement":string,"rationale":string,"technical_details":string,"datasets":string[],"source":string,"target":string,"execution_plan":{"predictions":[{"candidate_id":string,"prediction":string,"falsification_criterion":string}],"data_requirements":[{"source":string,"variables":string[],"conditions":string[]}],"steps":[{"order":number,"action":string,"expected_output":string}],"analysis":[{"method":string,"inputs":string[],"decision_rule":string}],"result_interpretations":[{"observed_result":string,"meaning":string}],"stop_conditions":string[],"rollback_conditions":string[],"supplement_evidence_conditions":string[]},"paper_title":string,"paper_abstract":string,"methods":string,"experiments":{"baselines":[{"name":string,"evidence_id":string}],"metrics":[{"name":string,"evidence_id":string}],"design":string},"results":{"status":"pending_verification","validation_basis":"formula_derivation","feasibility_argument":string,"expected_outcomes":[{"metric":string,"statement":string}]},"references":string[],"input_artifact_ids":string[],"verification_evidence_ids":string[]}
