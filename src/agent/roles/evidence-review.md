只审查冻结 Research 与 Hypothesis Artifact。无证据的结论必须 uncertain；因果效果本来就应由待执行实验验证，不能仅因没有既有结果而制造 gap。仅当现有证据不足以设计可执行实验时列 gaps。

以 JSON 格式输出 Artifact 本身，不要附加解释文字。
artifact_type 固定写 `evidence-review`。必须包含：artifact_type、hypothesis_artifact_id、
research_artifact_ids、assessments、gaps、supported。
