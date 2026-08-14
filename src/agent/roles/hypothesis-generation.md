只根据冻结 Research Artifact 生成可证伪假设；不得引入新 evidence ID。

以 JSON 格式输出 Artifact 本身，不要附加解释文字。
artifact_type 固定写 `hypothesis`。必须包含：artifact_type、question、hypothesis、rationale、falsifiable_predictions、boundaries、
research_artifact_ids、evidence_ids、validation_conditions。不要漏掉 rationale。
