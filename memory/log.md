<!--
时序日志（append-only）。每条记录的首行格式固定：

    ## [YYYY-MM-DD] <action> | q<id> | <verdict>

    action  = run（历史条目另有 note / library-sync，来自已删除的 TS 栈）
    q<id>   Science-125 题号；无题号写 q-
    verdict ∈ {SUCCESS, FAILED}（历史条目另有 ALL PASS / PAUSED）

首行之下是可选的 `- ` 明细行。前缀固定 ⇒ `grep "^## \[" memory/log.md | tail -20`
就是确定性检索，零解析成本。本文件由 `src/campaign/campaign.ts` 在 run 收尾时追加，
模型没有写它的通路；请勿手改、勿重排、勿删除历史条目。
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

## [2026-08-10] run | q61 | FAILED
- /Users/edward/Documents/luup/runs/20260810-013424 未产出 proposal.json，也没有 FAILED.md（流水线中途死亡）。 问题：来源：《Science》125 前沿科学问题（Science-125 题库）第 61 题，Astronomy。 问题：How are pulsars formed? 任务：围绕该问题识别当前研究的具体知识缺口，生成可验证的科学假设，并给出完整研究计划（10 标准字段）。

## [2026-08-10] note | q- | -
- ## Run 20260810-032527 — Q61: How are pulsars formed? **Verdict**: PASS (verify_references ok:true) **Run directory**: /home/ail510/tian_wenyao/projects/luup/runs/20260810-032527 **胜出假设**: H3 (修订版) — 电子俘获超新星（EC-SN）产生的中子星 natal kick 幅度系统性低于铁核坍缩超新星；通过银河轨道积分反推宽距双脉冲星诞生速度，其 kick 分布峰值和色散应显著低于孤立年轻脉冲星群体。 *…

## [2026-08-10] run | q61 | SUCCESS
- /home/ail510/tian_wenyao/projects/luup/runs/20260810-032527 胜出方案：Quantifying the Origins of Neutron Star Natal Kicks: Asymmetric Ejection versus Neutrino Radiation 引用 5 篇：astro-ph/0103015, astro-ph/0402200, 2305.08920, 2205.03989, 2001.09829 问题：来源：《Science》125 前沿科学问题（Science-125 题库）第 61 题，Astronomy…

## [2026-08-10] note | q61 | -
- - 胜出方案：Quantifying the Origins of Neutron Star Natal Kicks: Asymmetric Ejection versus Neutrino Radiation - 评估对象 run：20260810-032527 关键断言（原文摘录，只记事实）： - 「预期结果显示，对于典型大质量恒星，物质抛射不对称性贡献约 60-80% 的 kick 速度，中微子辐射贡献剩余部分」— 标注为待验证 - 「综合两者，预期 kick 速度分布峰值在 200-300 km/s，与观测到的年轻脉冲星速度分布（平均约 300 km/s）量级一致」— 标注为待验证 …

## [2026-08-10] run | q61 | FAILED
- /home/ail510/tian_wenyao/projects/luup/runs/20260810-042825 胜出方案：Disentangling Pulsar Formation Channels: A Three-Channel Hierarchical Mixture Model for Core-Collapse, Electron-Capture, and Accretion-Induced Collapse Origins 引用 11 篇：2205.03989, 1703.06895, 1805.07974, 2402.04658, 2306.07099, 2606.1…

## [2026-08-10] run | q61 | FAILED
- /home/ail510/tian_wenyao/projects/luup/runs/20260810-045543 胜出方案：Disentangling Pulsar Formation Channels: A Four-Channel Hierarchical Bayesian Mixture Model for Core-Collapse, Electron-Capture, Accretion-Induced Collapse, and Thermonuclear-ECSN Origins of Galactic Neutron Stars 引用 12 篇：2406.11428, …

## [2026-08-10] run | q61 | SUCCESS
- /home/ail510/tian_wenyao/projects/luup/runs/20260810-052412 胜出方案：Disentangling Pulsar Formation Channels: A Four-Channel Hierarchical Bayesian Mixture Model for Core-Collapse, Electron-Capture, Accretion-Induced Collapse, and Globular-Cluster Dynamical Origins of Galactic Neutron Stars 引用 10 篇：1806…

## [2026-08-10] note | q61 | -
- - 胜出方案：Disentangling Pulsar Formation Channels: A Four-Channel Hierarchical Bayesian Mixture Model for Core-Collapse, Electron-Capture, Accretion-Induced Collapse, and Globular-Cluster Dynamical Origins of Galactic Neutron Stars - 评估对象 run：20260810-052412 关键断言（原文摘录，只记事实）： - 「Explicit falsification …

## [2026-08-10] run | q- | FAILED
- runs/20260810-163739｜Effective Renormalization-Group Description of SGD Implicit Bias in Overparameterized Networks｜引用 2604.03068, 2112.11027, 2410.00396, 2006.06098, 2504.12700, 2507.05164

## [2026-08-10] run | q- | FAILED
- runs/20260810-163941｜分类：contract_violation

## [2026-08-10] run | q- | FAILED
- runs/20260810-164417｜分类：infra_error

## [2026-08-10] run | q- | FAILED
- runs/20260810-165146｜Disentangling the Causal Pathway: Arctic Amplification, Stratospheric Vortex Disruption, and Mid-Latitude Cold Extremes｜引用 2009.13568, 2104.08732, 2201.09876, 2305.14201, 2111.05432

## [2026-08-10] run | q- | SUCCESS
- runs/20260810-165229｜Disentangling Geometric and Social Drivers of Urban Superlinear Scaling: Does Transport Network Fractal Dimension Determine the Scaling Exponent?｜引用 1210.5215, 2011.06287, 1503.04795, 2603.30021, 2001.00311, 2503.00550, 1211.5124

## [2026-08-13] run | q1 | FAILED
- runs/20260813-062746｜Spectral Symmetry and the Quantum Nature of Prime Distribution: A Computational Investigation into the Riemann Zeta Function's Hidden Operator｜引用 2305.18794, 2109.09366, 2204.05689, 2001.08890, 2308.01234

## [2026-08-15] run | q1 | FAILED
- runs-ts/phase-a-pilot.db#abc2d63a547c4fdcab008c3b61f72551｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q2 | FAILED
- runs-ts/phase-a-pilot.db#db194c7ec0e5460087a2adc64311f5a6｜黎曼猜想证明现状的系统性审查：基于2000-2026年预印本与同行评议文献的证据分析｜引用 1910.02954v7, 9679.10003, https://doi.org/10.1063/1.1784280, 2008.07206v2, 2016.61206｜cls=review_rejected

## [2026-08-15] run | q3 | FAILED
- runs-ts/phase-a-pilot.db#f83052a8db2e40a8b2b746334c13d0d9｜基于形式化验证与数值反例搜索的Navier-Stokes方程声称解法严谨性评估｜引用 2505.13816v3, 1806.10081v10, 1310.8031v2, https://doi.org/10.2139/ssrn.5295955, 2025.10130｜cls=review_rejected

## [2026-08-15] run | q4 | SUCCESS
- runs-ts/phase-a-pilot.db#dcb7e31d575245c5ba53615d90b3c56f｜人工智能驱动的新型非虹彩颜料发现：结合符号学习与结构色工程｜引用 2312.11487v1, 2307.12346v1, 2025.11413, https://doi.org/10.1016/j.fopow.2017.10.028, 2508.03278v1

## [2026-08-15] run | q5 | FAILED
- runs-ts/phase-a-pilot.db#c0d681dc00d74ba3b9a327aee3e5f355｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q6 | FAILED
- runs-ts/phase-a-pilot.db#ecf9d8e1e93a45e3b57d76d2ed59e55c｜原子尺度视角下复杂氧化物界面量子现象的多模态表征对比研究｜引用 2104.13587v1, cond-mat/0209599v1, cond-mat/0410006v1, https://doi.org/10.1017/s1431927617000368, https://doi.org/10.1142/9789811262289_0002｜cls=review_rejected

## [2026-08-15] run | q7 | FAILED
- runs-ts/phase-a-pilot.db#b48278342abd4a5e9491cd37223e7c38｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q8 | FAILED
- runs-ts/phase-a-pilot.db#d66fcb8f823d4dd8bd3d96a3389f1c25｜同手性的功能必要性：量化外消旋混合物对生物大分子结构稳定性与分子识别特异性的影响｜引用 2012.12850v1, physics/0209069v2, astro-ph/9911174v1, 1007.4527v1, https://doi.org/10.1002/(sici)1097-0134(199608)25:4<438::aid-prot4>3.0.co;2-9, https://doi.org/10.1007/978-3-0348-8837-0_10｜cls=review_rejected

## [2026-08-15] run | q9 | FAILED
- runs-ts/phase-a-pilot.db#68862cc9859542e0bbda071ffc777d75｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q10 | FAILED
- runs-ts/phase-a-pilot.db#f4505e336b4c459d8c277e3e872222a9｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q11 | FAILED
- runs-ts/phase-a-pilot.db#2e590ada0c48463c9fd7da4c9ec8320b｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q12 | FAILED
- runs-ts/phase-a-pilot.db#1ca5db39e4ba4aadb745ee14dd52e473｜能量流驱动下生命系统自我复制的自发涌现与热力学机制研究｜引用 1801.05872v2, 1512.04478v2, 1705.09868v1, nlin/0603026v3, https://doi.org/10.1017/cbo9781316135990.011｜cls=review_rejected

## [2026-08-15] run | q13 | FAILED
- runs-ts/phase-a-pilot.db#2fcb28f801204ce3b1fe3d545abe8258｜基于多维数据融合与机器学习的全球大流行病早期预警系统构建与验证｜引用 2302.00863v1, 2507.12966v2, 1801.07807v1, 2601.13349v2, 2026.20342｜cls=review_rejected

## [2026-08-15] run | q14 | FAILED
- runs-ts/phase-a-pilot.db#9c6d4442bc544002b4a91c3ac5daf8a2｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q15 | SUCCESS
- runs-ts/phase-a-pilot.db#8a4b6c679b2744bcbe4295565d1ca200｜基于力控增材制造与逆设计框架的个性化药物定制化生产验证研究｜引用 2512.09154v2, https://doi.org/10.1016/b978-0-443-44430-2.00018-9, 2409.11712v1, 2403.16042v1, 8993.2021

## [2026-08-15] run | q16 | FAILED
- runs-ts/phase-a-pilot.db#cc3d19507b014b2ab59a1a0e75f85e65｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q17 | FAILED
- runs-ts/phase-a-pilot.db#224d07719e194a03bec2da52b80a55d5｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q18 | SUCCESS
- runs-ts/phase-a-pilot.db#b61b5c5b8da943fdb640564ff069c086｜传统中医经络系统的科学基础：基于 Primo 血管系统与神经生理机制的多模态验证研究｜引用 https://doi.org/10.1016/j.dcmed.2020.09.001, https://doi.org/10.1097/hm9.0000000000000128, https://doi.org/10.1016/s2005-2901(10)60014-3, https://doi.org/10.1016/j.jams.2012.07.017, https://doi.org/10.1016/j.jams.2013.10.001, https://doi.org/10.1016/j.jams.2015.04.004

## [2026-08-15] run | q19 | SUCCESS
- runs-ts/phase-a-pilot.db#6460c15bcf1441e7afb881ef4b7e5b61｜基于机器学习与机理建模的下一代mRNA/saRNA疫苗LNP制造平台优化研究｜引用 2308.01402v2, 2508.01843v1, 2408.08577v2, https://doi.org/10.7774/cevr.2025.14.e40, https://doi.org/10.3390/v17040566

## [2026-08-15] run | q20 | FAILED
- runs-ts/phase-a-pilot.db#ed05f9a4684045d39e719d1e1263914f｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q21 | SUCCESS
- runs-ts/phase-a-pilot.db#fab53c4a8301439a9055bbf6a4abc537｜从消除到管理：评估噬菌体-CRISPR联合疗法及优化给药策略对控制抗生素耐药性进化的有效性｜引用 2511.03677v1, 2007.01245v1, https://doi.org/10.2174/0115665232417037250916112841, 2024.10708, https://doi.org/10.21275/sr22805092411

## [2026-08-15] run | q22 | SUCCESS
- runs-ts/phase-a-pilot.db#f6e274481e3c40eb943d9cee50f190f6｜整合多视图组学数据解析肠道微生物组在炎症性肠病中的因果致病机制｜引用 2402.08222v2, 2303.16722v1, 2024.00001, https://doi.org/10.1201/9781003037521-9, https://doi.org/10.1007/978-981-16-3156-6_5, https://doi.org/10.47278/book.tl/2026.387, 2025.10000, https://doi.org/10.31274/cc-20240624-1443

## [2026-08-15] run | q23 | FAILED
- runs-ts/phase-a-pilot.db#2bb2f05c5f51447ab617951bf8a35f1b｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q24 | SUCCESS
- runs-ts/phase-a-pilot.db#9f0b29aea1db44e48ff879485e2b463f｜协同保护：评估禁捕区政策与优化声学监测在海洋生物多样性保护中的联合效应｜引用 2210.03890v1, 2204.04155v1, 0807.4040v2, 2607.21690v1, https://doi.org/10.1016/b978-012044455-7/50007-0

## [2026-08-15] run | q25 | FAILED
- runs-ts/phase-a-pilot.db#29417631b7944c899cdc14d246292732｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q26 | SUCCESS
- runs-ts/phase-a-pilot.db#2b7212b6949647e5958f0bfa972d8403｜基因调控网络吸引子与表观遗传锁定对细胞命运可塑性的限制机制及单细胞熵变研究｜引用 1405.1206v3, 2204.09004v2, https://doi.org/10.5772/53650, https://doi.org/10.4161/cc.26876, 2004.07985v1, 1612.08064v2, 1210.5779v2

## [2026-08-15] run | q27 | SUCCESS
- runs-ts/phase-a-pilot.db#dcc36ea4ac0949afb4f78701ccb7792e｜突变-选择-漂变平衡视角下的基因组大小演化机制研究｜引用 1511.05548v1, 1109.2214v2, https://doi.org/10.1554/0014-3820(2001)055[0001:ptepda]2.0.co;2, https://doi.org/10.3390/genes10030228, https://doi.org/10.1101/2024.03.14.584996

## [2026-08-15] run | q28 | SUCCESS
- runs-ts/phase-a-pilot.db#d46b8257b8c84fd797c5340c94c171d2｜癌症治愈的异质性边界：基于多组学与治愈模型的精准医学局限性分析｜引用 2605.04999v2, 1306.2584v2, 1705.05025v1, 2402.09476v1, 2101.11935v1

## [2026-08-15] run | q29 | SUCCESS
- runs-ts/phase-a-pilot.db#5cbbfc026288467489fe2590884a7110｜人类特异性基因与加速进化调控元件在大脑皮层发育中的协同作用机制研究｜引用 https://doi.org/10.1093/genetics/162.4.1825, https://doi.org/10.1093/gbe/evx240, https://doi.org/10.1093/molbev/msz173, https://doi.org/10.1007/s00439-019-02018-4, https://doi.org/10.59350/gm2dy-xbz17

## [2026-08-15] run | q30 | FAILED
- runs-ts/phase-a-pilot.db#51f2e44af7ae44cab4f353b1bbc9bec6｜迁徙动物导航机制中地磁-天体校准的核心作用及多感官整合研究｜引用 https://doi.org/10.1242/jeb.02261, 2000.1582, https://doi.org/10.1038/323106a0, https://doi.org/10.1007/978-3-662-11147-5_36, https://doi.org/10.1007/978-3-662-11147-5_34｜cls=review_rejected

## [2026-08-15] run | q31 | SUCCESS
- runs-ts/phase-a-pilot.db#2ebdcf4abb004f89a856a63672a1afb6｜气囊与气腔：蜥脚类恐龙巨大化的生理-生物力学协同机制研究｜引用 2309.12435v1, https://doi.org/10.1371/journal.pone.0068714, https://doi.org/10.1002/jez.517, https://doi.org/10.1666/0094-8373(2003)029<0243:vpasat>2.0.co;2, https://doi.org/10.1126/science.1160904

## [2026-08-15] run | q32 | FAILED
- runs-ts/phase-a-pilot.db#98b4ae1e4f34444998759daaf590bbaf｜重估地球真核生物物种数量：基于高阶分类单元与分子证据的综合分析｜引用 https://doi.org/10.1371/journal.pbio.1001127, https://doi.org/10.1038/news.2011.498, 6046.1083, https://doi.org/10.1371/journal.pbio.3002388, https://doi.org/10.64628/aa.knqgdphy6｜cls=review_rejected

## [2026-08-15] run | q33 | FAILED
- runs-ts/phase-a-pilot.db#15a6973f63c744b39d747403e08c25ee｜种群规模依赖下的进化动力：自然选择与遗传漂变的定量解耦与非线性响应｜引用 cond-mat/9907372v1, https://doi.org/10.2307/2407703, https://doi.org/10.1142/9789812813329_0007, 5646.2007, 1501.03632v2｜cls=review_rejected

## [2026-08-15] run | q34 | FAILED
- runs-ts/phase-a-pilot.db#28c0915cabb04a6d963dfef49081a81c｜全球现代人类种群中古老人类基因渗入的精细图谱及其功能性后果｜引用 1103.4621v2, https://doi.org/10.1038/d41586-018-06004-0, https://doi.org/10.1353/hub.2011.a427990, https://doi.org/10.1016/j.cub.2025.09.025｜cls=review_rejected

## [2026-08-15] run | q35 | SUCCESS
- runs-ts/phase-a-pilot.db#6f74a6f06f27457293191ecd1620134c｜动态互动视角下催产素、婴儿图式与依恋风格对人类犬猫依恋的协同机制研究｜引用 2019.0006, 2011.00200, 2017.01699, 0310.2010, 2015.0008

## [2026-08-15] run | q36 | FAILED
- runs-ts/phase-a-pilot.db#18856acec8104a619a4c4e7154b83e09｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q37 | FAILED
- runs-ts/phase-a-pilot.db#533721a625274b28a873c2433b81ffd2｜人类情绪起源的分布式神经网络机制：基于多模态影像的连接组学研究｜引用 2401.15743v1, oso/9780199, https://doi.org/10.1101/2022.01.29.477631, https://doi.org/10.1016/b978-0-443-13519-4.00014-3, 1308.5405v1, 1611.01643v1｜cls=review_rejected

## [2026-08-15] run | q38 | FAILED
- runs-ts/phase-a-pilot.db#d6cd0f70ef594c9f968ed2196f7b0d53｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q39 | FAILED
- runs-ts/phase-a-pilot.db#cd51a8f6b3c84fa698c0b10d1900b162｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q40 | FAILED
- runs-ts/phase-a-pilot.db#4fee8eb057bc4a65bcb22d1f7080a6cc｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q41 | FAILED
- runs-ts/phase-a-pilot.db#07fbdc734ab74412a2682024492d7ebc｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q42 | FAILED
- runs-ts/phase-a-pilot.db#00ba6a3958734c40bab95ddca5816b56｜内在基因组创新与外在宇宙灾难：解耦物种爆发与大规模灭绝的驱动机制｜引用 1609.02817v1, adap-org/9410004v1, https://doi.org/10.1007/978-3-540-75916-4_2, https://doi.org/10.1007/978-3-540-75916-4_6, 2023.10001, 0806.0108v1, hep-ph/9303206v1｜cls=review_rejected

## [2026-08-15] run | q43 | FAILED
- runs-ts/phase-a-pilot.db#d9d5eaad211e41dd86a0217baf2ea8a9｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q44 | FAILED
- runs-ts/phase-a-pilot.db#c7f3c99dcd164c04906e488ea1c1b255｜从原核到真核：人工合成细胞的技术跨越与可行性边界研究｜引用 https://doi.org/10.1126/science.1190719, https://doi.org/10.1126/science.aad6253, https://doi.org/10.1101/2020.06.02.130641, 2207.00538v1, https://doi.org/10.1002/pro.4179｜cls=review_rejected

## [2026-08-15] run | q45 | SUCCESS
- runs-ts/phase-a-pilot.db#5bd984d4c09d488bb6269c80ad01338f｜无膜凝聚物与膜结合细胞器的动态协同：细胞内生物分子有序组织的定量机制｜引用 https://doi.org/10.1007/5584_2025_852, https://doi.org/10.1016/j.devcel.2020.06.033, 1308.5548v1, https://doi.org/10.1016/j.tibs.2022.10.001, https://doi.org/10.1016/b978-0-12-823967-4.00002-6

## [2026-08-15] run | q46 | FAILED
- runs-ts/phase-a-pilot.db#e40b04a2ae9b47d991a43c7700ca9303｜空间维度数量的实证约束：基于LHC数据与弦理论框架的综合分析｜引用 1506.00024v1, 0806.3815v1, hep-th/0010195v1, 2510.25832v2, 1112.0788v3｜cls=review_rejected

## [2026-08-15] run | q47 | FAILED
- runs-ts/phase-a-pilot.db#efa86f1c9fc34045979c1233d0d26bca｜火星千人永久定居点的工程可行性与定量宜居性评估｜引用 1904.01389v1, 2505.22808v1, 2012.00100v1, 2101.04725v2, 2006.0004, 6545.0543｜cls=review_rejected

## [2026-08-15] run | q48 | SUCCESS
- runs-ts/phase-a-pilot.db#cbe99844e98e4e2dac73dcb23d270795｜基于多源观测数据的宇宙全局几何形状与空间曲率约束研究｜引用 2023.10135, https://doi.org/10.1007/978-3-319-23543-1_12, 2026.10242, https://doi.org/10.1063/1.4953315, 2007.12636v2

## [2026-08-15] run | q49 | FAILED
- runs-ts/phase-a-pilot.db#d86de5b56a964acbbaf104ab37f317e4｜多信使视角下的黑洞存在性验证：从事件视界成像到引力波波形分析｜引用 0711.1537v1, 0901.4365v3, https://doi.org/10.1017/9781108181938.017, 1906.11238v1, 2311.08680v2｜cls=review_rejected

## [2026-08-15] run | q50 | FAILED
- runs-ts/phase-a-pilot.db#f8f17b48127045ddb522718e228c7f61｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q51 | FAILED
- runs-ts/phase-a-pilot.db#7fc4b3de53b54e6ba2ec9ff16c2d6c99｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q52 | FAILED
- runs-ts/phase-a-pilot.db#c0d7e4c2af024dad8f2b0bc38a814c18｜太阳系行星轨道长期稳定性的动力学机制：守恒律、共振保护与耗散时标的数值验证｜引用 1306.0689v2, https://doi.org/10.1086/420808, https://doi.org/10.1086/177941, 1312.7008v2｜cls=verifier_refs

## [2026-08-15] run | q53 | SUCCESS
- runs-ts/phase-a-pilot.db#c199031c3a5f41aca913dbcec52378d4｜宇宙终极命运的概率评估：基于多信使观测对暗能量状态方程的约束｜引用 astro-ph/0510346v1, 2605.26749v2, https://doi.org/10.64628/ab.vgydapmph, https://doi.org/10.1017/cbo9780511804540.016, https://doi.org/10.1016/j.dark.2018.09.005, 2106.12050v2, 2005.12684v2

## [2026-08-15] run | q54 | SUCCESS
- runs-ts/phase-a-pilot.db#456a14a5bbbb4116818735c2ef7f6ccf｜宇宙射线起源的能量依赖性：从超新星遗迹到河外源的过渡验证｜引用 1209.5728v1, astro-ph/0602308v2, https://doi.org/10.1007/978-3-030-55231-2_12, https://doi.org/10.1051/0004-6361/201220394, 0904.1507v2, astro-ph/0412554v1

## [2026-08-15] run | q55 | FAILED
- runs-ts/phase-a-pilot.db#9e0d71bbe8c9440d847d2d597a82106f｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q56 | SUCCESS
- runs-ts/phase-a-pilot.db#5285595d4dc54c218e1df6beb7744dac｜多波段协同：联合反射与热发射光谱在系外行星生物标志物确证中的优势评估｜引用 1801.04868v1, 1705.05791v3, 1807.09504v3, 2601.08883v1, 2406.13037v1

## [2026-08-15] run | q57 | SUCCESS
- runs-ts/phase-a-pilot.db#73ce0bdf56bc4999a610006fb199f69e｜银河系的特殊性：基于标度关系偏离与暗物质晕动力学的综合评估｜引用 1111.2044v1, https://doi.org/10.1063/1.43959, 1605.02075v2, 2012.10130v1, 1111.2044v1

## [2026-08-15] run | q58 | FAILED
- runs-ts/phase-a-pilot.db#a7a8b54e5fcc47e586675e12e59a9af8｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q59 | SUCCESS
- runs-ts/phase-a-pilot.db#85edab763be34a7f8558867bdcef50d4｜多信使观测视角下广义相对论的稳健性检验与边界探索｜引用 2201.05418v1, 1806.10122v2, https://doi.org/10.1017/9781108181938.031, https://doi.org/10.1201/9781003652250-11, 2201.05418v1

## [2026-08-15] run | q60 | FAILED
- runs-ts/phase-a-pilot.db#9c8c702dee654ed2b6f0a269636723ec｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q61 | SUCCESS
- runs-ts/phase-a-pilot.db#da9d55edf754465c8b0ea8be26fc5a6f｜超越铁核坍缩：J0737-3039 系统揭示的脉冲星多样化形成机制研究｜引用 astro-ph/0103015v1, astro-ph/0208563v1, https://doi.org/10.1088/0004-637x/767/1/85, https://doi.org/10.1093/mnras/stt2188, 1302.1275v1

## [2026-08-15] run | q62 | FAILED
- runs-ts/phase-a-pilot.db#86547a6ef3294bca86ceb76a11f1bb89｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q63 | FAILED
- runs-ts/phase-a-pilot.db#5fc608657cd04fee87ab393ed1353b1b｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q64 | FAILED
- runs-ts/phase-a-pilot.db#934e4415f47f48a09449ac7e72d08564｜留守还是逃离：基于行星防御与火星空间天气风险的地球人类生存策略比较研究｜引用 2504.15321v1, 2211.04021v1, 1904.01389v1, 2406.10380v2, https://doi.org/10.31223/x5f45q, 1410.4471v2｜cls=review_rejected

## [2026-08-15] run | q65 | SUCCESS
- runs-ts/phase-a-pilot.db#38bcf76b4dbf4ee88fed83e0f07569ea｜多信使约束下的致密星状态方程与内部结构推断研究｜引用 1302.1275v1, astro-ph/9706236v2, astro-ph/0206025v1, 1603.02698v1, 1912.05703v1

## [2026-08-15] run | q66 | FAILED
- runs-ts/phase-a-pilot.db#f3562e7500d24c988e3a3c6ca4ea5a48｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q67 | SUCCESS
- runs-ts/phase-a-pilot.db#a95b50f155a948a4b7b2767c5376c4d8｜引力的几何本质：曲率、挠率与非度规性在当前实验精度下的可区分性研究｜引用 1905.04372v1, 2303.17185v2, hep-ph/0204284v3, 2101.00458v2, 1905.04372v1

## [2026-08-15] run | q68 | SUCCESS
- runs-ts/phase-a-pilot.db#1edb27d6a80d4346a4c4cd7a7a699282｜多信使约束下的宇宙重元素起源：中子星合并、超新星与AGB星的贡献解耦｜引用 1710.02142v1, 1710.05463v1, https://doi.org/10.1086/379766, 1011.2054v1, astro-ph/0603755v1

## [2026-08-15] run | q69 | SUCCESS
- runs-ts/phase-a-pilot.db#54451b4095d54ac2a1573c0da65959c9｜超越阿贝-瑞利准则：经典衍射极限的边界条件与量子及近场超分辨率机制验证｜引用 0708.3336v1, 2310.05810v1, 1810.06976v1, https://doi.org/10.1016/j.physleta.2010.07.068, https://doi.org/10.1038/s41534-022-00593-5

## [2026-08-15] run | q70 | FAILED
- runs-ts/phase-a-pilot.db#1fb40e8120024031a6316dbea0a2504d｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q71 | FAILED
- runs-ts/phase-a-pilot.db#d9f480022aed44039ec121e20bc3bf29｜高温超导微观机制的多探针联合验证研究｜引用 cond-mat/0508769v4, cond-mat/0507459v1, 1511.00771v1, 2201.02095v1, 1303.2624v2, 1508.01319v2｜cls=review_rejected

## [2026-08-15] run | q72 | FAILED
- runs-ts/phase-a-pilot.db#f2a6e40ff01a44a08fe6de0c08cc2937｜短程相互作用下集体运动的相变特征与Goldstone模式耦合机制研究｜引用 cond-mat/9804180v1, 1501.02468v1, nlin/0611031v1, 2102.04715v1, oso/9780192｜cls=review_rejected

## [2026-08-15] run | q73 | FAILED
- runs-ts/phase-a-pilot.db#aed12b34f1a54fa8ba3a307c685c7339｜量子不确定性、纠缠与不可访问自由度的实验验证研究｜引用 2105.09005v3, 2002.09833v2, 2003.02103v2, quant-ph/0411074v1, https://doi.org/10.1201/b17899-12｜cls=review_rejected

## [2026-08-15] run | q74 | FAILED
- runs-ts/phase-a-pilot.db#f0e960e03e034e1e9b5f99c1b2736b86｜光速壁垒的物理不可逾越性：基于狭义相对论与可变光速理论的比较分析｜引用 astro-ph/0606542v4, https://doi.org/10.21203/rs.3.rs-710875/v1, https://doi.org/10.1016/b978-0-12-813720-8.00001-5, https://doi.org/10.1017/cbo9780511755811.003, https://doi.org/10.1007/978-981-13-7783-9_7｜cls=review_rejected

## [2026-08-15] run | q75 | FAILED
- runs-ts/phase-a-pilot.db#cf5c7ebb6de143a498733aa98551f97c｜高能散射实验中对夸克与轻子点状结构的精确检验及复合尺度界限研究｜引用 hep-ph/0304186v1, https://doi.org/10.1142/9789812569363, 0907.2538v3｜cls=verifier_refs

## [2026-08-15] run | q76 | SUCCESS
- runs-ts/phase-a-pilot.db#433252df78134d7aa67ee94a5b0340af｜量子退相干与初始低熵条件对时间箭头涌现的联合机制研究｜引用 0908.3780v2, 1206.5781v1, https://doi.org/10.3390/e14030407, 1111.1829v2, 0910.5836v1

## [2026-08-15] run | q77 | FAILED
- runs-ts/phase-a-pilot.db#dcf52e144ae04dfaa610fa1eb37bb2a8｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q78 | FAILED
- runs-ts/phase-a-pilot.db#f5d2a6428b7e42feadd2b5c134394f08｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q79 | FAILED
- runs-ts/phase-a-pilot.db#7acce7fa2bae4dad8dbe0fbce45fe7bd｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q80 | FAILED
- runs-ts/phase-a-pilot.db#0ca6cbc4a4e84dd1b9cb6ed10d48a4dd｜引力诱导退相干下的跨尺度模拟：量子-经典边界的计算极限研究｜引用 1910.11775v2, 1311.5108v1, 2204.03381v1, 1404.2635v2, 2602.22517v2｜cls=review_rejected

## [2026-08-15] run | q81 | FAILED
- runs-ts/phase-a-pilot.db#6e1ce8514cce43c286b8e84b55c40ceb｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q82 | FAILED
- runs-ts/phase-a-pilot.db#b978ba4b92c24dadb57ad14affe903f4｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q83 | SUCCESS
- runs-ts/phase-a-pilot.db#50545b150e184b4e86b7a77639d98cd5｜真人尺寸隐形斗篷的物理限制与射线光学近似可行性研究｜引用 0904.3168v1, 1110.5604v1, https://doi.org/10.1007/978-1-4471-4996-5_10, https://doi.org/10.1007/978-1-4419-1151-3_9, 2011.02333v2, 1409.4705v2, https://doi.org/10.1002/mop.30226

## [2026-08-15] run | q84 | FAILED
- runs-ts/phase-a-pilot.db#f24cb11d94d94eeab02194d019bca23a｜M理论高阶结构的可观测印记：通往万物理论的经验路径｜引用 1010.3420v1, 2302.05922v1, 2306.11549v1, 1112.0788v3, 1903.02807v2｜cls=review_rejected

## [2026-08-15] run | q85 | SUCCESS
- runs-ts/phase-a-pilot.db#6d75b8f233da4f6883670d5baebe8c67｜多尺度约束下的暗物质候选模型比较：结合直接探测上限与弱引力透镜剖面分析｜引用 1809.09971v1, 1211.7222v1, https://doi.org/10.1038/nphys428, https://doi.org/10.1016/j.physletb.2005.11.005, 0911.0350v1

## [2026-08-15] run | q86 | SUCCESS
- runs-ts/phase-a-pilot.db#bb5afaed9a614cad8b3aed1aa260e260｜量子计算硬件的场景依赖性评估：基于多平台基准测试的性能权衡研究｜引用 2404.11572v2, 2304.14360v3, 2512.0554, 2606.04079v1, https://doi.org/10.1007/978-3-031-66477-9_2

## [2026-08-15] run | q87 | FAILED
- runs-ts/phase-a-pilot.db#85ed44cb906a44d3afcd4ca540b209dc｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q88 | FAILED
- runs-ts/phase-a-pilot.db#83db5401c8054eaa9da1d5a13803ae4f｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q89 | SUCCESS
- runs-ts/phase-a-pilot.db#0cd8075327744b7183e2cebbd7132310｜等离子体纳米棒增强型无铅无机钙钛矿/硅串联太阳能电池的缺陷工程与效率突破研究｜引用 1905.08024v1, 2507.22803v1, 1412.1136v1, 2510.19712v2, https://doi.org/10.1007/s11664-019-06943-y

## [2026-08-15] run | q90 | SUCCESS
- runs-ts/phase-a-pilot.db#4ae350a3fe454459b5bffba2463b9543｜纯自动驾驶未来的现实性评估：基于基础设施、混合交通与社会法律维度的综合研究｜引用 2001.03908v2, 2011.08729v3, 1908.00732v1, https://doi.org/10.3390/futuretransp6020060, https://doi.org/10.1201/9781003519423-10, https://doi.org/10.46254/wc01.20240125, https://doi.org/10.3390/designs5030040, 2301.05294v4, 2111.06318v2, 1906.09918v1

## [2026-08-15] run | q91 | FAILED
- runs-ts/phase-a-pilot.db#1be43dd204cb400bba4d777fe88b1f75｜量子速度极限与热力学约束下的计算机处理速度上限研究：理论推导与模型验证｜引用 2110.13193v2, 0805.4250v1, 2301.10063v3, https://doi.org/10.1007/978-3-319-93458-7_2, 2110.13193v2｜cls=review_rejected

## [2026-08-15] run | q92 | FAILED
- runs-ts/phase-a-pilot.db#a41dd4273df04dc3958a1b24d51ed1b2｜基于优化非线性三元码与屏障策略的DNA高密度档案存储可靠性与有效容量评估｜引用 2211.05552v1, 2201.05995v4, https://doi.org/10.1002/047146158x.ch5, https://doi.org/10.1007/978-981-95-9450-4_2, https://doi.org/10.1561/9781680839579｜cls=review_rejected

## [2026-08-15] run | q93 | FAILED
- runs-ts/phase-a-pilot.db#b1f329fe0705417fa632947d8f370d61｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q94 | FAILED
- runs-ts/phase-a-pilot.db#206296a7bf8f415c9e99d5020f1d5c82｜面向容错实现的拓扑量子比特编织操作与非阿贝尔统计验证研究计划｜引用 1101.4722v3, 2008.03542v1, 1811.02143v1, 2108.12850v1, 1904.07822v3｜cls=review_rejected

## [2026-08-15] run | q95 | FAILED
- runs-ts/phase-a-pilot.db#be955fadb649443a9b4b48cd66043194｜未产出 research-plan｜cls=provider_error

## [2026-08-15] run | q96 | FAILED
- runs-ts/phase-a-pilot.db#31df528c3b9c4b6f95f7caef4b84b33a｜未产出 research-plan｜cls=provider_error

## [2026-08-15] run | q97 | FAILED
- runs-ts/phase-a-pilot.db#7a5473e0cca54b348aed2c95cb205846｜未产出 research-plan｜cls=provider_error

## [2026-08-15] run | q98 | FAILED
- runs-ts/phase-a-pilot.db#c38492b9345d452bbc93e0bc0de2b139｜未产出 research-plan｜cls=provider_error

## [2026-08-15] run | q99 | FAILED
- runs-ts/phase-a-pilot.db#d4eb4a2defda4efaaba12459b378d01b｜未产出 research-plan｜cls=provider_error

## [2026-08-15] run | q2 | FAILED
- runs-ts/phase-a-v3-partial.db#2635e10658334faba996291d9b938d79｜黎曼猜想研究现状的系统性评估与验证框架重构｜引用 1910.02954v7, 2008.07206v2, https://doi.org/10.1063/1.1784280, https://doi.org/10.64628/aa.fatgnvf5u｜cls=review_rejected

## [2026-08-15] run | q1 | FAILED
- runs-ts/phase-a-v3-partial.db#8bfdf9c73b16491ab78fd4f3d6c1f81b｜素数特殊性的多维验证：从黎曼零点到随机矩阵统计的结构同构性研究｜引用 1810.02188v1, 1711.07996v2, 1003.4015v2, https://doi.org/10.15421/241607, 1910.02954v7, 2406.08121v2｜cls=review_rejected

## [2026-08-15] run | q3 | FAILED
- runs-ts/phase-a-v3-partial.db#4d728b098d4d4f8593311ce4fa65ed92｜纳维-斯托克斯千禧年难题现状评估：预印本声称解与奇点模型的批判性分析｜引用 1806.10081v10, 2505.13816v3, 1210.1981v4, https://doi.org/10.2139/ssrn.5295955, 1503.03063v2｜cls=review_rejected

## [2026-08-15] run | q6 | SUCCESS
- runs-ts/phase-a-v3-partial.db#2ed6b0fdb9b34f6eb4391199f25f0855｜基于扫描探针与非线性光谱联用的微观界面现象综合表征研究｜引用 1504.04790v2, 1704.06330v1, 1011.3942v3, 2607.20017v1, 2207.14610v1, https://doi.org/10.1017/s1431927617000368, https://doi.org/10.1007/978-3-662-45240-0_9, https://doi.org/10.1016/j.electacta.2007.03.016

## [2026-08-15] run | q5 | FAILED
- runs-ts/phase-a-v3-partial.db#f918265143f54f3d9662861130806ca8｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q7 | SUCCESS
- runs-ts/phase-a-v3-partial.db#26f4bce12c20451883b06b89ed93de8c｜原子层沉积固态电解质在电网级储能中的应用：安全性、循环寿命与经济性的综合评估｜引用 1903.03740v1, 1912.04755v1, https://doi.org/10.1201/9781003512882-4, https://doi.org/10.3390/batteries12080300, https://doi.org/10.1016/j.ensm.2020.05.001

## [2026-08-15] run | q8 | FAILED
- runs-ts/phase-a-v3-partial.db#e7409229bd2b4d828b9b9c924807a2f2｜同手性的功能必要性：外消旋混合物对生物大分子结构与功能影响的定量研究｜引用 2012.12850v1, 2110.01975v1, 2205.01193v1, https://doi.org/10.1007/978-3-0348-8837-0_10, https://doi.org/10.1007/pl00000777｜cls=review_rejected

## [2026-08-15] run | q4 | FAILED
- runs-ts/phase-a-v3-partial.db#cad7d2669e1b46ba9ffbb12441908dc6｜未产出 research-plan｜cls=deadline_exceeded

## [2026-08-15] run | q9 | FAILED
- runs-ts/phase-a-v3-partial.db#45f23232be5744a0b37b2201ec1dccde｜整合AI多光谱分拣与化学回收以提升塑料废弃物试点系统价值保留率的研究计划｜引用 2501.13855v1, 2105.06808v1, 2211.06509v1, https://doi.org/10.1201/9781003449133-11, https://doi.org/10.1016/bs.mie.2020.12.027｜cls=review_rejected

## [2026-08-15] run | q11 | FAILED
- runs-ts/phase-a-v3-partial.db#d77bf89be0884b5097ad8c6d99834cef｜基于功能性合成生物学与细胞凝聚体编程的工程活体材料构建研究｜引用 2207.00538v1, https://doi.org/10.3389/conf.fbioe.2016.01.01269, https://doi.org/10.1101/2025.03.02.640994, 2311.13342v1｜cls=verifier_refs

## [2026-08-15] run | q12 | SUCCESS
- runs-ts/phase-a-v3-partial.db#263fe81706aa4a8eabe982a8f965ea28｜能量流驱动下化学反应网络中自复制能力的自发涌现机制研究｜引用 1801.05872v2, 2107.03086v1, https://doi.org/10.1002/9781118698723, nlin/0512025v3, 1512.04478v2

## [2026-08-15] run | q13 | SUCCESS
- runs-ts/phase-a-v3-partial.db#987f5efb67354f3db588cdd048524beb｜基于多维数据融合与人畜共患病溢出风险模型的有限早期预警系统验证研究｜引用 1801.07807v1, 2601.13349v2, 2311.03654v1, https://doi.org/10.1016/b978-0-443-33871-7.00011-8, 1801.07807v1

## [2026-08-15] run | q10 | SUCCESS
- runs-ts/phase-a-v3-partial.db#2ddc8847533a48d3bfc04faba999cbaf｜量化人工智能对化学研究范式的影响：从数字孪生到自主发现的实证评估｜引用 2502.17506v3, 2601.13232v1, 2025.10010, https://doi.org/10.21275/sr26105185908, 2508.03278v1

## [2026-08-15] run | q16 | FAILED
- runs-ts/phase-a-v3-partial.db#9c1657fe6afc463ea201c4341bf8a0cb｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q14 | FAILED
- runs-ts/phase-a-v3-partial.db#05e193e55d83401288c560b9a8ad2f1e｜普通感冒治愈路径的可行性边界：从抗原多样性挑战到广谱抗病毒策略的综合评估｜引用 https://doi.org/10.1358/dof.2000.025.03.858657, https://doi.org/10.1136/bmj.1.3395.165, 2017.02412, 2017.20203, https://doi.org/10.1016/0166-3542(92)90032-z｜cls=review_rejected

## [2026-08-15] run | q17 | FAILED
- runs-ts/phase-a-v3-partial.db#6fa9b10485dc4afebe0d65250ac8bc10｜NR4A 核受体家族通过直接调控调节性 T 细胞抑制性细胞因子表达维持免疫稳态的研究｜引用 https://doi.org/10.1101/2021.04.28.441904, https://doi.org/10.1016/j.coi.2008.10.005, https://doi.org/10.4110/in.2013.13.6.227, https://doi.org/10.1016/b978-0-443-45128-7.00020-0｜cls=review_rejected

## [2026-08-15] run | q15 | SUCCESS
- runs-ts/phase-a-v3-partial.db#5234229968c74a6088f4f1dfcf8ce74c｜基于药物基因组学与逆设计3D打印的个性化多药丸：一项随机对照药代动力学试验与GMP合规性研究｜引用 2512.09154v2, 2023.0364, https://doi.org/10.1201/b15465-23, https://doi.org/10.47191/etj/v11i06.22, 2507.00166v1, https://doi.org/10.1007/978-981-96-9075-6_4, 2025.10024

## [2026-08-15] run | q18 | SUCCESS
- runs-ts/phase-a-v3-partial.db#b8816c626a8947cebd866a519eae2f30｜primo血管系统作为传统中医经络解剖学基础的实证研究：多模态成像与生理功能分析｜引用 https://doi.org/10.1016/j.jams.2013.10.001, https://doi.org/10.1016/j.jams.2012.07.001, https://doi.org/10.1016/j.dcmed.2020.09.001, https://doi.org/10.1097/hm9.0000000000000128, https://doi.org/10.1016/j.jams.2012.07.017

## [2026-08-15] run | q19 | FAILED
- runs-ts/phase-a-v3-partial.db#e4c6a5fd28cf43c89272171fdacbd6c3｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q20 | FAILED
- runs-ts/phase-a-v3-partial.db#7922ea9883b84b54b498f298588f00c3｜遗传-环境交互作用驱动自闭症谱系障碍异质性病因的研究计划｜引用 1301.2694v1, https://doi.org/10.4324/9781351242455-2, med/9780199, https://doi.org/10.55677/ijmspr/2026-3050-i415, https://doi.org/10.70957/uqu.edu.sa/s.toxicology.s/stj.2025.2.8｜cls=review_rejected

## [2026-08-15] run | q21 | FAILED
- runs-ts/phase-a-v3-partial.db#39efc6ecc6fc40b6b84964e96264fde9｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q22 | SUCCESS
- runs-ts/phase-a-v3-partial.db#c1a4eda3f8c64370a35d80dbcafa3aaa｜肠道微生物组-代谢组-疾病轴在年龄相关性炎症中的因果作用：一项基于结构方程模型的纵向研究｜引用 2402.08222v2, 2303.16722v1, https://doi.org/10.1201/9781003037521-9, https://doi.org/10.1007/978-981-16-3156-6_5, https://doi.org/10.1007/978-981-16-3156-6_9, https://doi.org/10.1186/s40168-017-0296-0

## [2026-08-15] run | q24 | SUCCESS
- runs-ts/phase-a-v3-partial.db#ef6a4ecc175245d7bdb6d6a73fba78b2｜协同增效：评估禁捕政策、防降级措施与船队多样化对海洋生物多样性及渔业产量的综合影响｜引用 2210.03890v1, 2308.16397v1, 0807.4040v2, 1602.05723v2, 1403.2812v3

## [2026-08-15] run | q23 | SUCCESS
- runs-ts/phase-a-v3-partial.db#0ed2f5a179db440b9f806926533c3d1c｜从个案到预测：基于转化建模与计算机仿真的基因编辑猪肾脏异种移植潜力评估｜引用 2404.14658v1, https://doi.org/10.1111/xen.70018, https://doi.org/10.1111/xen.12848, https://doi.org/10.1016/s0140-6736(24)00938-3, https://doi.org/10.1111/aor.14945, https://doi.org/10.1111/xen.70052

## [2026-08-15] run | q26 | SUCCESS
- runs-ts/phase-a-v3-partial.db#0ebf427c59d64112b081e6e9332e155b｜表观遗传景观中的能垒与拓扑限制：解析细胞命运选择性的定量机制｜引用 1211.3133v4, 1410.2337v1, https://doi.org/10.1177/21524971251359000, 1312.7250v2, 2005.04877v1

## [2026-08-15] run | q25 | FAILED
- runs-ts/phase-a-v3-partial.db#ef0ed096941b4fc982fe1eb573956778｜多靶点联合干预对Misrepair积累驱动的生物衰老及健康寿命的影响研究｜引用 2408.15264v1, 1505.07016v2, 2406.13889v1, 2024.13342, 1103.4649v1｜cls=review_rejected

## [2026-08-15] run | q27 | SUCCESS
- runs-ts/phase-a-v3-partial.db#54be2c8026f149b88ca433c9f7b24e2b｜漂变与负荷的博弈：有效种群大小对无性系基因组大小演化的调节机制｜引用 1511.05548v1, 1109.2214v2, https://doi.org/10.1007/978-94-011-4156-7_13, oso/9780198, 1511.05548v1

## [2026-08-15] run | q28 | FAILED
- runs-ts/phase-a-v3-partial.db#6abaa7ff918d466eb8fac6015eb323cb｜从技术瓶颈到理论极限：癌症治愈可能性的多尺度量化分析｜引用 2411.19532v1, 1705.05025v1, 2605.04999v2, 1409.1974v1, https://doi.org/10.70534/zfha4089, https://doi.org/10.1016/j.ctrv.2016.08.008｜cls=review_rejected

## [2026-08-15] run | q30 | SUCCESS
- runs-ts/phase-a-v3-partial.db#9db3fd0a057f45f6b3a4d9f5d16bbc57｜地磁校准天体线索：迁徙鸟类导航中的量子磁感应机制研究｜引用 2504.12336v2, 2106.12903v1, 2000.1582, https://doi.org/10.1038/s41598-024-77883-9, https://doi.org/10.1038/347378a0, https://doi.org/10.1007/bf00168646

## [2026-08-15] run | q32 | FAILED
- runs-ts/phase-a-v3-partial.db#1c5b2cb69d02451baad048c4827d1e45｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q29 | FAILED
- runs-ts/phase-a-v3-partial.db#2386890877014d3586340b6e99e90d3a｜解码人类独特性：NOTCH2NL、HARs 与 FOXP2 在大脑进化中的协同机制研究｜引用 https://doi.org/10.1007/s00439-019-02018-4, 5127.79354, https://doi.org/10.1093/gbe/evx240, https://doi.org/10.1016/j.schres.2022.06.023, https://doi.org/10.1093/genetics/162.4.1825｜cls=review_rejected

## [2026-08-15] run | q31 | SUCCESS
- runs-ts/phase-a-v3-partial.db#5835862fb9ce4143aa4d5a70ccbb71cb｜蜥脚类恐龙巨大化的进化级联机制：基于多物理场耦合模型的定量验证｜引用 https://doi.org/10.1371/journal.pone.0078573, https://doi.org/10.1371/journal.pone.0068714, https://doi.org/10.1666/0094-8373(2003)029<0243:vpasat>2.0.co;2, https://doi.org/10.1371/journal.pone.0163205, https://doi.org/10.1126/science.1160904

## [2026-08-15] run | q34 | FAILED
- runs-ts/phase-a-v3-partial.db#91ae80fac0fd48a7925c91f8f919297e｜古代人类与古人类祖先杂交的多重证据整合与功能性后果验证研究计划｜引用 1103.4621v2, 1312.7749v1, https://doi.org/10.1101/343087, https://doi.org/10.1038/s41559-018-0735-8, https://doi.org/10.1002/ajpa.23951｜cls=review_rejected

## [2026-08-15] run | q36 | FAILED
- runs-ts/phase-a-v3-partial.db#df51790a5c904f93bebff4f26a81d8b9｜未产出 research-plan｜cls=invalid_output

## [2026-08-15] run | q35 | SUCCESS
- runs-ts/phase-a-v3-partial.db#b70a493373db4941b47958c9c569e15a｜解构跨物种依恋：婴儿图式与凝视在人-狗及人-猫关系中的差异化神经机制｜引用 https://doi.org/10.1126/science.1261022, 2023.10680, https://doi.org/10.2147/prbm.s74972, 2011.00200, 2505.02756v1

## [2026-08-15] run | q33 | FAILED
- runs-ts/phase-a-v3-partial.db#632892c2eac245648e03db9c56435ed4｜个体间波动选择（FSI）的动力学特征与信息论量化：一项基于模拟和人类基因组数据的验证研究｜引用 1211.4037v1, https://doi.org/10.1101/2025.11.10.687654, https://doi.org/10.1007/s13752-017-0264-8, https://doi.org/10.1101/2023.07.11.548607, 2111.06909v1｜cls=review_rejected

## [2026-08-15] run | q37 | FAILED
- runs-ts/phase-a-v3-partial.db#1de2fa4dfb8d422cbd21d6b0ae337a9f｜基于MEG-fMRI融合技术的人类情感起源时空动态机制：岛叶与杏仁核的因果时序解析｜引用 1308.5405v1, https://doi.org/10.1101/2022.01.29.477631, https://doi.org/10.1016/b978-0-443-13519-4.00014-3, https://doi.org/10.4324/9780429472541-7, https://doi.org/10.1007/s00429-023-02644-9｜cls=review_rejected

## [2026-08-15] run | q38 | FAILED
- runs-ts/phase-a-v3-partial.db#ca7a4e1f944e4faeb4ea64e861cecfd6｜全球人口增长极限：基于多模型回溯测试与敏感性分析的峰值预测验证｜引用 https://doi.org/10.2139/ssrn.4435761, https://doi.org/10.18356/9789210014380c008, https://doi.org/10.18356/9789211071887c005, https://doi.org/10.1080/0032472031000149536｜cls=review_rejected

## [2026-08-15] run | q39 | FAILED
- runs-ts/phase-a-v3-partial.db#9ebd6457b7734046be961f860fda8094｜雌激素驱动的生长板软骨细胞衰老与干细胞耗竭在骨骼生长终止中的协同作用机制研究｜引用 https://doi.org/10.1159/000327788, 2227.1995, 2025.10163, https://doi.org/10.69622/32020686｜cls=review_rejected

## [2026-08-15] run | q40 | SUCCESS
- runs-ts/phase-a-v3-partial.db#ae61e68a6bf04dbbb67a8b058a0ab05d｜自然缺失与人工诱导：人类冬眠能力的生理学边界与临床应用评估｜引用 https://doi.org/10.64628/ab.mek6jdfyk, https://doi.org/10.1007/978-3-662-04162-8_16, 2102.11510, https://doi.org/10.1007/978-4-431-53961-2_45, https://doi.org/10.7748/en2003.07.11.4.24.c1127

## [2026-09-04] run | q1 | FAILED
- outputs/runtime/deadline-smoke.db#bfe12073bdf94112b8351a66ec85d65d｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q61 | FAILED
- outputs/runtime/flash-q61-20260906.db#420ad036691c418391759cfad168b809｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q61 | FAILED
- outputs/runtime/flash-q61-20260906-v2.db#850b808f02b9429cbe9e2d94e7e49c2d｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q61 | FAILED
- outputs/runtime/flash-q61-20260906-v3.db#2edd4c8e26de4abcaf18b97b3daf6641｜未产出 research-plan｜cls=deadline_exceeded

## [2026-09-06] run | q61 | FAILED
- outputs/runtime/flash-q61-20260906-v4.db#bfa6380b3f804d5a8fa7b3b072713bfe｜未产出 research-plan｜cls=provider_error

## [2026-09-06] run | q61 | FAILED
- outputs/runtime/flash-q61-20260906-v5.db#c1b78393d5c849ae89ea940c1915e42e｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q61 | FAILED
- outputs/runtime/flash-q61-20260906-v6.db#8149b101b84f4a498480a08d4f159b17｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q61 | FAILED
- outputs/runtime/flash-q61-20260906-v7.db#70c4e4e8739e403ba2484d0b34ffd230｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q61 | FAILED
- outputs/runtime/flash-q61-20260906-v8.db#f00c3e0f2e774c368534376bc3489890｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q61 | FAILED
- outputs/runtime/flash-q61-20260906-v9.db#7cc7ab6487444f2abe5e566c15b6f4cc｜毫秒脉冲星 + CO 白矮星伴星子群的前身通道判别：Case A 洛希瓣溢出相对共同包层旋进的观测体积加权产率检验｜引用 1103.4996v2, 2604.24970v1, 1806.04175v1, https://doi.org/10.22323/1.288.0043, https://doi.org/10.1086/344405, https://doi.org/10.1016/j.newar.2010.09.005, https://doi.org/10.1017/9781108861656.009, https://doi.org/10.1007/978-94-011-2704-2_17, https://doi.org/10.3847/1538-4357/aaad07, https://doi.org/10.22323/1.146.0208, 1302.1275v1｜cls=verifier_refs

## [2026-09-06] run | q61 | SUCCESS
- outputs/runtime/flash-q61-20260906-v10.db#0228174fcc4945aca14db6b4c4ed0a4d｜脉冲星形成通道的运动学判别：在同一不对称性度量下对照电子俘获超新星与铁核坍缩的出生 kick｜引用 2966.2005, https://doi.org/10.3847/1538-4357/aa618e, https://doi.org/10.3847/1538-4357/aadbae, https://doi.org/10.3847/2041-8213/ab5642, https://doi.org/10.1007/978-94-009-7876-8_10, https://doi.org/10.1088/0004-637x/806/2/153, https://doi.org/10.1143/ptp.103.713, 1806.04175v1, https://doi.org/10.1093/mnras/stt2188, astro-ph/9704268v1, 1008.2130v2, https://doi.org/10.3847/1538-4357/ac0a74

## [2026-09-06] run | q61 | FAILED
- outputs/runtime/flash-q61-20260906-v11.db#1dad9cb354ee462ba57a35e458c7c979｜携带状态方程条件的中子星质量低质量超额作为脉冲星形成通道判别量：双星脉冲星计时样本的预注册有界比较设计｜引用 https://doi.org/10.1051/0004-6361/202661228, 2966.2012, https://doi.org/10.1088/0004-637x/719/1/722, https://doi.org/10.1086/167451, https://doi.org/10.3847/1538-4357/aadbae, https://doi.org/10.3847/2041-8213/ab5642, https://doi.org/10.1093/mnras/274.2.461, https://doi.org/10.1086/318893, https://doi.org/10.1016/j.newar.2010.09.005｜cls=invalid_output

## [2026-09-06] run | q61 | FAILED
- outputs/runtime/flash-q61-20260906-v12.db#4965026341b540649b28dab61ba81093｜电子俘获超新星的中子星流体学 kick 上限：在多个二维火焰传播前导星与三维对照上的同口径复算｜引用 https://doi.org/10.3847/1538-4357/aadbae, 1802.05274v2, https://doi.org/10.3847/1538-4357/aa618e, 2112.15257v2, https://doi.org/10.3847/1538-4357/aae648, 1806.04175v1, 1605.09529v1, https://doi.org/10.3847/1538-4365/ad12c1, astro-ph/0309588v2, 2010.09005v1｜cls=invalid_output

## [2026-09-06] run | q1 | FAILED
- outputs/runtime/phase-a-science125-20260906-deadline.db#2e3a533c94384c5091453056fe20d763｜未产出 research-plan｜cls=provider_error

## [2026-09-06] run | q15 | FAILED
- outputs/runtime/phase-a-science125-20260906-deadline.db#4eb71af608a748618ce2e686fd506fc6｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q4 | FAILED
- outputs/runtime/phase-a-science125-20260906-deadline.db#e78d572d9ad44fc8becb269e5a130a05｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q2 | FAILED
- outputs/runtime/phase-a-science125-20260906-deadline.db#69d58af2f39f4fa2ad52e4885e9f77be｜未产出 research-plan｜cls=deadline_exceeded

## [2026-09-06] run | q6 | FAILED
- outputs/runtime/phase-a-science125-20260906-deadline.db#396ad7d9f8414b4a99089b176f19006a｜表面电荷驱动的 vSFG 探测深度漂移：固定光路下固/液界面水谱定量可比性的预注册检验｜引用 2607.20017v1, 1405.6533v1, 2508.13737v1, 0886.2020, https://doi.org/10.1016/b978-0-323-85669-0.00145-8, cond-mat/0209599v1, 1703.06184v3, 1704.01158v3, 1110.3334v1｜cls=invalid_output

## [2026-09-06] run | q5 | FAILED
- outputs/runtime/phase-a-science125-20260906-deadline.db#84f1523e51794968837b15c5e296ceec｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q14 | FAILED
- outputs/runtime/phase-a-science125-20260906-deadline.db#484696649b2845a0b52ff3d1b58bd6a4｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q11 | FAILED
- outputs/runtime/phase-a-science125-20260906-deadline.db#74492db53af1432ab9bd82ec81077c8e｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q7 | FAILED
- outputs/runtime/phase-a-science125-20260906-deadline.db#9a4a49e3371c4098b296df84a221d669｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q8 | FAILED
- outputs/runtime/phase-a-science125-20260906-deadline.db#0648357012c146939092a1b40a2183b6｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q17 | FAILED
- outputs/runtime/phase-a-science125-20260906-deadline.db#316bac595f434628a64feb5836a9dd5f｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q10 | FAILED
- outputs/runtime/phase-a-science125-20260906-deadline.db#fb5059b5b5b04840b3318a22178a755c｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q16 | FAILED
- outputs/runtime/phase-a-science125-20260906-deadline.db#50acff621bfa42eba8364355814cbb83｜未产出 research-plan｜cls=deadline_exceeded

## [2026-09-06] run | q12 | FAILED
- outputs/runtime/phase-a-science125-20260906-deadline.db#cedf8c97cd044f8ea90110b53b4d2679｜最小自推进粒子体系中自复制涌现的密度阈值：尺度不变性、生长—衰亡平衡与密度/通量归因分离的可证伪计算方案｜引用 1512.04478v2, 1702.02141v5, 1702.04873v1, cond-mat/0303280v1, 1304.5519v2, 5646.2010, https://doi.org/10.2307/2410451, https://doi.org/10.1007/bf00328690, https://doi.org/10.1163/156853900502565, https://doi.org/10.1101/087155, https://doi.org/10.2307/2266021, https://doi.org/10.32942/x2p618, https://doi.org/10.7287/peerj.preprints.27919v1, https://doi.org/10.1007/978-1-4613-0883-6_5｜cls=review_rejected

## [2026-09-06] run | q9 | FAILED
- outputs/runtime/phase-a-science125-20260906-deadline.db#1426987d66c741ca978cec8c2fd43b53｜尚待验证的研究计划：聚烯烃热化学升级跨实验献语料上部分观测学习与报告规范化的消融对照｜引用 2608.02402v1, 2309.08354v1, 2507.14413v1, https://doi.org/10.26434/chemrxiv-2022-t6435-v2, 2501.13855v1, https://doi.org/10.1255/jnirs.849, 2023.10725, https://doi.org/10.5772/intechopen.108432｜cls=review_rejected

## [2026-09-06] run | q13 | FAILED
- outputs/runtime/phase-a-science125-20260906-deadline.db#94a0cd87f067422183a2c12407ddbe4a｜未产出 research-plan｜cls=deadline_exceeded

## [2026-09-06] run | q23 | FAILED
- outputs/runtime/phase-a-science125-20260906-deadline.db#6c076ad26a3b44f39e03a3ef0ad3128c｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q22 | FAILED
- outputs/runtime/phase-a-science125-20260906-deadline.db#c624a910a0774eb086c8dfaa03241eee｜成人 IBD 队列中粪便短链脂肪酸对「肠道菌群—疾病活动度」关联的中介份额与方向不对称：一项预注册的有界比较研究计划｜引用 2402.08222v2, 2208.09338v1, https://doi.org/10.1093/ibd/izx029, https://doi.org/10.55920/ijcimr.2022.02.001078, https://doi.org/10.26226/morressier.59a6b34cd462b80290b5591b, https://doi.org/10.1002/9781118982907.ch19, https://doi.org/10.1201/9781003598336-13, https://doi.org/10.1201/9781003037521-9｜cls=invalid_output

## [2026-09-06] run | q3 | FAILED
- outputs/runtime/phase-a-science125-20260906-deadline.db#5245c045398642da80bae81485680aa9｜未产出 research-plan｜cls=deadline_exceeded

## [2026-09-06] run | q24 | FAILED
- outputs/runtime/phase-a-science125-20260906-deadline.db#945066c238be4d989f773bbb2d10c8c7｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q21 | FAILED
- outputs/runtime/phase-a-science125-20260906-deadline.db#4926cda0a64c46768424015f510b36d5｜分离通路依赖与直接毒性：dequalinium chloride 诱导的临时妥布霉素协同致死在耐药铜绿假单胞菌中的机制归属与非遗传回退动力学｜引用 https://doi.org/10.1038/s41467-023-37357-4, https://doi.org/10.1101/241075, https://doi.org/10.1101/2020.07.10.198259, https://doi.org/10.7554/elife.65130.sa2, https://doi.org/10.1101/2023.06.14.544983, https://doi.org/10.1101/2023.07.11.548518, https://doi.org/10.1101/2025.01.23.633114, https://doi.org/10.5812/jjm-135911｜cls=invalid_output

## [2026-09-06] run | q19 | FAILED
- outputs/runtime/phase-a-science125-20260906-deadline.db#0cd8c83798d940e184369eb17f108845｜同一批 mRNA-LNP 盲样上 DLS 单维判定与 DLS+NTA+二维 AEX–IP-RPLC 正交判定的批次裁决一致性：一项待验证的描述性对照研究计划｜引用 https://doi.org/10.5920/bjpharm.1396, 2026.34521, https://doi.org/10.46610/jqaqc.2022.v04i01.002, 2410.1560, 2012.0493, https://doi.org/10.7774/cevr.2025.14.e40, https://doi.org/10.14293/s2199-1006.1.sor-.ppsvhlh.v1, https://doi.org/10.1201/9781003149835-17, https://doi.org/10.1016/b978-0-444-64046-8.00183-x, https://doi.org/10.4155/pbp.13.16, https://doi.org/10.1007/978-3-031-31380-6_12｜cls=review_rejected

## [2026-09-06] run | q18 | FAILED
- outputs/runtime/phase-a-science125-20260906-deadline.db#448fd4fb7e3c4664b62c99697c2896c2｜捻针诱导成纤维细胞细胞骨架重塑是否具有穴位归属特异性：基于胶原密度与组织硬度预匹配的小鼠结缔组织组织块等效性检验研究计划｜引用 https://doi.org/10.1002/jcp.20623, https://doi.org/10.1002/jcp.22442, https://doi.org/10.1002/jcp.24356, https://doi.org/10.1038/s41598-018-32048-3, https://doi.org/10.17504/protocols.io.mmpc45n, https://doi.org/10.1097/md.0000000000029878, https://doi.org/10.1155/2012/793841, https://doi.org/10.7759/cureus.115471｜cls=review_rejected

## [2026-09-06] run | q8 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#c05e55f1c188489baecc5f32927c5a25｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q4 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#875d0d496a794933af305f5d973fef4a｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q15 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#e4cbda5896034ba3afe71cd045a928e9｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q12 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#fd0202246ebe4dbc99584bf993a52f9c｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q5 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#75b04eaac81841c7b2d2426fd6962ac8｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q9 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#dbd492412ea14d39a34dc56c4b118bcc｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q10 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#ab2b1f2eee0347f39fbab5328d3c3c9b｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q16 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#da253aba78d3468a8d0723cac4162d8b｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q6 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#ccac69d5ff5f46a5b5d8fc649eafe31d｜未产出 research-plan｜cls=deadline_exceeded

## [2026-09-06] run | q18 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#ca002d7ae1344b6b827311ff9d1d317c｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q14 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#3925dc9e572349c2a0e4f63c473e81d3｜现代分子分型口径下人鼻病毒血清型交叉中和矩阵的抗原簇结构与多价覆盖率量化：一项预注册描述性研究计划｜引用 https://doi.org/10.4049/jimmunol.114.2_part_1.635, https://doi.org/10.1128/iai.37.2.642-647.1982, https://doi.org/10.1101/2024.06.28.601138, https://doi.org/10.1101/2023.05.11.540440, 2017.02412, https://doi.org/10.1016/j.vaccine.2019.04.018｜cls=invalid_output

## [2026-09-06] run | q3 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#4c4baeba1c464a518db5094b4276d1c7｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q23 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#9ccdd619bd9243a7b5e15207e6229ebf｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q2 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#3945d30919bf43b2ac27631251c0dd80｜未产出 research-plan｜cls=deadline_exceeded

## [2026-09-06] run | q1 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#532f6159793c4f439d85aae6e27354c1｜未产出 research-plan｜cls=deadline_exceeded

## [2026-09-06] run | q11 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#4012d5054bca4eee8ad54eb9a3f9e200｜同一基质、两种底盘：细菌纤维素活体材料中分泌型功能构建体的跨底盘保持率与机制分解｜引用 https://doi.org/10.1101/2019.12.20.882472, https://doi.org/10.1038/s41467-021-25350-8, https://doi.org/10.1101/2020.05.11.088138, https://doi.org/10.3390/fib12030029, https://doi.org/10.1002/biot.202300529, https://doi.org/10.2139/ssrn.4079357, 2311.13342v1, https://doi.org/10.1002/adfm.202301875, https://doi.org/10.1021/acssynbio.8b00423｜cls=review_rejected

## [2026-09-06] run | q20 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#c535417ee3024ce580cf50a1aa4fa501｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q19 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#39363fc79d2e42a485e2245d64611903｜saRNA 疫苗低剂量优势的天花板：一项分离 LNP 递送效率与固有免疫感知的头对头剂量—反应研究计划｜引用 https://doi.org/10.3390/pathogens12010138, https://doi.org/10.5772/intechopen.101467, https://doi.org/10.1042/bio_2021_142, https://doi.org/10.3390/vaccines10101678, https://doi.org/10.1101/2024.12.05.627087, https://doi.org/10.21203/rs.3.rs-7572829/v1, https://doi.org/10.21203/rs.3.rs-9834795/v1｜cls=review_rejected

## [2026-09-06] run | q17 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#8c552f8b3fa540f6a4b6c343aa6c24bc｜RT-Treg 对 AIRE+ 胸腺上皮细胞丰度的剂量依赖抑制：以配对白喉毒素毒性对照与发育窗口分层进行的有界验证｜引用 https://doi.org/10.1093/intimm/dxq212, https://doi.org/10.1093/jimmun/vkag141.1055, https://doi.org/10.1038/ni1444, 2026.18063, https://doi.org/10.1038/s43587-024-00711-2, https://doi.org/10.1007/978-1-0716-2647-4_3, https://doi.org/10.1038/s41385-021-00413-7, https://doi.org/10.1038/ni0407-333, 8162.79356｜cls=invalid_output

## [2026-09-06] run | q7 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#3c958f6d6ed2432ab5c59063bcea3b9a｜LiBH4 掺杂 argyrodite Li6PS5Cl 的临界电流密度增益：界面层动力学与体相离子电导的双向干预归因研究计划｜引用 1908.10144v1, 2604.17380v1, https://doi.org/10.1149/ma2026-013341mtgabs, https://doi.org/10.26434/chemrxiv-2022-szgx0, 2501.10567v1, 2412.00340v3, 2206.08135v1, https://doi.org/10.1063/10.0019616｜cls=review_rejected

## [2026-09-06] run | q13 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#42e373b89281461d867662f8b9993be3｜IDOBE 暴发片段上逐片段广义增长参数 p 的可辨识性与分层预报误差梯度：一项预注册的有界比较研究计划｜引用 2604.18521v2, 2608.06671v1, 1512.01389v2, https://doi.org/10.1016/j.epidem.2016.01.002, https://doi.org/10.1101/2022.12.20.22283714, https://doi.org/10.1186/1742-4682-7-1, https://doi.org/10.1016/j.idm.2019.12.009, https://doi.org/10.1101/2021.07.14.21260514, 2006.16189v4, 2306.04338v1, 2005.04937v1, 1802.07562v2｜cls=review_rejected

## [2026-09-06] run | q25 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#8a8e70a5c43440fab3fbc9c279bdf901｜未产出 research-plan｜cls=deadline_exceeded

## [2026-09-06] run | q26 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#219a7b7eddc04347822eb9e8a096ce21｜解除可逆细胞周期停滞能否解锁硬性失败配对：巨噬细胞→胰腺 β 细胞直接重编程的 2×2 正交检验｜引用 2021.70711, https://doi.org/10.1101/2021.05.07.443145, https://doi.org/10.3390/cells13080707, https://doi.org/10.70675/c50451dcz5c35z4befzba7dze6365925fc5f, https://doi.org/10.1007/978-1-60761-691-7_14, https://doi.org/10.1097/mog.0000000000000172, https://doi.org/10.1007/978-1-61779-940-2_12, https://doi.org/10.1007/978-1-0716-2899-7_10, https://doi.org/10.1101/2020.10.01.322420, https://doi.org/10.1101/2023.09.25.559293, https://doi.org/10.1101/238279｜cls=review_rejected

## [2026-09-06] run | q30 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#27f011d3e64448ee98b28efe9acf747c｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q29 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#6fc30d3c78fa4338b31a5fa68f60bf46｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q28 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#4cc03b066c3540e3a5cd5841d916da29｜未产出 research-plan｜cls=deadline_exceeded

## [2026-09-06] run | q27 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#cdcdeb3919fa44df83dc3d12b28de512｜插入-删除平衡还是漂变屏障？跨类群真核基因组大小变异的有界比较研究计划｜引用 2002.1605, 8312.2003, https://doi.org/10.21203/rs.3.rs-725394/v1, https://doi.org/10.64898/2026.07.03.736272, https://doi.org/10.1093/gbe/evs027, https://doi.org/10.1127/pip/2019/0085｜cls=review_rejected

## [2026-09-06] run | q22 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#22f4f970963649589955ffe0b0b59513｜克罗恩病中产 SCFA 菌属经粪便短链脂肪酸影响疾病状态的中介效应可辨识性：一项对照结构与协变量扰动下的预注册有界比较研究计划｜引用 https://doi.org/10.1101/2024.02.24.581863, https://doi.org/10.1097/md.0000000000038551, 2402.08222v2, https://doi.org/10.1159/000508984, https://doi.org/10.1016/j.cell.2016.05.041, https://doi.org/10.18060/22742, https://doi.org/10.1146/annurev-pathol-011811-132421, https://doi.org/10.1101/2024.12.01.626246, https://doi.org/10.1201/9781003598336-14, https://doi.org/10.1201/9781003598336-13, https://doi.org/10.1002/9781118982907.ch19｜cls=invalid_output

## [2026-09-06] run | q34 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#f790fc9abd104089934ca846f7aa9ca2｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q33 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#54c5934b44a94de5b55de5611d7ca786｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q36 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#d4b97c40e07b412f8603caf69842e008｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q24 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#8febf822b0af4f4db7cf899e4cef510a｜面积之外的答案：统一面积预算下海洋保护区扩展的空间布局与法律治理等级组合的优先化模拟研究｜引用 https://doi.org/10.1101/2021.07.07.451416, oso/9780199, 2210.03890v1, https://doi.org/10.1111/gcb.15307, oso/9780199, 1602.05723v2, https://doi.org/10.1016/j.biocon.2009.09.019, https://doi.org/10.1016/j.gecco.2019.e00768｜cls=review_rejected

## [2026-09-06] run | q21 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#448c69dd8aad41998e28dc3db5cb2f33｜一致 collateral sensitivity 配对与切换周期窗口：S. pneumoniae 中 CS 导向序贯疗法相对等总暴露单药的有界比较研究计划｜引用 https://doi.org/10.1101/2025.09.22.677096, https://doi.org/10.1101/241075, https://doi.org/10.1101/454983, https://doi.org/10.1101/641217, 2510.01808v4, 2409.07377v2, 2302.13897v1, 2007.01245v1, 2105.10429v1, 2503.07664v2｜cls=invalid_output

## [2026-09-06] run | q43 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#c9908d44edae4009992b4a80f6f7e681｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q37 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#6b398aac117b42acaef354dcaa64e752｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q51 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#8aaca0899b90416eaa585006c3bb97d3｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q39 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#75beaec9d4ff4b81b91ad56bac3ad7e1｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q48 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#b9275b3cb87645d98fe78f9f72b268d8｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q31 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#78c69cdd72c04b2c87919464b3346a50｜蜥脚形类后骨骼气腔化是否先于最大体重的台阶式上升：基于统一肢骨—体重标度与采样校正的配对矩阵研究计划｜引用 2009.0139, https://doi.org/10.1186/1741-7007-10-60, https://doi.org/10.1016/j.cub.2023.02.067, https://doi.org/10.1371/journal.pone.0078573, https://doi.org/10.1016/j.resp.2006.04.014, 2010.0075, 8312.2002, https://doi.org/10.1002/9781119990475.ch2｜cls=review_rejected

## [2026-09-06] run | q44 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#8dae9094dd27495795aef3dd40c98e25｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q35 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#5db236534db34e359eda273ce4019b32｜未产出 research-plan｜cls=deadline_exceeded

## [2026-09-06] run | q49 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#4bb15e26d7a8464f8a24d2804659a84d｜Lyman-Werner 谱形能否决定原初气体云的结局：固定总通量条件下直接坍缩黑洞种子产出的受控模拟检验｜引用 oso/9780198, gr-qc/9805045v1, 1807.06967v1, 1609.03562v2, 1807.08499v1, astro-ph/0702340v1, 1807.06593v1, 1807.06337v2, https://doi.org/10.1142/9789814699662_0011, astro-ph/0606678v1｜cls=review_rejected

## [2026-09-06] run | q38 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#03bd382e573644cf9f360f3e628cc7c5｜世界人口会无限增长吗？三种人口动量口径对全球达峰年份的一致性交叉检验｜引用 https://doi.org/10.1111/padr.12685, https://doi.org/10.25336/p6d615, https://doi.org/10.1080/0032472031000143606, https://doi.org/10.1080/0032472031000148296, https://doi.org/10.1016/j.tpb.2023.12.002, https://doi.org/10.4054/demres.2012.26.14, https://doi.org/10.2139/ssrn.6633479, 0399.0010｜cls=review_rejected

## [2026-09-06] run | q32 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#29a3501ac46e4d38b8b1b448cb8d50e2｜未产出 research-plan｜cls=deadline_exceeded

## [2026-09-06] run | q41 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#aab0aacd477c46328303c050d9aa5013｜多基因形态性状的预测缺口比：用公开汇总统计检验定向设计上限的尚待验证研究计划｜引用 https://doi.org/10.1101/274654, https://doi.org/10.1101/2024.08.15.608197, https://doi.org/10.1101/2022.11.10.22282137, 2205.05897v1, https://doi.org/10.1093/molbev/msg092, hesc/9780198, 1232.0009, https://doi.org/10.1038/nrg3727｜cls=invalid_output

## [2026-09-06] run | q56 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#02e0558b4b1c4f809bbaddfc46de4990｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q52 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#b060cd0cea63425997c536d347294bed｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q46 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#6013036e54864d6daff783b5c8d9a8db｜亚毫米尺度引力反平方律排除上限的可追溯性与一致性核验：把「空间有效维数为 3」限定为有界结论｜引用 https://doi.org/10.1103/physrevlett.86.1418, https://doi.org/10.1103/physrevd.70.042004, https://doi.org/10.1103/physrevlett.49.1745, https://doi.org/10.1142/9789814307673_0003, hep-ex/0202008v1, hep-ph/0307284v1, https://doi.org/10.1051/epn:2002205, https://doi.org/10.1016/s0262-4079(26)00509-9｜cls=review_rejected

## [2026-09-06] run | q45 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#590e4820c83f44eea39ea2ef7ba40856｜未产出 research-plan｜cls=deadline_exceeded

## [2026-09-06] run | q54 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#b4edf823242840728e1f1cb34f6716b1｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q47 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#0f75e7938b77457f9412762d4adde3a6｜未产出 research-plan｜cls=deadline_exceeded

## [2026-09-06] run | q53 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#0820ffe1c6a64533b985e63c923ecce7｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q42 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#1a0ba68150a84cc098b268481c3c253c｜K-Pg 之后浮游有孔虫形态复杂性是否领先于属级多样性回升：一项预注册的滞后结构再分析计划｜引用 https://doi.org/10.31233/osf.io/wn8g6, https://doi.org/10.5194/gmd-16-813-2023, https://doi.org/10.1666/0094-8373(2001)027<0327:eticot>2.0.co;2, https://doi.org/10.1017/s0094837300016778, https://doi.org/10.32614/cran.package.fossilbrush, https://doi.org/10.5194/cpd-10-3303-2014, https://doi.org/10.1144/gsl.sp.1996.101.01.18, https://doi.org/10.1002/9780470015902.a0022875, https://doi.org/10.2307/3514632, https://doi.org/10.1111/evo.13362, https://doi.org/10.1554/02-742, https://doi.org/10.1130/abs/2022am-379749, https://doi.org/10.2307/3514772, https://doi.org/10.64628/ab.mukjaf7vh｜cls=review_rejected

## [2026-09-06] run | q57 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#15008bc2a3bd4705936890b0175e0d51｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q40 | SUCCESS
- outputs/runtime/phase-a-science125-20260906-coverage.db#eb714f36f93b42f099d2bbf07fa9b1c2｜化学诱导小鼠可逆低代谢状态的蛰伏与被动低温判别：基于 T b–MR 迟滞判据与颅温钳制的预注册对照实验方案｜引用 0214.2014, 2017.0054, https://doi.org/10.1038/s41598-017-15002-7, https://doi.org/10.1096/fasebj.28.1_supplement.lb775, https://doi.org/10.1016/s0952-8180(97)00144-x, https://doi.org/10.1097/shk.0b013e31802e27a0, https://doi.org/10.1016/j.bpj.2024.11.3208, oso/9780199, https://doi.org/10.3748/wjg.v23.i3.406, https://doi.org/10.3233/jin-170063

## [2026-09-06] run | q50 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#b581aed6faca434a908aa0200f61570f｜SPARC 型星系上运动学与强透镜通道的成对质量比较：对 cored 晕普适先验与延迟引力一致性条件的有界检验｜引用 https://doi.org/10.2139/ssrn.6936599, https://doi.org/10.1142/s0218271822420184, https://doi.org/10.23880/oaja-16000103, https://doi.org/10.1142/s0218271817501899, https://doi.org/10.1093/mnras/stx1573, 2022.10109, 2966.2009｜cls=review_rejected

## [2026-09-06] run | q58 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#8c1598f1ad2d41ed9c1d361061ed0985｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q65 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#a88c67abca9d4dcdb2f95d7ac1ef3cdb｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q61 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#708960b843bb44fc9401ff82b31a4846｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q59 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#7002f1a3a0be48b2bffe1f9d329dd29b｜GWTC-3 强场广义相对论检验的逐参数上限审计：区分「与零一致」与「灵敏度不可区分」的有界比较研究计划｜引用 2204.00662v1, 2603.16026v1, 2405.05884v2, 2205.14910v2, 2401.08709v3, 2310.10447v2, 2201.05418v1, 1212.5575v2, 1203.2150v1, gr-qc/0411095v1, 1805.05863v3, https://doi.org/10.1103/physrevd.88.103008, oso/9780198, https://doi.org/10.1007/978-3-030-83715-0_29｜cls=invalid_output

## [2026-09-06] run | q55 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#cb33ba89bd9340a79f5b14bc9eb6bc68｜核子能量-动量张量胶子反常项的禁闭势类比：基于引力形状因子的可推翻数值检验计划｜引用 https://doi.org/10.34133/research.1155, https://doi.org/10.1007/jhep11(2021)121, https://doi.org/10.1007/jhep01(2019)120, https://doi.org/10.1007/jhep12(2018)008, 2509.10786v2, https://doi.org/10.1103/physrevd.88.036007, https://doi.org/10.22323/1.500.0264, https://doi.org/10.22323/1.413.0060, https://doi.org/10.1103/physrevlett.78.610｜cls=review_rejected

## [2026-09-06] run | q67 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#9664a6d80b4744c6bdc4f99bf67ef906｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q60 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#17be66b8a6a244a98990489aa24eb37d｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q71 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#ddcfd145001d4b529ec8701ac6ff75cf｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q63 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#f77a5209cb40490db9c66af8189d6c66｜大洋上壳玄武玻璃生物成因蚀变终止深度的地温梯度控制：基于公开岩心的跨站位配对检验研究计划｜引用 https://doi.org/10.1002/9780470015902.a0021894, 2025.0001, https://doi.org/10.1002/essoar.10510753.1, https://doi.org/10.1029/97jb02603, https://doi.org/10.2139/ssrn.4218703, https://doi.org/10.2973/odp.pr.102.1985, 2010.0604, https://doi.org/10.1029/2008gc002119, https://doi.org/10.5194/egusphere-egu23-4098, https://doi.org/10.5194/egusphere-egu24-16500, https://doi.org/10.5194/egusphere-egu25-7472, https://doi.org/10.2204/iodp.proc.320321.214.2013, https://doi.org/10.1016/b978-0-12-409548-9.09741-4, https://doi.org/10.1515/9783110300130.121, https://doi.org/10.1017/cbo9780511933875.030, https://doi.org/10.5026/jgeography.116.5_714｜cls=review_rejected

## [2026-09-06] run | q62 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#295cf029412a4fe8976413b9d15ffb1b｜火星任务剖面下被动屏蔽的面密度—剂量—发射质量联合判定：载人深空辐射门槛的可计算检验｜引用 2211.04021v1, 2103.11213v1, 2012.09604v2, 2205.13786v3, 1804.02985v1, https://doi.org/10.2139/ssrn.7382521, https://doi.org/10.1097/hp.0000000000001572, https://doi.org/10.1101/2023.12.12.23299875, https://doi.org/10.12681/eadd/59007, https://doi.org/10.1016/j.lssr.2025.05.008｜cls=review_rejected

## [2026-09-06] run | q64 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#e1fa90278692416b97120c1813a579ef｜撞击还是必走之路？用公开巡天星表独立重算 ≥100 Mt 级近地天体撞击的预警完备度与地点条件性风险｜引用 https://doi.org/10.1038/s41598-017-14199-x, https://doi.org/10.3847/psj/ad4d9e, https://doi.org/10.4271/2000-01-2339, https://doi.org/10.1515/opag-2017-0010, https://doi.org/10.1016/j.lssr.2024.03.008, https://doi.org/10.1002/gch2.201970011｜cls=review_rejected

## [2026-09-06] run | q80 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#e2bf55f8a67f43c1811211f027d31ecd｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q69 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#5bc4183dfabd4a86a71729da2c2c1ec4｜未产出 research-plan｜cls=deadline_exceeded

## [2026-09-06] run | q68 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#078c728ecb3e40019d54c18c63c0085b｜致密双星并合抛射物 r-过程丰度图案的条件性：tail-to-disk 质量比扫描与电子分数中介检验｜引用 https://doi.org/10.1088/1361-6382/aa7a77, https://doi.org/10.1093/mnras/stz3154, 0195.00055, actrade/9780198, https://doi.org/10.1016/s1387-6473(02)00184-7, https://doi.org/10.1007/978-981-19-6345-2_91, https://doi.org/10.1063/1.4763392｜cls=invalid_output

## [2026-09-06] run | q70 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#3cf8d545e469471ebdc4e8a73c2c4959｜热输运下限的分层检验：Einstein 型最小热导率的零参数跨体系比对与准粒子—非相干描述的差分拟合优度｜引用 https://doi.org/10.1557/proc-234-27, https://doi.org/10.1103/physrevb.46.6131, https://doi.org/10.1063/1.3226884, https://doi.org/10.1063/1.1314301, https://doi.org/10.1557/mrs.2018.209, https://doi.org/10.1201/9781003210719-17, https://doi.org/10.1103/physrevb.35.4067, https://doi.org/10.1016/s0081-1947(08)60359-8, https://doi.org/10.1007/978-1-4684-4916-7_31｜cls=invalid_output

## [2026-09-06] run | q72 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#97b956e1149c424dabae2ec3456791d4｜速度是否通过压制取向噪声增强集体秩序：实验室非致密鱼群梯度干预与噪声补偿的研究计划｜引用 https://doi.org/10.1101/400747, https://doi.org/10.5821/dissertation-2117-396562, https://doi.org/10.1039/c7sm01648d, https://doi.org/10.1101/2021.02.23.432454, https://doi.org/10.1073/pnas.1005766107, https://doi.org/10.1016/j.crhy.2019.05.008｜cls=review_rejected

## [2026-09-06] run | q66 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#2b001c9ad0544f2587a105474b67d408｜辐射级联修正下软 X 射线与 GeV 指标对耀变体高能中微子产生期的相对示踪能力：一项基于历史多信使匹配回溯的预注册研究计划｜引用 https://doi.org/10.3847/1538-4357/aad59a, https://doi.org/10.3847/1538-4357/ab4b44, https://doi.org/10.3847/1538-4357/aadade, epjconf/2019207, epjconf/2019207, https://doi.org/10.1093/pasj/psz142, https://doi.org/10.22323/1.358.1017, https://doi.org/10.22323/1.358.1004｜cls=review_rejected

## [2026-09-06] run | q73 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#9a9bdba9ad244011886f7cb859680354｜纠缠辅助能否压低线性 Shannon 熵不确定度下界：可分态饱和性质的受控数值判定｜引用 https://doi.org/10.22331/q-2018-03-30-59, 1801.04602v4, https://doi.org/10.1103/physrevlett.60.1103, 1509.00398v1, 1108.5349v2, https://doi.org/10.1007/s40509-022-00282-0, oso/9780198｜cls=invalid_output

## [2026-09-06] run | q84 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#34b550f1abdc42f5950fef821c02f6b5｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q75 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#278e923bd68d4f5bbccc299fcfb0ac38｜夸克-轻子复合性能标下限的方案族重建：通道、系数方案与亮度对 Λ 排除边界的相对贡献｜引用 2006.12946v3, 1707.02424v2, 1607.03669v3, 1202.5535v2, 1102.2020v2, 1201.6510v2, https://doi.org/10.1103/physrevd.62.095003, https://doi.org/10.2172/402515, https://doi.org/10.1103/physrevlett.128.241804, https://doi.org/10.1016/0370-1573(86)90073-6｜cls=invalid_output

## [2026-09-06] run | q74 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#95775a7210a64f31b50d6317821a6629｜未产出 research-plan｜cls=deadline_exceeded

## [2026-09-06] run | q81 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#8b96458b5f064a0aaeaac32e2eff36d5｜未产出 research-plan｜cls=deadline_exceeded

## [2026-09-06] run | q83 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#847ea5010f3945dc9cfdf3175a5ac92a｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q86 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#46515497f1e64966ada6db41875fae1c｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q88 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#c107d5bf1add47519f344323f1cf6a49｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q87 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#b245beb96ed74a79833668ead00b794e｜湍流的终极统计不变量：多重分形标度谱跨雷诺数普适性的有界检验｜引用 2006.10993v2, 2307.04846v2, 2607.26896v1, 2601.12528v1, https://doi.org/10.1063/1.870081, https://doi.org/10.1017/jfm.2012.5, https://doi.org/10.1016/b978-0-444-88889-1.50031-5, https://doi.org/10.70675/a422b221z1eb5z4232zaf37zdbc2f2507b20｜cls=invalid_output

## [2026-09-06] run | q77 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#d799ed46e80344a7baf2c36073dcb090｜未产出 research-plan｜cls=deadline_exceeded

## [2026-09-06] run | q78 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#1a6f363c00664f0dbe37be64b41b38e3｜早期超新星激波中质子最大能量对前身星风质量损失率的门槛性依赖：一项参数扫描与机制分解的预注册研究计划｜引用 astro-ph/0009444v1, astro-ph/0407311v1, https://doi.org/10.3847/1538-4357/ac21ce, https://doi.org/10.22323/1.358.0348, https://doi.org/10.22323/1.395.0146, 1999.79213, https://doi.org/10.1103/physrevaccelbeams.26.111002, https://doi.org/10.1142/9789811217135_0002, https://doi.org/10.1063/1.1291365, https://doi.org/10.1142/s0217751x16440140, https://doi.org/10.1103/physrevaccelbeams.20.011008｜cls=review_rejected

## [2026-09-06] run | q76 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#e408ba3ec9cd44f1be9540e58d346a8c｜有限孤立系统中熵增方向的描述依赖性：按粗粒化类型分层的 observational entropy 对照研究（待验证）｜引用 1905.03841v2, 2008.04409v2, cond-mat/0602024v2, https://doi.org/10.1093/pnasnexus/pgag288, https://doi.org/10.3390/e20020138, https://doi.org/10.3390/foundations4040037, https://doi.org/10.3390/e17096329, https://doi.org/10.1142/9789811211720_0010｜cls=invalid_output

## [2026-09-06] run | q79 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#d6b1ef84d85b44c38bee88f377e45862｜冷原子/BEC 绝对重力测量的采用广度：一份基于部署证据清单与 SWaP-C 对照表完备性的有界检验计划｜引用 https://doi.org/10.5194/egusphere-egu21-14072, https://doi.org/10.5194/egusphere-egu24-20659, https://doi.org/10.5194/egusphere-egu21-9119, 1302.1518v1, https://doi.org/10.1007/s00340-024-08243-8, https://doi.org/10.3390/s17030567, 1610.09986v1, 1311.7033v4｜cls=review_rejected

## [2026-09-06] run | q90 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#d3e98dff4cd949d889c4cc81d2cd11fd｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q82 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#f57d29a4f2d94016bd4b466c93346efa｜同一 Z2 格点正则化下 edge mode 处理方案的并列对照：纠缠熵差的尺度分解与规范无关性检验｜引用 1312.1183v1, 0811.3824v1, 1705.10474v2, 1808.03973v1, 2401.07299v4, 2401.07292v4, https://doi.org/10.1093/ptep/ptag116, 1212.3507v3｜cls=invalid_output

## [2026-09-06] run | q85 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#09ffe3a558a6427d9753527424c71d8b｜超 faint 矮星系恒星核作为低速度端自相互作用暗物质截面锚点的可判别性检验：核尺寸—恒星质量趋势、双相简并与反馈前提的联合核查｜引用 https://doi.org/10.1051/0004-6361/202557040, https://doi.org/10.3390/universe7080313, https://doi.org/10.1088/0004-637x/793/1/46, https://doi.org/10.1088/2041-8205/736/1/l2, 2966.2012, https://doi.org/10.1088/0004-637x/785/1/57, 2966.2006, https://doi.org/10.1007/978-3-030-15077-8_4, https://doi.org/10.1007/978-94-017-3311-3_95｜cls=review_rejected

## [2026-09-06] run | q89 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#27aeb93758a7423b92a4d0fece1cc0b2｜热载流子电池效率上限的两侧分解：能量选择性接触与吸热器热化抑制的敏感度比较研究计划｜引用 2212.10357v1, 1509.06899v1, 2212.03618v3, https://doi.org/10.4324/9781315793245-44, https://doi.org/10.21741/9781644903018-6, 2604.24098v1, 2412.13694v1｜cls=invalid_output

## [2026-09-06] run | q93 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#4e67d244d1c8451bb3f162e53d5c8496｜未产出 research-plan｜cls=deadline_exceeded

## [2026-09-06] run | q101 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#084d7aa0bf564174b733481a6e0b0160｜未产出 research-plan｜cls=invalid_output

## [2026-09-06] run | q92 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#716e4bcdad364a5b85bd396ff1ff095e｜同一冗余预算下的两种花法：DNA 归档存储中约束映射与纠错码的有效密度—保真度对照｜引用 2308.05952v2, 2112.09417v1, https://doi.org/10.1101/2024.08.15.608111, https://doi.org/10.1101/2024.11.05.622081, 1501.07133v2, 2604.13667v1, 2020.29679, https://doi.org/10.1007/978-981-95-9450-4_2, https://doi.org/10.1007/978-981-95-9450-4_9, 2727.77348｜cls=review_rejected

## [2026-09-06] run | q108 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#784bd895dd2444c08e94692339ac4773｜未产出 research-plan｜cls=provider_error

## [2026-09-06] run | q110 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#1685776aaa42425d850278c5a02e4adc｜未产出 research-plan｜cls=provider_error

## [2026-09-06] run | q104 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#813969b4b6f64965aa09eb6b8c2eddff｜未产出 research-plan｜cls=provider_error

## [2026-09-06] run | q111 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#858081b0607e4ce4b6fd2207469b9391｜未产出 research-plan｜cls=provider_error

## [2026-09-06] run | q105 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#cabdb41ae2c3489c9ab513ff8d714f3a｜未产出 research-plan｜cls=provider_error

## [2026-09-06] run | q107 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#ed68fecec6fb49a38525e1db9d0148a6｜未产出 research-plan｜cls=provider_error

## [2026-09-06] run | q115 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#27767045afe4476182c55a3186fd2be0｜未产出 research-plan｜cls=provider_error

## [2026-09-06] run | q116 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#debccc9e2bca48b8898446d01ba8ec77｜未产出 research-plan｜cls=provider_error

## [2026-09-06] run | q117 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#1e157138eaaa48aab15f438a2875ed5a｜未产出 research-plan｜cls=provider_error

## [2026-09-06] run | q118 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#a160e17c832d40619fedfc72c45b7edf｜未产出 research-plan｜cls=provider_error

## [2026-09-06] run | q119 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#1c041d8c96204e2da2f88e530b79ad4a｜未产出 research-plan｜cls=provider_error

## [2026-09-06] run | q120 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#ce1a1d03612c4d24b72c74686b0f2d7d｜未产出 research-plan｜cls=provider_error

## [2026-09-06] run | q121 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#8b18a17a802f4955ba45f5027ec162b9｜未产出 research-plan｜cls=provider_error

## [2026-09-06] run | q122 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#0388dee028884f7f8b9ff24eba4f372c｜未产出 research-plan｜cls=provider_error

## [2026-09-06] run | q112 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#41863025768f4cc3a113a3a121bbf0da｜未产出 research-plan｜cls=provider_error

## [2026-09-06] run | q124 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#04d8e7d52a4b45479a2a17af11f95f5f｜未产出 research-plan｜cls=provider_error

## [2026-09-06] run | q95 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#566c5e60b8a144be932ab4857016abea｜未产出 research-plan｜cls=provider_error

## [2026-09-06] run | q114 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#8e14596241584c01827ba12a853a9107｜未产出 research-plan｜cls=provider_error

## [2026-09-06] run | q109 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#2495430038844c28adfbcca4ab926fc8｜未产出 research-plan｜cls=provider_error

## [2026-09-06] run | q106 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#2cdd60bc3ba54769b6f034f7e6fc19ec｜未产出 research-plan｜cls=provider_error

## [2026-09-06] run | q123 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#11dbd62b622c4d65aa0c9753a9236126｜未产出 research-plan｜cls=provider_error

## [2026-09-06] run | q103 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#5cb37f1b0b614602ab2f9b40dcd310b3｜未产出 research-plan｜cls=provider_error

## [2026-09-06] run | q99 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#36e52ce3288245c99b4ddc0c8a5b9cd9｜未产出 research-plan｜cls=provider_error

## [2026-09-06] run | q91 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#95f30edfd57946c8a56759a9f030095b｜有限时间擦除功惩罚是否给出含擦除不可逆计算的处理速度上界：详细平衡域内与域外的单比特对照检验｜引用 2106.00580v2, 1411.6730v1, 1703.04872v1, https://doi.org/10.1103/physrevlett.117.200601, https://doi.org/10.1142/s2010194514603640, https://doi.org/10.1007/s10825-015-0754-5, 2015.72886, https://doi.org/10.1088/1742-5468/2015/06/p06015, https://doi.org/10.1080/00107510010018916, https://doi.org/10.1038/35023282, https://doi.org/10.1103/physrevlett.88.237901, https://doi.org/10.2172/2002037, https://doi.org/10.1007/978-3-319-93458-7_1｜cls=provider_error

## [2026-09-06] run | q125 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#c463d76466224453bdfbdbdb7805f034｜未产出 research-plan｜cls=provider_error

## [2026-09-06] run | q100 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#1154bcf48fd34b3ba1cc50c0618c58c5｜未产出 research-plan｜cls=provider_error

## [2026-09-06] run | q97 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#a2dcc23cf03a45f0a11a84fa87b08fca｜未产出 research-plan｜cls=provider_error

## [2026-09-06] run | q102 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#7b453a53f2134ef89243b48b029acb6b｜未产出 research-plan｜cls=provider_error

## [2026-09-06] run | q113 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#6b646066303e4c9987699b4a3e9ec038｜未产出 research-plan｜cls=provider_error

## [2026-09-06] run | q96 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#0957ede346f947438e181dc2d6716018｜未产出 research-plan｜cls=provider_error

## [2026-09-06] run | q98 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#f676022de16745b0a0d6696d4d219ae2｜未产出 research-plan｜cls=provider_error

## [2026-09-06] run | q94 | FAILED
- outputs/runtime/phase-a-science125-20260906-coverage.db#8622706020074424a2362f74b81b3b48｜单一零偏压电导峰的非普适性：在 class D 纳米线平行参量切片上用局部势扰动、端间非局域关联与电流噪声谱判据检验拓扑断言的判别充分性｜引用 1705.02035v2, 1803.05423v3, 1910.11413v2, 1901.02655v2, 2004.08583v1, 1806.01292v2, https://doi.org/10.1088/1367-2630/ada97c, https://doi.org/10.3762/bjnano.9.127, https://doi.org/10.21203/rs.3.rs-1999030/v1, https://doi.org/10.1103/physrevb.91.041106｜cls=provider_error
