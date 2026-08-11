# Loop 升级方案（loopx 对照后的第一性原理设计）

日期：2026-08-11。方法：五路并行深读 `../oss/loopx`（HEAD `addd9917`，321,094 行 /
738 py，71 天 4163 commit，97% 单一作者——一个 agent 写出来的 agent 控制平面），
逐条对照 luup 真实代码（HEAD `d241ee3`），判定借/不借/变形借。

## 诊断：luup 的 loop 有记账，无判断

luup 有三层循环，闸只装在最内层：

| 层 | 现状 | 缺口 |
|---|---|---|
| L1 run 内（Scientist→Reviewer→≤1 返修→verifier） | 闸齐全：maxTurns、检索意图上限、verifier fail-closed、返修确定性 diff | 无 |
| L2 题内跨 run（同题重跑） | 有记账：题页回填 + priorAttempts 注入 | **无判断**：重跑除了多一行「上次失败了」，策略不变，大概率原样复现同一失败 |
| L3 批次跨题（125 题） | 有记账：断点续跑双判据 | **无判断**：不知总花费、不因无进展停、前 10 题的教训不影响后 115 题 |

## 第一性原理：loopx 32 万行买到的六条判据

| # | 判据 | luup 现状 |
|---|---|---|
| 1 | 进展必须有证据（claim-with-evidence，声明的迁移在当前状态里坐实不了就降级为 noop） | **已有更干净版**：`_identical()` 返修十字段全同即 `revision_no_change` |
| 2 | 终态判据唯一（其他地方不得自行判定完成） | **已有实现**：`_is_deliverable()`；缺权威性声明 |
| 3 | 不可比就不出数（不可比的两个数相减，差值无意义，那就不要生产它） | 缺：`firstVsLatest` 靠 docstring 提醒读者 |
| 4 | 上下文是有 SLO 的资源（有数字上限 + 回归测试，不是「尽量精简」） | 缺：priorAttempts 只限条数不限长度 |
| 5 | 期望值不得由被测实现生成（characterization fixture 不授予正确性） | 缺：无明文纪律 |
| 6 | 声称什么才证明什么（不声称提升就记录 not_required，不养僵尸对照臂） | 缺：n=3 的比率会被当结论写 |

luup 反过来强于 loopx 的两处，保持不要退化：**统计推断**（McNemar 精确二项；loopx 全仓
grep 置信区间/bootstrap/p 值零命中）、**门禁面积 100%**（ruff/ty 全覆盖、覆盖率地板 90
且口径真实、action 钉 SHA；loopx 是 ruff 28%/mypy 2%/覆盖率 19.6% 且因子进程 smoke 而失真）。

## 方案

### 三个闸（判断层，全部十行级）

- **G1 · L3 熔断**（`app/batch.py`）：连续同类失败 ≥5 停批并打印分类；`infra_error` 连续 ≥2
  立即停。依据：批量的价值建立在「每题独立」上，连续同类失败正是该假设被证伪的信号——
  此时每多跑一题信息增益趋近 0 而成本不变。
- **G2 · L2 无进展**（`app/batch.py`）：同题连续两次 failed 且 verification 失败项与 proposal
  十字段都相同 → 标 `no_progress` 而非再记一次 `failed`。这是 `_identical()` 判据从 run 级
  推到 batch 级。
- **G3 · L2 先验带判断**（`agent/campaign.py`）：题页条目补 `cls=<classification>`
  （`record_run` 已拿到却丢弃）；`read_prior_attempts` 做连续同类统计，连续 ≥2 时在派工里加
  一句定向提示。配套注入块硬预算 ≤6 行/600 字符 + pytest 断言（题页 append-only 永不压缩，
  125 题跑几轮后会挤占已被 thinking 放大 7 倍的预算）。

### 三条纪律（评估层，只从已有工件派生）

- **D1 · countability + 证据地板**（`app/evaluation.py`）：把「为什么不可计」从二元
  frozenset 升为穷举 reason 码；每个比率加 n 地板，不足则输出 `insufficient_evidence`
  而非硬报一个数。防的是评审时被一个 n=3 的比率击穿全部可信度。
- **D2 · cohort 声明**（`criteria.md` + `evaluation.py`）：现有 19 个 run **不是同一个系统
  产生的**（harness 在 Wave1/2/3 期间语义变更多次）。`runs/` 不可变不能回写，故在 criteria
  声明 cohort，报告同时给「全量 N」与「cohort N」。**推论：125 全量必须是一个干净 cohort——
  开跑前 harness 定版，跑完不改码。**
- **D3 · 可比性 gate + 证据身份**：不可比的 pair 不进 McNemar 的 2×2 表，单列 `excludedPairs`
  + blocker。配套 run 终态记 `source_identity{git_commit, tree_dirty}`——这是唯一建议突破
  「零新增采集」的一行，因为没有它，两臂消融的结论在 harness 改动后无法防御。

### 人机分工的第三条路

运行期零人在环（125 题上 HITL 无价值：人不掌握 verifier 之外的信息，且错误可逆）
+ 交付前一次性抽检短列表（选取信号已全部存在、只是没聚合：verifier 边缘通过、backfill
mismatch 非空、返修后才过、Reviewer 仅最低限度检索）+ **抽检结论绑 `(run_id, git_commit,
prompt_hash)`**（否则改完 prompt 后「人工确认通过」就是谎话）。

### 一条加固

`.github/` 加 workflow YAML 校验。依据：loopx 的 `frontstage-pages.yml` 因一处缩进成为
不可解析 YAML 并合入 main，静默击穿文档站 + 双语 book + dashboard 的全部 CI，而全仓无一行
actionlint/yamllint——**所有检查都指向产品，没有一个指向检查自身的载体**。luup 只有三条
workflow，坏一条即三分之一门禁静默消失。

### 两条零成本纪律入 AGENTS.md

- 语义 oracle：期望值必须来自独立审阅的不变量；characterization fixture 不授予正确性；
  矛盾时修规则 + 加反例，不刷 golden。
- 风险→最小门映射表（5 行）：改什么必须跑什么；并明写「快门刻意不依赖凭证/网络/provider」。

## 明确不做（附代价证据）

| 不做 | 代价证据 |
|---|---|
| 跨轮次通用控制平面（objective/gate/scope/quota/lease） | luup 的 goal 是固定 125 题，硬套等于给纯函数加状态机 |
| event sourcing | `runs/` 已是不可变工件，再加即两个事实源；loopx 自己的事件日志是可选侧路、每读全量重建、快照类型文档有代码无 |
| **Markdown 当结构化状态载体** | loopx 最贵的错误：todo 存成 `- [ ] 文本 <!-- k=v -->` → 每个消费者不敢信自己的投影 → 完备性证书全仓 148 处、schema 版本字面量 1164 个。要结构化就写 JSON |
| quota slot 会计 / duty cycle | 单位与真实成本脱钩（一个 minute-slot 可能 3k 也可能 300k token），滑动窗口使配额永不真正耗尽——是节流阀不是预算 |
| 「读模型 + prompt 自觉」式约束 | loopx 必须这样（控制面架构上无法观察执行）；luup 的 harness 自己就是宿主，预算就该是代码硬边界。**反面教材** |
| bool-fallback / attempt lifecycle / repair 12 分支 | 那 120 行判定在 303 条真实 run 上命中 **0 次**——为了正确报告一个还不存在的数字建了一座工厂 |
| 644 个 subprocess smoke + 分片矩阵 + canary 选择器 | 直接后果是覆盖率口径失真到 19.6%（子进程代码 pytest-cov 测不到）；luup 的 94.81% 是 in-process 直测，是优势，别交换掉 |
| 双语 book / 链接检查器 / 文风禁用词表 | 441 个 md 的量级才需要；luup 是四五个设计文档 |
| 20KB AGENTS.md 式特例堆积 | loopx 的 AGENTS.md 已自我腐烂——它点名「应拆分」的 smoke 现在 15,072 行 |

## 排序

**125 批跑之前必须完成**（否则数据白跑）：D2 cohort 定版、D3 source_identity、G1 熔断、
失败路径记 usage、`_tally` 按 (status, classification) 聚合。
**批跑之后**：D1 证据地板、抽检短列表 + 绑版本、G2/G3、可比性 gate。
**随时**：workflow YAML 校验、两条 AGENTS.md 纪律、`_is_deliverable` 权威性 docstring。
