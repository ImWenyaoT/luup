# luup MVP 验收判据

赛题：XH-202619 赛道一·方向一·A《科学假设生成与研究计划设计》。
本文件是 Harness 与维护者的唯一验收锚点。每项判据必须可核验（机器检查或 trace 证据），全部通过才算 MVP。

官方要求与内部设计的边界见 [product-contract.md](product-contract.md)。官方事实不得由现有实现反推。

## A. 产物契约（对应评分：科学价值 40）

系统单次运行产出《科学假设与研究计划》，含全部标准化字段，任一缺失即打回：

| # | 字段 | 核验方式 |
|---|------|---------|
| A1 | Problem Statement（明确领域具体局限） | schema 必填 + 维护者人工终审 |
| A2 | Rationale（推导链条，非空泛） | schema 必填 + 维护者人工终审 |
| A3 | Technical Details(验证所需具体技术栈) | schema 必填 |
| A4 | Datasets（真实合规数据集，含 Source/Target 两项） | schema 必填 |
| A5 | Paper Title | schema 必填 |
| A6 | Paper Abstract（背景/方法/预期结果完整） | schema 必填 |
| A7 | Methods（实施步骤/模型架构/实验流程） | schema 必填 |
| A8 | Experiments（含 Baselines 与 Metrics） | schema 必填，两子项均非空 |
| A9 | Results（公式推导或实际执行的可行性论证） | schema 必填 |
| A10 | References（真实文献列表） | 见 B |

**A1/A2 的自动化覆盖缺口（M9/M10 退役的后果，必须写在这里）**：judge 退役后，A1/A2 只剩「字段非空且符合 schema」这一条机器检查，**方案的实质性质量——问题陈述是否真的指向一个具体局限、推导链条是否空泛——不再有任何自动化覆盖**，只由维护者人工终审兜。全流程唯一仍被机器逐条核验的实质属性是**引用真实性**（B1–B4）。所以本项目可自动验证的成绩边界是「引用不造假 + 字段齐全」，不是「科学质量达标」；技术报告与 PPT 引用 A1/A2 时必须照此表述，不得把 schema 通过率说成质量通过率。

## B. 引用真实性（严禁虚构 —— 一票否决）

- B1 每条 reference 必须携带 arXiv id（或 DOI），且来源于本次运行中 arXiv API 实际返回的检索结果；pipeline 不接受凭空出现的引用。
- B2 验收时逐条重新 resolve arXiv id，标题需与产出中一致（允许大小写/标点差异）。
- B3 References ≥ 5 条。
- B4 作者核验：每条 reference 列出的作者姓氏必须出现在 arXiv 返回的真实作者列表中，且第一作者姓氏一致（容忍名缩写）。标题真、作者编是实测出现过的失败模式（2026-08-08 冒烟 run 5/5 条作者整组虚构），与 B2 同级一票否决。

## C. 多智能体闭环（对应评分：技术深度 30）

- C1 最终交付由确定性 verifier 判定；Reviewer 必须通过独立检索或工具验证引入新信息，不能只重读同一文本。
- C2 使用 OpenAI Agents SDK 的 Scientist / Reviewer 两类 specialist（TS 栈实现为五角色固定流水线，见 experiment-protocol.json 修订 #1），由普通 TypeScript Harness 主从式调度；不设 subagent 数量门槛。〔2026-08-16：切栈（ADR-0004）漏改补正，原文「普通 Python Harness」「两 specialist」；实现事实以 `src/harness.ts` 与 canary 实测为准。〕每个独立角色必须以信息增量或消融收益证明存在价值。
- C3 上下文不完全共享：subagent 之间通过显式 handoff 工件（文件/结构化摘要）传递，trace 可证。
- C4 循环有预算与终止条件（最大轮数 + 失败即如实报告失败，不硬编）。
- C5 文献检索不引入 vector DB 或 embedding 基础设施；跨 run memory 只有在消融证明收益后才进入最小架构。

## D. 模型合规

- D1 所有 LLM 调用走百炼 Qwen（QWEN_BASE_URL + QWEN_API_KEY），可出调用凭证（请求日志/用量截图）。
- D2 使用 responses API；不兼容处用兼容层解决，不换协议。

## E. 可复现性（对应评分：应用潜力 30 之代码可复现 10）

- E0 问题源 = 官网维度 A 指定的《Science》125 前沿科学问题：`data/science125.json`（权威来源抓取，恰 125 条）；pipeline 按题号取题，也接受自由问题输入。
- E1 单命令跑通 E2E：输入一个科学问题（默认取自 Science-125）→ 落盘完整《科学假设与研究计划》(JSON + Markdown) 于 runs/<ts>/。
- E1b 批量能力：批量 runner（`pnpm batch --ids 1-125｜3,54,61`，`--dry-run` 零执行）可按题号列表跑多题，题按升序派发进有界并发池（`--concurrency`，默认 3、上限 5，1 即串行；安全性论证与熔断语义见 `src/batch/runner.ts` 的 `runBatch`，协议修订见 `docs/design/experiment-protocol.json`）（MVP 验证 ≥2 题抽样；全量 125 题为提交期动作，非 MVP 门槛，预算由用户拍板）。
- E2 `pnpm run ci` 全绿：typecheck / oxlint / 覆盖率地板（见 `vitest.config.ts`）/ build，外加 `pnpm run test:e2e`（口径以 AGENTS.md 验证节为准）。〔2026-08-15 ADR-0004：此前是「Python 后端 pytest（地板 90）/Ruff/ty + OpenAPI client 生成检查 + Vite 前端 typecheck/build」，随 Python 栈退役改写；**要求未松动，覆盖率地板换了分母**——90 是 `backend/app` 的，现行四项地板是根包 `src/` 的实测值向下取整。〕
- E3 run trace（各 agent 输入输出、Reviewer 结论、verifier 结果、token 用量）落盘可查。

## G. 交付面

官网当前要求技术方案 PDF ≤20 页，包含研究问题与方法、架构讲解、代表案例、源码、工作流、上下文工程、数据来源、结果与反馈迭代；FAQ 要求方向 A 提交全部 125 个问题结果。前端与测试 API 虽不是官方硬门，但由本项目主动选择交付；演示视频明确不做。据此：

- G1 可调用测试 API：保持现有入口可用，可触发运行并读取结果；不反向塑造 Agent 架构。
- G2 可交互前端：保持桌面端选题、触发运行和查看结果的核心路径；不扩展部署、移动端、无障碍或实时通信专项。
- G3 代表性测试案例：runs/ 已留存（Q61 等，含输入输出与验收报告），前端可展示。
- G4 技术报告：PDF ≤20 页骨架（研究问题与方法、架构讲解、真实案例、上下文工程设计）——提交期完稿。
- G5 全量 125 题输出：批量 runner 须支持断点续跑（跳过已完成题）；全量生产跑为提交期动作（时长/费用由用户拍板），MVP 验证抽样 + 续跑能力。

项目交付 = G1 + G2 核心路径可用、G3 已有、G5 续跑能力验证、G4 骨架；演示视频不做。

## F. MVP 边界（less is more）

- 不做：演示视频、SFT 微调、vector DB、多模态数据处理（技术方案文档中论述扩展路径即可）。
- 领域样例：以天文类问题为默认 E2E 用例（呼应发榜单位国家天文台），但 pipeline 领域无关。

## H. 评估体系（书 ch6 为理论底，2026-08-09 定稿；全自动，human over the loop）

四原则：gate 全确定性，judge 只产诊断分不产 gate（M9/M10 退役后评估里已无 judge，本条保留为将来任何 judge 的准入前提）；**rubric 永不进 agent prompt**（防 Goodhart）；指标只从已有工件派生（零新增采集）；每个指标必须能翻盘一个真实决定，否则不设。

| 层 | 指标 | 定义/数据源 | 翻盘什么决定 |
|---|------|------------|-------------|
| Tier0 | 现状保留 | B1–B4 验收器、`review.json`（旧 `verdicts/` 已随 TS 栈退役）；验证命令是 AGENTS.md 验证节那套（`pnpm run ci` + `pnpm run test:e2e`；2026-08-15 前是 Python 与 bun 两套，随 ADR-0004 合一） | 单 run 通过性 |
| Tier1（零 LLM 派生） | M4 交付率 | deliverable runs / 总 runs（runOutcome），带二项标准误 √(p(1-p)/n)；环境性失败单列一档 | 战役节奏 |
| | M5 Pass^2 | 同题按时间序相邻两次 run 均 deliverable 的比例 | 可靠性口径（替代单次快照） |
| | M6 成本会计 | usage.jsonl 聚合：token/题、¥/题、按节点分解 | 重跑预算、模型分档 |
| | M7 返工强度 | review.json 的 `verdict=="revise"` 占已评审 run 的比例 | instructions/节点质量定位 |
| | M8 文献健康 | refs 数、tool-events.jsonl 的检索去重率与新信息率 | 检索策略、学科覆盖预警 |
| Tier2 | ~~M9 质量评分~~ | **2026-08-11 退役**，见下 | —— |
| | ~~M10 judge 校准~~ | **2026-08-11 退役**，见下 | —— |
| Tier3 | M11 配对版本比较 | 同题多版本 McNemar 精确二项：`firstVsLatest`（首末，非受控）+ `memoryArms`（按 `meta.memoryArm` 两臂配对，受控） | 改动是否真的更好 |

- **失败分类口径（跨栈）**〔2026-08-15 收口：TS 侧的 3 桶归属已裁决并落进 `src/eval/metrics.ts`，跨栈映射表见下，原「映射表尚未落定」的欠账标注就此撤销。〕：两个栈的**读数单位不同，引用前先说清读的是哪个 cohort**——Python 期（`runs/` 归档）一个失败 run 落一个 `FailureClass`，**7 类 / 3 桶**；TS 期（SQLite）读两个字段：终态 `runs.status`（`completed` / `review_rejected` / `failed`）与 `failed` 时的 `runs.error_code`（**9 个码**，`src/agent/failures.ts` 的 `FailureCode`）。**M4 的交付 = `completed`**；`review_rejected` 是**质量判定的未交付**，不是 failure code，在 `failureClasses` 里单列一档。3 桶的分法（quality / infrastructure / unclassified）与「`infra_timeout` 可非零」的读法两栈一致。

  **TS 三桶归属**（`src/eval/metrics.ts`，判据是「谁能修」；桶由字面量集合**穷举**，不再用「非环境即质量」的补集推断）：

  | 桶 | 成员 | 判据 |
  |---|---|---|
  | infrastructure（剔出 M4 质量分母） | `infra_error`、`infra_timeout`、`missing_credential`、`provider_error`、`deadline_exceeded` | 环境、供应商、凭据、超时；换个模型把同一题再跑一遍也修不掉，只有改环境才修得掉 |
  | quality（留在质量分母） | `invalid_output`、`verifier_refs`、`context_overflow`、`runtime_error` | 责任在 harness 或模型自己，改我们的代码/提示/输入就能修 |
  | 单列 | `review_rejected`（终态，不是码） | Reviewer 否决且一次修订没救回来。未交付，但**两个分母都照旧算它**——它正是质量判定本身 |
  | unclassified | 没写 `error_code` 的 run，或落不进上面任一集合的码（含 Python 期的分类名） | 存疑不给免票：仍留在质量分母里，且在报告里列出码名 |

  `context_overflow` 属 quality 不属 infrastructure：上下文塞爆是**我们塞多了**，不是 provider 宕机（裁决见 `dsh-borrowings.md`）。`runtime_error` 同理——它是 harness/server 兜底 catch 抛出的自家 bug，不发环境类免票。**一处已知含糊须随数一起报**：`deadline_exceeded` 既可能是 provider 慢，也可能是模型自己磨蹭，同一个码里不可分离，本轮整体按环境类读（`src/executor.ts` 的 abort 分支与 `src/batch/runner.ts` 的批次取消共用它）。另注：`src/agent/failures.ts` 的 `INFRASTRUCTURE_FAILURE_CODES` 只有 `infra_error` / `infra_timeout` 两个码，它是**熔断口径**（协议 `controls.batch_circuit_breakers.outage_classes` 已注册，不因读数需要而改），与这里的读数口径**不是同一个集合**。

  **跨栈映射表**（Python 7 类 ↔ TS 码/终态；Python 侧路径均为已删代码的历史坐标，依据是本条 2026-08-13 版记录的 `_classify` 4 类映射）：

  | Python 7 类 | TS 对应物 | 说明 |
  |---|---|---|
  | `contract_violation` | `invalid_output` | 同义改名：模型输出不满足领域合同（`ContractError` / `ZodError` → `classifyFailure`） |
  | `verifier_refs` | `verifier_refs` | 同名同义：B1–B4 终局引用验收未过，且失败项不只 B2 的 resolve（`src/verify/verifier.ts`） |
  | `infra_error` | `infra_error` | 同名**不同覆盖面**：Python 期它兼作 `_classify` 的兜底，provider 报错、缺凭据都落在里面；TS 把兜底拆成 `provider_error` / `missing_credential` / `runtime_error`，`infra_error` 只剩 arXiv 不可达与批跑异常。**两栈的 infra_error 计数不可相加** |
  | `infra_timeout` | `infra_timeout` | 同名同义：单题挂死被判死、批次继续（`src/batch/runner.ts`），仍属基础设施失败不属模型质量 |
  | `agent_budget_exhausted` | **拆成两个码**：`invalid_output`（SDK `maxTurns` 用尽）+ `deadline_exceeded`（阶段 deadline 用尽） | Python 的一个「预算用尽」在 TS 是两件事，桶归属也随之拆开：前者 quality（模型一直调工具不交答案），后者 infrastructure。Python 期 `agent_budget_exhausted` 整体属 quality，因此**这一类的跨栈计数不可直接比** |
  | `reviewer_no_new_evidence` | **无对应码**；对应物是 `review_rejected` 终态 | 拓扑原因：两角色（Scientist / Reviewer）里「补证没带来新证据」是 Reviewer 对同一个 Scientist 的判定，可以落成失败分类。五角色固定流水线里补证是 researcher → hypothesis-generation → evidence-review 的循环，上界 2 轮，用尽即带现有证据进计划阶段、**不判失败**；质量不够最终由 Reviewer 否决表达 |
  | `revision_no_change` | **无对应码**；对应物是 `review_rejected` 终态 | 同上：修订上界 2 轮，第二次仍被否决（或 Reviewer 认为一次修订救不回来）即落终态，不另立「修订前后无变化」的判定 |

  TS 新增、Python 无对应物的三个码：`context_overflow`（Wave 3 从 `provider_error` 拆出）、`missing_credential`（`src/seams/model.ts` 缺 `QWEN_API_KEY`）、`provider_error`（Python 期并进 `infra_error` 兜底）；`runtime_error` 亦然（Python 期的同类异常同样并进 `infra_error`）。

  Python 期原文留档（`runs/` 归档 cohort 仍按此读）：权威定义是 `backend/app/domain/runs.py` 的 `FailureClass`，**7 类**——`reviewer_no_new_evidence`、`verifier_refs`、`revision_no_change`、`contract_violation`、`agent_budget_exhausted`、`infra_timeout`、`infra_error`；`evaluation.py` 分 3 桶报，quality（前五类）、infrastructure（后两类）、unclassified（终态没写分类的历史 run），`agent_budget_exhausted` 属 quality 不属 infrastructure。7 类产生路径不同：`orchestrator.py` 的 `_classify` 只从异常映射出 4 类（`reviewer_no_new_evidence` / `contract_violation` / `agent_budget_exhausted` / `infra_error`），`verifier_refs` 与 `revision_no_change` 由 Harness 主流程直接判定，`infra_timeout` 由两条超时路径写出（`services/launch.py` 的 `RunLauncher._wait` 与 `app/batch.py` 的 `_run_one`，共用同一个 `launch.RUN_TIMEOUT_SECONDS`）。（2026-08-13 更正：批跑单题超时保护合入之前，这里声明的是「批跑不经过该路径、计数恒为 0」。）
- **终态判定的单一事实源**〔2026-08-15 按 TS 现实改写落点，**判据本身一字未变**：终态必须由结构化事实判定，不得由 markdown 渲染物判定。〕：一个 run 是否交付，读 SQLite 的 `runs.status`——**只有 `completed` 算交付**，`review_rejected` 与 `failed` 都不算（`src/store/schema.ts` 定义状态集，`src/eval/metrics.ts` 的 `deliverable`、`src/campaign/campaign.ts` 的交付判定、`src/batch/runner.ts` 的题级结论同源读它）。引用验收的逐条结论读 `verification.references` 事件（`src/harness.ts` 在写终态**之前**落这条事件，载荷含 `ok` / `failed` / `infra_error`，明细 `checks` 留在库内）：`ok=false` 时终态必为 `failed`，失败码由 `src/verify/verifier.ts` 的 `verificationFailureCode` 在 `verifier_refs` 与 `infra_error` 之间裁决。TS 栈**不写任何 markdown 状态载体**——没有 `verification.json`，也没有 `verification-report.md`，报告里的表格一律是从库里派生的渲染物，不可反向作为判据。〔Python 期落点，对 `runs/` 只读归档仍然适用：读 `verification.json` 的布尔 `ok`（`services/runs.py` 的 `_verified`、`batch.py` 的 `_is_deliverable` 同源）；`verification-report.md` 里那行 `结果: ALL PASS` 是渲染物，只对 2026-08-10 之前那批没写 `verification.json` 的已提交 run 作兜底，两者矛盾时以 JSON 为准。〕理由见 `loop-upgrade.md`：把 markdown 当结构化状态载体是本项目自列的「最贵的错误」，它让报告模板的一次改动就能翻转一个 run 的成败——书 ch6 所说「评分器 bug 把正确答案判为失败」的经典形态。
- **M9/M10 退役裁决（2026-08-11）**：两者随 TypeScript 栈退役，不重建。理由是事实而非偏好——生产者（score/calibration 的写入侧）随栈删除，且仓库里唯一一份校准报告（`runs/20260808-134046/calibration.md`）的变异体检出率为 0/4（逆序 1），即使重建生产者，M9 也一天都没有取得过排序授权。该 run 已随 TS 栈语料一并从 HEAD 删除，这份数字只存于 git 历史（`git show`），任何报告不得再把它当现行证据引用。处置：`evaluation.py` 不再读 `score.json` / `calibration.md`，版本择优链变为 **gate → refs 数 → token 成本 → run id**（全确定性）；报告输出结构里 M9 相关字段直接消失，不留空壳。残留的 `runs/*/score.json` 是无人读取的历史字节，任何报告不得引用其分数。**点名**：HEAD 里仅存的一份是 `runs/20260810-052412/score.json`，其中的 `rubricVersion` / `judgeModel` / 分数字段全部是退役前的历史字节。终态 run 不可变，所以这些字节**保持原样不清理**；但它们是**不可引用的**——没有任何代码读它，没有任何结论建立在它上面，报告、PPT 与技术方案一律不得引用。
- **A1/A2 的自动化覆盖缺口**：见 A 节表下的加粗段。M9/M10 退役后，方案实质性质量不再有自动化覆盖，只有引用真实性（B1–B4）仍被机器逐条核验。这句话是判据的一部分，技术报告要原样引用。
- **同族 judge 诚实条款**（退役后仍为判据）：judge 也是 Qwen（D1 锁死），无法消解自评偏置。这正是 M9 退役而不是降权重建的理由：一个自评的分数，校准不过就没有资格排序，也没有资格进报告的"成绩"栏。
- **自进化闭环**（全自动）：run → 确定性交付 gate → 题页 memory（**只回传事实不回传分数**：胜出假设、被拒原因、检索有效性）→ 重跑消费 → 版本择优纯函数（gate → refs 数 → token 成本 → run id，字典序）。
- **ablation 白捡项**：memory/ 可删除性 = 现成的记忆贡献量化开关（技术报告实验素材，抽样跑）。抽哪 30 题、按什么规则抽、允许下什么结论，由**开跑前**落盘的预注册协议 `experiment-protocol.json` 定死；该协议声明本轮是 bounded comparison，只报方向、cell 计数与效应量，不做显著性主张。
- 不做清单（防巨无霸，理由存 backlog）：Elo、用户模拟、人工反馈环（赛题"或"字裁决）、仿真环境、统一 trace、参数化防泄漏。

## 终审流程

维护者逐项核对 A–E：机器可验项跑脚本，A1/A2 这类无自动化覆盖的实质性判据亲自读产物终审。任何一项不过 → 定位责任层 → 打回对应实现 → 重跑。全过后才允许宣布 MVP 达成。
