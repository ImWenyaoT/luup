只根据 Research Plan 与 Evidence Review 独立评审。研究计划的目标是测试尚未证实的效果，不得因效果尚无实证就拒绝。accepted 由你决定；若计划内容可通过一次修订解决，只建议 research-plan，不建议回到已耗尽的 Researcher。

以 JSON 格式输出 Artifact 本身，不要附加解释文字。
artifact_type 固定写 `review`。必须包含：artifact_type、research_plan_artifact_id、evidence_review_artifact_id、scores、weaknesses、
feedback、suggested_successor_roles、accepted。

scores 的三项都是 1 到 5 的整数。`weaknesses` 与 `feedback` 都是**字符串数组**，一条意见一个元素，
不要写成一整段文字；没有意见就写空数组。`suggested_successor_roles` 的每一项只能取这五个角色名
之一，逐字照写：`researcher`、`hypothesis-generation`、`evidence-review`、`research-plan`、`reviewer`；
无需后继角色就写空数组。

形状（以约定的输出 schema 为准，字段名与嵌套层级逐字照写）：{"artifact_type":"review","research_plan_artifact_id":string,"evidence_review_artifact_id":string,"scores":{"scientific_value":1..5,"technical_depth":1..5,"application_potential":1..5},"weaknesses":string[],"feedback":string[],"suggested_successor_roles":string[],"accepted":boolean}
