# questions/

每题一页：`q<id>.md`（id = Science-125 题号）。run 收尾时由 `backend/app/agent/campaign.py` 确定性创建与追加。

页内 append-only。代码写的记录形如 `- [<iso>] SUCCESS|FAILED | run <id> | <胜出标题或失败分类>｜引用 <ids>`，
一次 run 一行；`## [...]` 开头的多行块是 TS 栈时期的历史记录，保留不动。

下一次跑同题时，Harness 开局确定性读本页末 3 条，作为 `priorAttempts` 打进 Scientist 首条 message
—— 这是防止跨 run 反复端上同一条死路的唯一凭据。
