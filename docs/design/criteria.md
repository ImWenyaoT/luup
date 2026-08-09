# luup MVP 验收判据

赛题：XH-202619 赛道一·方向一·A《科学假设生成与研究计划设计》。
本文件是 master 认证循环的唯一验收锚点。每项判据必须可核验（机器检查或 trace 证据），全部通过才算 MVP。

## A. 产物契约（对应评分：科学价值 40）

系统单次运行产出《科学假设与研究计划》，含全部标准化字段，任一缺失即打回：

| # | 字段 | 核验方式 |
|---|------|---------|
| A1 | Problem Statement（明确领域具体局限） | schema 必填 + judge |
| A2 | Rationale（推导链条，非空泛） | schema 必填 + judge |
| A3 | Technical Details(验证所需具体技术栈) | schema 必填 |
| A4 | Datasets（真实合规数据集，含 Source/Target 两项） | schema 必填 |
| A5 | Paper Title | schema 必填 |
| A6 | Paper Abstract（背景/方法/预期结果完整） | schema 必填 |
| A7 | Methods（实施步骤/模型架构/实验流程） | schema 必填 |
| A8 | Experiments（含 Baselines 与 Metrics） | schema 必填，两子项均非空 |
| A9 | Results（公式推导或实际执行的可行性论证） | schema 必填 |
| A10 | References（真实文献列表） | 见 B |

## B. 引用真实性（严禁虚构 —— 一票否决）

- B1 每条 reference 必须携带 arXiv id（或 DOI），且来源于本次运行中 arXiv API 实际返回的检索结果；pipeline 不接受凭空出现的引用。
- B2 验收时逐条重新 resolve arXiv id，标题需与产出中一致（允许大小写/标点差异）。
- B3 References ≥ 5 条。
- B4 作者核验：每条 reference 列出的作者姓氏必须出现在 arXiv 返回的真实作者列表中，且第一作者姓氏一致（容忍名缩写）。标题真、作者编是实测出现过的失败模式（2026-08-08 冒烟 run 5/5 条作者整组虚构），与 B2 同级一票否决。

## C. 多智能体闭环（对应评分：技术深度 30）

- C1 master agent 以判据清单逐项审核 subagent 产出，不合格打回重做；run trace 中可见 verdict（pass/reject+理由）。
- C2 ≥3 个职能 subagent（文献挖掘、假设生成、批判/可行性、计划撰写），DAG 组织，非群聊。
- C3 上下文不完全共享：subagent 之间通过显式 handoff 工件（文件/结构化摘要）传递，trace 可证。
- C4 循环有预算与终止条件（最大轮数 + 失败即如实报告失败，不硬编）。
- C5 文献层为 memory + indexing + summarization + agent 主动 search；无 vector DB、无 embedding 检索。

## D. 模型合规

- D1 所有 LLM 调用走百炼 Qwen（QWEN_BASE_URL + QWEN_API_KEY），可出调用凭证（请求日志/用量截图）。
- D2 使用 responses API；不兼容处用兼容层解决，不换协议。

## E. 可复现性（对应评分：应用潜力 30 之代码可复现 10）

- E0 问题源 = 官网维度 A 指定的《Science》125 前沿科学问题：lib/science125.json（权威来源抓取，恰 125 条）；pipeline 按题号取题，也接受自由问题输入。
- E1 单命令跑通 E2E：输入一个科学问题（默认取自 Science-125）→ 落盘完整《科学假设与研究计划》(JSON + Markdown) 于 runs/<ts>/。
- E1b 批量能力：批量 runner 可按题号列表串行跑多题（MVP 验证 ≥2 题抽样；全量 125 题为提交期动作，非 MVP 门槛，预算由用户拍板）。
- E2 `pnpm typecheck` 通过。
- E3 run trace（各 agent 输入输出、master verdict、token 用量）落盘可查。

## G. 交付面（官网提交要求，2026-08-08 由用户确认原文）

最终提交 PPT/PDF ≤20 页，须包含：可调用测试 API 与可交互前端页面入口；代表性测试案例及输入输出；详细技术报告与源码；方向 A 须提交全部 125 个科学问题的输出结果文档。据此：

- G1 可调用测试 API：HTTP 入口（文档化：端点、入参、示例 curl），可触发一次 pipeline 并取回结果。
- G2 可交互前端：Vercel 栈（Next.js + Tailwind，不加多余依赖），能选题/输入问题、触发运行、展示节点工件与 verdicts 时间线、渲染 proposal 与验收报告、浏览历史 runs。设计身份：teal 单信号色 / mono 仪表体 / 网格底 / reasoning spine / dark auto。
- G3 代表性测试案例：runs/ 已留存（Q61 等，含输入输出与验收报告），前端可展示。
- G4 技术报告：PDF ≤20 页骨架（研究问题与方法、架构讲解、真实案例、上下文工程设计）——提交期完稿。
- G5 全量 125 题输出：批量 runner 须支持断点续跑（跳过已完成题）；全量生产跑为提交期动作（时长/费用由用户拍板），MVP 验证抽样 + 续跑能力。

MVP 门槛 = G1 + G2 可用、G3 已有、G5 续跑能力验证；G4 骨架。

## F. MVP 边界（less is more）

- 不做：演示视频、SFT 微调、vector DB、多模态数据处理（技术方案文档中论述扩展路径即可）。
- 领域样例：以天文类问题为默认 E2E 用例（呼应发榜单位国家天文台），但 pipeline 领域无关。

## H. 评估体系（书 ch6 为理论底，2026-08-09 定稿；全自动，human over the loop）

四原则：gate 全确定性，judge 只产诊断分不产 gate；**rubric 永不进 agent prompt**（防 Goodhart）；指标只从已有工件派生（零新增采集）；每个指标必须能翻盘一个真实决定，否则不设。

| 层 | 指标 | 定义/数据源 | 翻盘什么决定 |
|---|------|------------|-------------|
| Tier0 | 现状保留 | B1–B4 验收器、eve evals、verdicts | 单 run 通过性 |
| Tier1（零 LLM 派生） | M4 交付率 | deliverable runs / 总 runs（runOutcome） | 战役节奏 |
| | M5 Pass^2 | 同题连续 2 次均 deliverable 的比例 | 可靠性口径（替代单次快照） |
| | M6 成本会计 | usage.jsonl 聚合：token/题、¥/题、按节点分解 | 重跑预算、模型分档 |
| | M7 返工强度 | verdicts 轮次分布、熔断率 | instructions/节点质量定位 |
| | M8 文献健康 | refs 数、检索命中率、library 复用率 | 检索策略、学科覆盖预警 |
| Tier2 | M9 质量评分 | 四维（假设可证伪性/推导自洽/方案可落地/引用支撑度）×四级 rubric，LLM-judge 产分 + 断言归因；虚构类断言 = veto。只允许对确定性 deliverable run 评分并写题页 | 校准达标后用于版本择优；否则仅诊断 |
| | M10 judge 校准 | **变异体检出率**：对已通过 proposal 施加确定性劣化（加长零信息/删推导链/插无出处数值等），标签先验已知，检出率即 judge 灵敏度——全自动零人标 | M9 可信度；检出率低 → M9 降权 |
| Tier3 | M11 配对版本比较 | 同题多版本 McNemar 判读（125 题天然满足配对前提） | 改动是否真的更好 |

- **同族 judge 诚实条款**：judge 也是 Qwen（D1 锁死），无法消解自评偏置——处置是结构性降权（M9 只用于择优与诊断，永不进 gate、永不进报告的"成绩"栏），不假装校准过。
- **M9 排序授权**：同 rubric、同 judge 模型的 M10 报告须满足可判样本 ≥4、检出率 ≥75%、逆序 0；否则 M9 整级跳过。授权从 `calibration.md` 与 `score.json` 元数据复算，不接受手工布尔开关。
- **自进化闭环**（全自动）：run → 确定性交付 gate → M9 评分 → 题页 memory（**只回传事实不回传分数**：胜出假设、被拒原因、检索有效性）→ 重跑消费 → 版本择优纯函数（gate → 校准合格时 M9 → refs 数 → token 成本，字典序）。
- **ablation 白捡项**：memory/ 可删除性 = 现成的记忆贡献量化开关（技术报告实验素材，抽样跑）。
- 不做清单（防巨无霸，理由存 backlog）：Elo、用户模拟、人工反馈环（赛题"或"字裁决）、仿真环境、统一 trace、参数化防泄漏。

## 终审流程

master（本会话）逐项核对 A–E：机器可验项跑脚本，judge 项亲自读产物。任何一项不过 → 定位责任层 → 打回对应实现 → 重跑。全过后才允许宣布 MVP 达成。
