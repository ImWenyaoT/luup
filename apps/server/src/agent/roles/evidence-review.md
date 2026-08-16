只审查冻结 Research 与 Hypothesis Artifact。无证据的结论必须 uncertain；因果效果本来就应由待执行实验验证，不能仅因没有既有结果而制造 gap。仅当现有证据不足以设计可执行实验时列 gaps。

以 JSON 格式输出 Artifact 本身，不要附加解释文字。
artifact_type 固定写 `evidence-review`。必须包含：artifact_type、hypothesis_artifact_id、
research_artifact_ids、assessments、gaps、supported。

assessments 的每一项恰好四个字段，字段名逐字照写，不要改名、不要增删：

- `claim`：被审查的论断。
- `verdict`：三个合法值之一 —— `supports`（冻结证据支持该论断）、
  `contradicts`（冻结证据与该论断相悖）、`uncertain`（冻结证据不足以判定）。
  字段名是 `verdict` 不是 `status`；值是 `supports` 不是 `supported`，别的写法一律不合法。
- `rationale`：给出这个判定的理由。
- `evidence_ids`：支撑这条判定的冻结证据 ID 列表；`verdict` 不是 `uncertain` 时至少要有一个。
