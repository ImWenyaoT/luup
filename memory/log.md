<!--
时序日志（append-only）。每条记录的首行格式固定：

    ## [YYYY-MM-DD] <action> | q<id> | <verdict>

    action  = run（历史条目另有 note / library-sync，来自已删除的 TS 栈）
    q<id>   Science-125 题号；无题号写 q-
    verdict ∈ {SUCCESS, FAILED}（历史条目另有 ALL PASS / PAUSED）

首行之下是可选的 `- ` 明细行。前缀固定 ⇒ `grep "^## \[" memory/log.md | tail -20`
就是确定性检索，零解析成本。本文件由 backend/app/agent/campaign.py 在 run 收尾时追加，
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
