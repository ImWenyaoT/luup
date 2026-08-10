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

## [2026-08-08] run | q61 | ALL PASS
- /home/ail510/tian_wenyao/projects/luup/runs/20260808-062829 回填自历史 run（rebuild-memory.ts）；工件与 verdicts 见 run 目录。

## [2026-08-08] run | q54 | ALL PASS
- /home/ail510/tian_wenyao/projects/luup/runs/20260808-065103 回填自历史 run（rebuild-memory.ts）；工件与 verdicts 见 run 目录。

## [2026-08-08] run | q125 | ALL PASS
- /home/ail510/tian_wenyao/projects/luup/runs/20260808-071315 回填自历史 run（rebuild-memory.ts）；工件与 verdicts 见 run 目录。

## [2026-08-08] run | q61 | SUCCESS
- /home/ail510/tian_wenyao/projects/luup/runs/20260808-134046 胜出方案：Constraining Pulsar Formation Channels: A Two-Tier Framework Integrating Core-Collapse Supernova Rates with Binary Recycling Pathways 引用 7 篇：astro-ph/9911519, 2207.06311, 1003.3833, 1101.1742, 2506.11676, 1302.1275, 1802.02577 问题：来源：《…

## [2026-08-09] note | q61 | -
- - 胜出方案：Constraining Pulsar Formation Channels: A Two-Tier Framework Integrating Core-Collapse Supernova Rates with Binary Recycling Pathways - 评估对象 run：20260808-134046 关键断言（原文摘录，只记事实）： - 「脉冲星诞生率基准采用VFK估计值~1/30 yr⁻¹，判定阈值为因子2——若预测核心坍缩率低于独立估计值的1/2或高于2倍则拒绝H1主导假设」— 有出处 - 「要求比值在0.5-2.0范围内」— 有出处 - 「预期结果表明…

## [2026-08-09] note | q61 | -
- - 胜出方案：Eccentricity Distribution of Double Neutron Stars as a Statistical Probe of Common-Envelope versus Consecutive Supernova Formation Channels - 评估对象 run：20260808-062829 关键断言（原文摘录，只记事实）： - 「CE-dominated populations to exhibit tighter eccentricity distributions centered at lower values due to ci…

## [2026-08-10] note | q- | -
- ## Run 20260810-032527 — Q61: How are pulsars formed? **Verdict**: PASS (verify_references ok:true) **Run directory**: /home/ail510/tian_wenyao/projects/luup/runs/20260810-032527 **胜出假设**: H3 (修订版) — 电子俘获超新星（EC-SN）产生的中子星 natal kick 幅度系统性低于铁核坍缩超新星；通过银河轨道积分反推宽距双脉冲星诞生速度，其 kick 分布峰值和色散应显著低于孤立年轻脉冲星群体。 *…

## [2026-08-10] run | q61 | SUCCESS
- /home/ail510/tian_wenyao/projects/luup/runs/20260810-032527 胜出方案：Quantifying the Origins of Neutron Star Natal Kicks: Asymmetric Ejection versus Neutrino Radiation 引用 5 篇：astro-ph/0103015, astro-ph/0402200, 2305.08920, 2205.03989, 2001.09829 问题：来源：《Science》125 前沿科学问题（Science-125 题库）第 61 题，Astronomy…

## [2026-08-10] note | q61 | -
- - 胜出方案：Quantifying the Origins of Neutron Star Natal Kicks: Asymmetric Ejection versus Neutrino Radiation - 评估对象 run：20260810-032527 关键断言（原文摘录，只记事实）： - 「预期结果显示，对于典型大质量恒星，物质抛射不对称性贡献约 60-80% 的 kick 速度，中微子辐射贡献剩余部分」— 标注为待验证 - 「综合两者，预期 kick 速度分布峰值在 200-300 km/s，与观测到的年轻脉冲星速度分布（平均约 300 km/s）量级一致」— 标注为待验证 …
