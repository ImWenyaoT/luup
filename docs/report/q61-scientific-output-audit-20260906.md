# Q61 科学正文实跑与独立复核

这是开发诊断记录，供评估报告质量使用；不属于科学报告正文，也不属于正式 Phase A/B。旧数据库、模型上报和失败结果全部保留。题目为 Science-125 Q61：How are pulsars formed?，所有本系列试跑均使用 `qwen3.8-flash`。

## v9：真实研究计划已生成，但不能直接采用

- 数据库：`outputs/runtime/flash-q61-20260906-v9.db`；run `7cc7ab6487444f2abe5e566c15b6f4cc`。
- 代码身份：`9f3b892`，运行启动时记录在数据库。
- ResearchPlan Artifact：`d72328bc21574e6da60c0ec5c42fd887`；Reviewer Artifact：`ee76a207709d4d869603019d877b7048`。
- 结果：完整研究计划已发布，Reviewer accepted；终局 `failed / verifier_refs`。11 条参考文献中有 1 条未过 B4：DOI `10.1017/9781108861656.009` 的冻结卡片没有作者；公开 Crossref 精确反查也未登记作者。
- 正文：`outputs/submission/q61-scientific-report-v9/` 内保存原始 JSON、科学排版 Markdown 与 9 页 PDF。正文为毫秒脉冲星 + CO 白矮星的形成通道比较方案，实验尚未执行；排版未替模型修正科学主张。

独立复核在自动 Reviewer 接受后仍发现三个问题：

1. **观测终态与演化初值混淆。** 原稿将 J1614−2230 校准目标写成轨道周期约 2.18 天、质量约 1.95 或 1.7±0.15 太阳质量。其引用论文 Table 1 的观测周期为 8.6866194196 天、观测质量为 1.97±0.04 太阳质量；约 1.7 太阳质量是依赖形成通道的出生质量推断，约 2 天对应演化初始轨道。依原稿校准会使用错误目标。[Tauris et al. 原论文及表 1](https://arxiv.org/html/1103.4996v2)
2. **模拟成功率不能直接代表群体贡献。** 没有固定两个形成通道的初始抽样先验和形成率归一化，`Σw_CaseA / Σw_CE` 的人口统计解释尚未建立；选择函数、十万次模拟的有效事件数和预期区间均需要独立推导与实际检验。
3. **支持与证伪规则冲突。** 预测要求整个参数区间 R>1，而分析规则允许八成参数域 R>1 即支持；同一结果可能同时满足支持和推翻条件。校准要求也存在“两通道”与“至少一条”的差异。

因此，引用真实性验收和 Reviewer 接受均不能充当科学正确性证明。本稿可用于观察真实生成质量，不能作为已验证科学结论或直接执行的实验协议。

## v10：引用选择提示修订后重新运行

修订提交 `402e60d` 只在 ResearchPlanner 提示中前置既有 B4 非空作者要求，不改变验收器、不替模型补作者、不覆盖旧 Artifact。协议追加开发修订说明。新库 `outputs/runtime/flash-q61-20260906-v10.db`，run `0228174fcc4945aca14db6b4c4ed0a4d`。

实际终态为 `completed`，最终 Artifact `bf4c5ea75bf542dc83a1c3358dba1ab6`。北京时间 19:34:25 至 19:45:05，约 10 分 39 秒；启动源码干净。12 条引用全部通过 B1–B4（arXiv 3、DOI 9、仅成员性 0、失败 0、基础设施错误 false）。Reviewer accepted，三个评分分别为 4/4/3。

落库用量输入 317,043、输出 69,723 tokens，按输入 1 元/M、输出 3 元/M 的既有保守口径估算 0.526212 元；这是本轮估算，不是实际扣款。正式 125 题未启动。

实际科学正文：`outputs/submission/q61-scientific-report/`，含 10 页 PDF、Markdown、未经科学改写的 `research-plan-original.json`、经现有公共投影函数生成的 `official-export.md` 与独立的 `run-provenance.json`。PDF 全页已渲染检查，无裁切和文字重叠；运行溯源字段另存于原始 JSON 和导出文件，不作为科学正文的单独章节。

**独立科学复核结论：流程完成，方案仍未达到直接执行或提交的质量。**

1. **物理量和个案依据混用。** 抛射物净动量除以中子星质量对应流体动力学踢速度；计划直接对照总观测速度，尚未处理非流体加速、前身系统运动等映射。其引用的 Gessner & Janka 2018 明确讨论 ECSN 流体踢速度远低于蟹状脉冲星约 160 km/s，却仍预期该个案落入 ECSN 低速区。这不是实验结果未知，而是遗漏已知来源限制。[主要原论文](https://arxiv.org/abs/1802.05274)
2. **混合模型判定无有效检出标准。** 两分量模型嵌套单分量，在同样数据上最大似然的改善本来就非负，`Δln L/N > 0` 加参数同号不能单独检出新成分；混合份额本身约束为非负。零假设检验未固定判定阈值，选择函数未定义，`n≫k` 不保证成分可识别。
3. **支持与证伪条件不一致。** 预测以“任一允许 CCSN 参数能复制分布”为证伪条件，分析和解释却可能仅据“固定相同不对称度时两通道分离”宣布支持。固定同一参数下分离和换一个参数后重合可以同时成立，须检查整个竞争参数域才足以排除竞争解释。

自动 Reviewer 实际也指出机制前提、竞争模型、数据与算力量化缺口，以及似然判据问题，但仍 accepted；其反馈还把蟹状脉冲星速度写成约 400 km/s，因此评审意见本身同样需要溯源，不能无条件采信。现有门能核验引用的存在和元数据，不能证明引用支持了正文里的每条科学主张。当前结果不支持直接扩跑 125 题或宣称科学质量验收通过。

上游 Research 的额外复核：六代码球对称超新星比较被概括成中微子加热已驱动爆炸，但原论文 §4 说明激波停滞并退缩，该前身星的球对称模拟不预期激波复活。[O’Connor et al. §4](https://arxiv.org/html/1806.04175v1)

ECSN 低踢速度的主要依据应限定为特定 O–Ne–Mg 前身和爆炸能量范围下的流体动力学模拟；不能直接推广为所有 ECSN 总速度的上限，也不能把蟹状脉冲星确认为 ECSN 产物。原论文将蟹状脉冲星约 160 km/s 的速度解释为低质量铁核前身或额外非流体机制两种可能。[Gessner & Janka 摘要](https://arxiv.org/abs/1802.05274)

## 验证和费用口径

- 完整 `pnpm run ci` 通过（599 测试；server 448，web 151），覆盖率门通过。日志：`/private/tmp/luup-q61-author-selection-ci.log`。
- 前一轮相同运行时代码的 Playwright E2E 12/12 通过，本次仅更新角色提示和协议说明。日志：`/private/tmp/luup-q61-whole-feedback-e2e.log`。
- 试跑费用按实际落库 token 估算；部分早期失败记录用量不完整，因此不能把已记录 token 的合计当成完整账单。逐库明细为 `outputs/diagnostics/q61-development-runs.json`。用户授权总上限 50 元，未自动切换 Max，也未启动正式 125 题。

## review-v2：五项基础审查与旧方案真实重评

修复提交 `aa95b1b` 给当前 Review 加入五项必填判定：前提、可证伪性、证据支撑、可执行性、引用相关性。每项必须有理由及实际计划 JSON 路径；任一 fail 拦截接受。模型若上报 `accepted:true` 同时存在 fail，代码直接规范为 false 并记录覆盖事件，不触发一轮让模型改口的纠错。Reviewer 增加读取原始 Research Artifact；提示词和 Planner 同步区分结构恒真条件与有效检测、条件比较与全参数范围可识别性。旧库保持可读、旧运行不改写，协议仅追加 amendment。

Git ignore 同时收窄：环境示例模板可跟踪，实际 `.env*` 仍忽略；移除全局 `*.tmp`，只屏蔽 campaign 原子写临时页。`memory/`、冻结题集和 `runs-ts/` 证据仍可跟踪。12 项路径边界检查通过，无已跟踪文件被 ignore 隐藏。

验证：先用旧代码复现「无基础审查仍可接受」红测，再完成修复。全量 CI 607 项通过（server 456、web 151）；server functions 93.17% / lines 87.82%，web 92.67% / 96.54%；Playwright 12/12 通过。另有独立代码复核确认：既有协议内容逐字段未变、历史投影兼容、拒收不会重新规划。

随后使用相同 Flash 对冻结 v10 Plan 执行一次**真实 Reviewer 重评**，没有把人工审计意见作为任务输入。结果保存在 `outputs/diagnostics/q61-v10-foundations-review/`：

- `accepted:false`，`executability:fail`，其余四项 pass；0 次纠错，2 次独立检索。
- 命中嵌套最大似然增益、正参数符号判据缺乏区分力，以及容差带缺少构造程序；因此旧稿被新门拒收。
- 仍漏判部分物理前提和全参数范围矛盾；它把部分可识别性问题列为非阻塞弱点。因此只证明该旧稿被拦截，**不证明 Reviewer 全面或可靠地判定科学正确性**。此次已见样例重评不是盲测。
- 用量输入 47,224、输出 3,641 tokens；按本系列既有口径约 0.058147 元，仅为估算。本诊断不写入原运行成功状态或 campaign 成功记忆。

## 来源摘要丢失修复

v11 首轮 Research 把同一 Crossref 检索组中的 AGB 中子俘获标题与电子俘获形成通道拼接成机制断言。检查确认：既有 Crossref 请求 `select` 不含 `abstract`，arXiv 工具虽向当轮模型返回摘要，却未将其写入 EvidenceLedger。不能据旧台账没有摘要就断言供应商不提供摘要。

修复在既有 Crossref 请求增加可选摘要，清理 JATS 标记；arXiv/Crossref 都把实际摘要冻结进 EvidenceCitation，再通过 canonical Research 传给下游。摘要由台账拥有，模型自填不能覆盖；缺失保持缺省，公开投影字段不扩大。没有增加检索次数、工具或依赖。

真实 Crossref 查询 `Hydrodynamical Neutron-star Kicks in Electron-capture Supernovae` 返回 HTTP 200，首条 DOI `10.3847/1538-4357/aadbae` 实际提供 1,725 字符摘要，其中明确给出 ECSN 流体踢速度最多几 km/s、远低于蟹状脉冲星约 160 km/s，并提出低质量铁核或非流体机制解释。五条检索结果中两条有摘要、三条缺失；未补写缺失内容。原始探针保存在 `/private/tmp/luup-live-abstract-probe.log`。

最终验证：609 项测试通过（server 458、web 151），server functions 93.38% / lines 87.87%，web 92.67% / 96.54%；Playwright 12/12。集成回归先复现摘要被 canonical schema 丢弃，再确认检索台账→Research→Reviewer 保留原文，并确认公共投影不输出该内部字段。独立代码核查未发现阻塞问题。

v11 与上述改动在同一开发工作树并行：角色提示词在每次执行时读取，启动的 commit 身份不足以保证全程使用同一提示词。因此 v11 仅作开发诊断，不作为摘要修复的固定版本验收；后续完整重跑须保持运行期间源码不变，并保存每次角色调用的实际提示词。

## v11 / v12 结果与章节定位修复

- v11：run `1dad9cb354ee462ba57a35e458c7c979`，20:15:59–20:29:19，`failed / invalid_output`。Reviewer 两稿均拒收，但纠错后仍使用缺少 `execution_plan.` 前缀的路径，未发布有效 Review。输入 445,879、输出 68,994 tokens，估算 0.652861 元。此轮提示词存在开发期变化，只作诊断。
- v12：固定提交 `a2bfd82`，run `4965026341b540649b28dab61ba81093`，20:26:43–20:38:41，`failed / invalid_output`。启动源码干净，逐角色实际提示词和源码身份保存在 `outputs/diagnostics/q61-observed-v12/`；运行期未改源码，期间的工作树变化只有 v11 自动追加的 campaign 失败日志。首轮 8 条所选引用均有实际摘要，补证后计划明确区分“爆炸性质已报告”与“kick 尚待复算”。输入 511,925、输出 62,368 tokens，估算 0.699029 元。
- v12 ResearchPlan `fe72030028934d8fbc778eaf609212c2` 已冻结发布；Reviewer 首稿 `accepted:false / executability:fail`，但两稿仍写了错误字段层级，原 run 保留失败。没有最终引用验收，也没有成功晋升。科学正文已忠实导出到 `outputs/submission/q61-scientific-report-v12/`，11 页 PDF 全页渲染检查无裁切或重叠；原始 JSON 未改科学内容，不能作为合格提交稿。

v12 独立科学复核还发现：

1. `technical_details` 的流体 kick 积分保留 `G M_NS`，对抛射物密度积分得到力，再对时间积分得到动量，不是速度；缺少质量归一化。
2. 归给 Janka 的 `120 km/s × E_50 M_5/(1+M_5/4)` 及由此得到的 0.4–0.6 km/s 数值没有对应原文公式。原文式 6/7 的速度保留不对称度、动能份额等项，式 11 同样不是稿件的函数，因此相关比较门不能据此成立。[Janka 原文](https://arxiv.org/pdf/1611.07562)
3. 球对称 20 M☉ 代码比较基准改为轴对称，不保证产生指定的数百 km/s kick；把不达该值当作后处理错误会混淆真实物理结果与实现缺陷。

这些是实际设计错误，不是因为实验尚未执行而拒绝。Reviewer 的拒收方向合理，但其前提项 pass 仍漏检了硬错误。

为修复新增路径合同的脆弱性，当前模型输出改为从 `researchPlanSchema.keyof()` 产生的顶层章节枚举选择 `plan_paths`；具体步骤与问题写入 reason。历史 canonical Review 仍可读取有效深层路径。五项必填、fail-closed 和实际存在校验保持不变。Reviewer 补充公式量纲、原文公式归属和正对照有效性的审查要求；不修改被冻结的 v12 方案。随后重评只用于验证章节定位和拒收，不算新计划成功。

### 固定章节枚举版本的真实重评结果

提交 `ef4f79e` 启动时源码干净。使用原 v12 Research、ResearchPlan 与 EvidenceReview 冻结输入（未注入上述人工审计意见）完成真实 Flash 重评，结果保存在 `outputs/diagnostics/q61-v12-sections-review/`。

结果为有效 Review：`accepted:false`，premise / evidence_support / executability / citation_relevance 均 fail，falsifiability 为 pass。全部定位字段通过当前顶层枚举和实际存在校验，runTask 层 Artifact 纠错为 0；总计 5 次模型请求、6 次工具调用、2 条独立检索记录，不能称作一次模型调用即成功。此次抓住了缺乏可读来源的 Janka 函数基线，并指出非流体贡献与数据映射的执行缺口。仍不把评审全部意见当作科学真理：例如文献转述测量值并不自动使该测量无效，且独立人工复核的量纲错误仍应保留。

重评输入 189,471、输出 9,815 tokens，估算 0.218916 元。此次修改以来的两次全流程诊断和两次独立重评合计已记录估算 1.628953 元；不是供应商扣款账单。原 v12 `failed` 终态、未通过的原稿和 campaign 日志均未改写，重评不计入正式批、不生成虚假的成功记录。

最终代码检查为 610 项测试（server 459、web 151），server functions 93.38% / lines 87.87%，web 92.67% / 96.54%；Playwright 12/12。另确认 v12 全部 9 次实际角色提示词与 `a2bfd82` 一致、科学报告原始 JSON 与冻结 Artifact 完全相等、旧 v10 科学报告仍能经当前公开投影导出。当前结果支持“已修复可复现的数据与门禁缺陷，并能完整拒收这份已知坏稿”，不支持“科学方案可靠”或“125 题正式批可启动”。
