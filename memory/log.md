<!--
时序日志（append-only）。每条记录的首行格式固定：

    ## [YYYY-MM-DD] <action> | q<id> | <verdict>

    action  ∈ {run, note, library-sync}
    q<id>   Science-125 题号；无题号写 q-
    verdict ∈ {SUCCESS, FAILED, PAUSED, -}

首行之下是可选的 `- ` 明细行。前缀固定 ⇒ `grep "^## \[" memory/log.md | tail -20`
就是确定性检索，零解析成本。本文件由代码追加（scripts/run.ts 收尾 + memory_note），
请勿手改、勿重排、勿删除历史条目。
-->
