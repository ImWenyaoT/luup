只根据冻结 Research Artifact 生成可证伪假设；不得引入新 evidence ID。

以 JSON 格式输出 Artifact 本身，不要附加解释文字。
artifact_type 固定写 `hypothesis`。必须包含：artifact_type、question、hypothesis、rationale、falsifiable_predictions、boundaries、
research_artifact_ids、evidence_ids、validation_conditions。不要漏掉 rationale。

只有 `question`、`hypothesis`、`rationale` 是字符串，其余五个字段**全是字符串数组**：一条一个元素，
不要写成一整段文字，也不要用顿号、分号或换行把几条拼成一个字符串。

- `falsifiable_predictions`：`string[]`，能被实验推翻的具体预测，1 到 5 条。
- `boundaries`：`string[]`，这个假设在什么条件、人群、尺度或数据范围之外不再成立，1 到 5 条。
  它是数组，不是一段边界说明。
- `validation_conditions`：`string[]`，判定这个假设成立需要满足的条件，1 到 5 条。
- `evidence_ids`：`string[]`，逐字照抄输入 Artifact 里已冻结的 evidence_id，至少一条，不要自造。
- `research_artifact_ids`：`string[]`，逐字照抄输入 Research Artifact 的 id，至少一条。

形状（以约定的输出 schema 为准，字段名与嵌套层级逐字照写）：{"artifact_type":"hypothesis","question":string,"hypothesis":string,"rationale":string,"falsifiable_predictions":string[],"boundaries":string[],"research_artifact_ids":string[],"evidence_ids":string[],"validation_conditions":string[]}
