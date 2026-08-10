# ai-agent-book 对齐审计（2026-08-10）

方法：书（`../oss/ai-agent-book` @ `3d100b5`）十章全文 + 思考题 + 实验，七路并行对照
luup 代码（HEAD `2857769`），判定四态｛符合/偏离/部分/不适用｝，全部结论带 file:line 证据，
schema/用量断言经实际实例化验证。本文是综合；单章明细在各审计原文。

## 总判定

架构选型与书高度对齐且多处更强（可直接写进技术报告）：工作流骨架+节点内自主（ch1）、
隔离优于压缩（ch2）、no-RAG 有 B1 provenance 硬据（ch3）、零 LLM 模态切换验收（ch4）、
错误路径绝不再调模型（ch5）、rubric 永不进 prompt + gate/judge 分权（ch6）、
不做后训练有书面判据（ch7:355）、Reviewer 强制新信息是 ch10 唯一实质判据的代码级执行。

偏离集中在三个主题，全部是实现层，无一架构层：

1. **栈迁移断链**：campaign memory 写入侧、M9/M10 生产者（score/calibration）、批量 runner
   随 TS 栈删除且未重建；文档仍描述已不存在的机制（幻觉源）。
2. **模型可见面欠账**：usage 记账恒空（SDK 属性用错）、四工具 description 全空、
   query 静默 AND 改写不回传、newCount/预算不回灌、prompt 三处虚假承诺。
3. **统计与验证前提**：返修闭环无人核验 requiredChanges、M11 配对取首末不可比、
   跨 run memory 破坏重复采样独立性、M4 无法区分环境性/质量性失败。

## 偏离清单（按严重度）

### P0 —— bug 与交付阻塞

| # | 偏离 | 证据 | 修复 |
|---|---|---|---|
| 1 | usage 记账恒空：`RunResult` 无 `usage` 属性 | specialists.py:148；run 20260810-092300 无 usage.jsonl | 改读 `result.context_wrapper.usage`（1 行）+ 补真型回归测试 |
| 2 | thinking 记账与事实相反（记 True 实为 False） | orchestrator.py:48,63,84 | 读实参或删字段 |
| 3 | 批量 runner 不存在（125 全量交付无载具） | criteria.md:49 承诺 vs backend 无实现 | 题号列表 + 跳过已成功 + 串行调 run_cli |
| 4 | judge 检出率 0% 的 score.json 仍在工件中可被误读 | runs/20260808-134046/calibration.md：0/4、逆序 1 | M9/M10 终局裁决（重建或标注退役），别留第三态 |
| 5 | 子进程无超时，网络挂死永久占锁 | launch.py:254-261 | `child.wait(timeout)` + kill + FAILED.md |

### P1 —— 模型可见面（合计 ≤60 行）

| # | 偏离 | 证据 | 修复 |
|---|---|---|---|
| 6 | 四工具 description 全空（书实测 45% 错误率差距） | runtime.py:191-221，实测 description=='' | 各补 2-4 行 docstring |
| 7 | query 被静默 AND 改写不回传（实测 3/7 检索空结果） | arxiv.py:107-120 vs runtime.py:128 | 返回值加 arxivQuery 字段 |
| 8 | newCount 只落盘不回灌，Reviewer 被看不见的指标裁决 | runtime.py:121-128 vs 83-85 | 返回值加 newCount + 空结果 hint |
| 9 | 预算计数模型不可见（书 ch2 状态栏核心反例） | runtime.py:35-44 | 返回值加 used/max（3 行） |
| 10 | 预算类终局错误回 "Please try again" 致空转 | SDK default_tool_error_function | failure_error_function 定制 |
| 11 | prompt 三处虚假承诺（假 schema/无作者列的索引/不执行的预算） | scientist.md:9,13-16、reviewer.md:11 | 改措辞/删数字/索引加作者列 |
| 12 | backfill 静默覆盖不留 mismatch 记录（ch5 log_mismatch） | specialists.py:170-180 | tool-events 加 5 行 |

### P2 —— 闭环与统计（需拍板项标 ★）

| # | 偏离 | 修复 |
|---|---|---|
| 13 | 返修后无人核验 requiredChanges；findings 不传给返修 | 确定性 diff（未变即 fail）+ RevisionRequest 带 findings（~20 行） |
| 14 | memory 写入侧缺失：回填断、检索分桶错、派工不注入 | run 收尾确定性追加（~30 行）+ memory.py 分桶配额（~10 行）+ qid 入 meta |
| 15 | 消融无臂标签；memory 不可关 | cli 加 --no-memory；LuupTools 形参 `Path\|None`；meta 写臂 |
| 16 | M11 配对取首末不可比；无 Pass^2/M7/M8/SE 聚合 | 全同题多对配对 + 纯函数聚合（数据已在手） |
| 17 | M4 不分环境性/质量性失败；FAILED.md 无分类 | verification 加 infraError；FAILED 加分类标签 |
| 18 | tool-events 只记 arxiv_search（memory_search 零痕迹） | 四工具各补一次 _append_tool_event |
| 19 | console.log 面板是死的（stdout 进 DEVNULL） | 删面板（删除大于优化） |
| 20★ | 泛化零证据（125 题既是交付又是全部指标源） | 跑少量自由输入 OOD 题；不跑则报告不得提泛化 |
| 21 | CLI run 无 questionId，评估不可见 | run_cli 加参数 |
| 22 | 文档幻觉源：SCHEMA.md/memory.md/report outline 描述已删机制 | 随 #14 修复或标注退役 |

## 明确不做（书自身判据）

MCP/事件驱动/子 Agent 原语（ch4 后半）、上下文压缩与 Skills（ch2，规模差两个数量级）、
向量检索全家（ch3，C5+B1 双重否决）、消息总线/辩论/多数表决（ch10）、SFT/RL（ch7:355 +
criteria D1/F）、语音/CU/机器人（ch9）、SSE 流式（延迟预算差三个数量级，维持 2s 轮询）、
提示注入检测器（攻击链缺③④不闭合）。

## 技术报告可引素材

ch1:360（工作流优先）、ch2 隔离优于压缩、ch3 思考题 1/5/8（luup 是正面样本）、
ch4 思考题 6（终局一次性验证摊薄成本）、ch5:494-501+代码级强化、ch6 L477 Goodhart、
ch7:355/542/516（不训练判据/非对称验证器/reward seeking 命名）、ch9 B1（轮询正当性）、
ch10:46-60（多 Agent 唯一实质判据）。同族 judge 诚实条款按已知局限如实写。
