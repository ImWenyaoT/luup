# Q61 科学内容单题试跑（2026-09-06）

题目：How are pulsars formed? 本次为隔离诊断运行，不是正式 125 题批次。

最新运行使用 qwen3.8-flash，代码提交 b18fcaa。数据库 `outputs/runtime/flash-q61-20260906-v6.db`；run `8149b101b84f4a498480a08d4f159b17`；manifest `2a8109800c324206b6414d85d65f1911`。开始于 2026-09-06 16:23:41，北京时间，耗时 390.3 秒。最终 failed/invalid_output；补充 researcher 的一次纠正后仍为 ContractError。

真实产物为首轮 Research、Hypothesis、EvidenceReview 各一份。四个候选中，证据审查判定三个 uncertain、一个 contradicts。没有 ResearchPlan，没有最终科学报告，也没有通过完整验收。本次全部已记录用量：输入 164252 tokens、输出 38408 tokens；按保守输入 1 元/百万、输出 3 元/百万估算约 0.2795 元，非账单金额。此前若干试跑存在未完整返回用量，不能据此声称全部试跑累计费用精确已知。

## 可直接阅读的真实科学内容

`outputs/diagnostics/q61-scientific-stage-v6/Q61-脉冲星形成-候选研究阶段稿.pdf`（7 页，289578 字节）及同名 Markdown，保留了实际候选假设、预测、替代解释、边界、验证条件及证据审查原文。`original-artifacts.json` 保存三份原始产物。PDF 逐页检查通过排版可读性；这不表示科学验收通过。

## 独立科学内容检查

1. 原文将单一理论模型的强磁场、毫秒初始周期等条件推广为一般出生性质，支持不足。Heras 的摘要明确采用假设性推导，见 <https://arxiv.org/abs/1302.1275>。
2. 候选及审查对 AIC 的存在性、必要性与定量份额表述过强。Freire & Tauris 提出的是旋转延迟 AIC 假设；Chen 等讨论常规 AIC 人口合成约束，两者前提不同，不能仅凭后者直接否定前者。见 <https://arxiv.org/abs/1311.3478>、<https://arxiv.org/abs/1008.2130>。
3. 原文未完整交代束流几何与观测选择；以出生质量和 kick 为主要可见性控制变量的概括没有足够实证支持。此外存在“一个新生儿”等不适当天文译词。
4. 原稿把多条 arXiv 记录视作缺少同行评审保障，但部分记录明确列出期刊发表信息。文献载体与发表状态需分别核对。

这些检查未改写冻结产物，也未注入本次运行证据。报告仍缺少完整可执行研究计划、最终写作和验收。继续扩大到 125 题无法解决已暴露的输出稳定性及科学质量问题。

## 已完成的局部修复与验证

为研究者预留综合输出回合，并在检索预算用尽后强制 structured_output；保留历史工具定义，执行入口仍拒绝超额检索。原生 SDK 回归覆盖串行及并行工具调用、预算持久性和旧工具调用；完整 `pnpm run ci` 通过，日志 `/private/tmp/luup-named-synthesis-ci.log`。此次 live 已越过上一轮的 Tool not found 故障，但未消除补充研究的 ContractError。
