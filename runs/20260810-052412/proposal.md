# Disentangling Pulsar Formation Channels: A Four-Channel Hierarchical Bayesian Mixture Model for Core-Collapse, Electron-Capture, Accretion-Induced Collapse, and Globular-Cluster Dynamical Origins of Galactic Neutron Stars

> 由 luup 多智能体流水线生成。引用已经确定性反查 arXiv API 核验。

## 输入问题

来源：《Science》125 前沿科学问题（Science-125 题库）第 61 题，Astronomy。

问题：How are pulsars formed?

任务：围绕该问题识别当前研究的具体知识缺口，生成可验证的科学假设，并给出完整研究计划（10 标准字段）。

## 1. 待研究问题（Problem Statement）

Despite decades of pulsar observations, the relative importance of the proposed formation channels—iron core-collapse supernovae, electron-capture supernovae, accretion-induced collapse, and globular-cluster dynamical assembly—remains poorly constrained. Young pulsar populations are broadly consistent with CC-SNe, but the existence of low-kick neutron stars in wide binaries (e.g., PSR J0737−3039B) and the potential for AIC to produce millisecond pulsars indicate that additional channels contribute. No existing study has simultaneously modeled all four channels with a unified statistical framework that accounts for observational selection effects and uses natal kick velocities and orbital eccentricities as primary discriminants.

## 2. 解决思路（Rationale）

1. CCSNe produce the highest birth rate and the broadest kick-velocity distribution (mean ≳ 300 km/s) and therefore dominate the young, high-velocity tail of the pulsar population [1806.07267; 2412.08446; 2002.01367]. 2. EC-SNe are predicted to impart small natal kicks (≲ 50 km/s), so their neutron stars remain in wide, nearly circular orbits — a signature observed in DNS systems where six of eight known Galactic disk DNS binaries have e < 0.27 [0704.1215; 2205.03989]. 3. AIC is a theoretically predicted channel [1406.4128] that should produce millisecond pulsars on long, highly circular orbits (e < 0.1, P_orb > 2 d) [1901.00547], but no direct detection of an AIC event exists; it must therefore be treated as a hypothesis to be tested. 4. Globular clusters retain neutron stars and dynamically assemble millisecond pulsars through exchange encounters and tidal captures [0711.3001], producing a population distinguishable by its spatial concentration, high MSP fraction, and distinct spin/orbital distributions [2111.14084]. 5. The expanding DNS sample [1904.12745] and the growing catalogue of pulsar proper motions [2002.01367] now make it feasible to use natal kick velocities and orbital eccentricities — jointly — as primary observables in a hierarchical Bayesian mixture model, with common-envelope physics [2001.09829] and second-SN kick prescriptions [1904.06137] providing the theoretical forward model.

## 3. 必要的技术手段（Technical Details）

A four-component hierarchical Bayesian mixture model is constructed. For each pulsar i, a latent channel indicator z_i ∈ {CCSN, ECSN, AIC, GC} is drawn from a categorical distribution with mixing fractions θ = (f_CCSN, f_ECSN, f_AIC, f_GC). Conditional on z_i, the observables (v_kick, e, P_orb, P, B, environment) are drawn from channel-specific likelihoods p(v_kick, e, P_orb, P, B, env | z_i, φ_z), where φ_z are channel-specific parameters (mean kick, kick dispersion, eccentricity shape parameters, etc.). The forward model for binary observables incorporates common-envelope physics [2001.09829] and second-supernova kick prescriptions [1904.06137] to predict the joint (e, P_orb, v_sys) distribution for each channel. Hyper-priors on θ are Dirichlet; the AIC component receives a conservative prior f_AIC ~ Beta(1, 20) centred near zero, reflecting its status as an unconfirmed theoretical prediction [1406.4128]. Posterior inference uses nested sampling (MultiNest / dynesty) to obtain both parameter posteriors and the Bayesian evidence Z for model comparison.

## 4. 数据集（Datasets）

**Source（推演依据的历史数据）**：ATNF Pulsar Catalog supplemented by PSRπ proper motion/parallax measurements, known DNS orbital parameters from literature, globular cluster pulsar catalogues, and transient survey upper limits for AIC events.

**Target（验证实验需采集的数据特征）**：Posterior distributions on formation-channel mixture weights and channel-specific hyperparameters (kick velocity distributions, eccentricity distributions, spin/magnetic field distributions) for the Galactic pulsar population. Explicit determination of whether AIC is required by the data.

## 5. 标题（Paper Title）

Disentangling Pulsar Formation Channels: A Four-Channel Hierarchical Bayesian Mixture Model for Core-Collapse, Electron-Capture, Accretion-Induced Collapse, and Globular-Cluster Dynamical Origins of Galactic Neutron Stars

## 6. 摘要（Paper Abstract）

Pulsars — rotating, magnetised neutron stars — are the end products of several distinct astrophysical pathways. The standard picture identifies iron core-collapse supernovae (CC-SNe) of massive stars as the dominant channel, electron-capture supernovae (EC-SNe) of super-AGB stars as a low-kick channel producing wide, circular binaries, and accretion-induced collapse (AIC) of ONe white dwarfs as a theoretically predicted but observationally unconfirmed channel that may produce millisecond pulsars. A fourth channel — dynamical formation and recycling of neutron stars in globular clusters through exchange encounters and tidal captures — produces a substantial, environmentally distinct sub-population of millisecond pulsars. Natal kick velocities, measured via pulsar proper motions, and orbital eccentricities of double neutron star (DNS) systems provide powerful but under-exploited discriminants among these channels.

## 7. 方法论（Methods）

1. Catalog compilation: Assemble a unified pulsar catalogue with v_kick (from proper motions/parallaxes), orbital parameters (e, P_orb) for all known DNS and binary pulsars, spin/B, and environmental classification (field vs. GC). 2. Channel-specific forward models: Implement forward models for (v_kick, e, P_orb) incorporating common-envelope and second-SN physics; validate against population-synthesis mock catalogues. 3. Hierarchical Bayesian inference: Use nested sampling (MultiNest/dynesty) to infer mixing fractions and channel-specific parameters for the four-channel mixture and all nested sub-models (3-channel, 2-channel, field-only); compute Bayes factors. 4. Dedicated binary analysis: Fit the eccentricity distribution of the known DNS population with a mixture of low-e (EC-SN/AIC) and high-e (CCSN) components. 5. Cross-validation: Perform sensitivity tests on priors (especially f_AIC prior); cross-validate with independent MSP samples.

## 8. 实验设计（Experiments）

**Baselines**

- Single-channel CCSN model (standard assumption)
- Two-channel model (CCSN + ECSN) without AIC or GC
- Three-channel model (CCSN + ECSN + GC) without AIC
- Non-parametric kernel density estimate of pulsar property distributions

**Metrics**

- Bayesian evidence (log Z) for model comparison between 1-, 2-, 3-, and 4-channel models
- Posterior distributions on mixing fractions (f_CCSN, f_ECSN, f_AIC, f_GC) with credible intervals
- Bayes factor thresholds: B > 100 for decisive rejection, B > 30 for strong evidence
- Kolmogorov-Smirnov statistics comparing predicted vs observed eccentricity distributions for DNS systems
- 95% upper/lower bounds on f_AIC to determine if AIC is detected or falsified

**Design**

We perform model comparisons across the hierarchy of channel models. Experiment 1: Fit the full four-channel model (CCSN+ECSN+AIC+GC) to the complete pulsar catalogue. Experiment 2: Compare against three-channel models dropping each channel in turn (no AIC, no GC, no ECSN) using Bayes factors. Experiment 3: Test the two-channel model (CCSN+ECSN only) against the three-channel model without AIC. Experiment 4: Dedicated binary-pulsar eccentricity sub-analysis fitting the DNS eccentricity distribution with single vs. multi-component mixtures. Experiment 5: Field-only analysis excluding globular cluster pulsars to test whether the GC channel is required only for the cluster population.

## 9. 实验结果与可行性论证（Results）

If the four-channel model is favoured, the analysis will return posterior estimates of (f_CCSN, f_ECSN, f_AIC, f_GC) with credible intervals, channel-specific kick-velocity distributions, and eccentricity distributions for binary pulsars. A statistically significant f_AIC > 0 would constitute the first population-level evidence for AIC as a real astrophysical channel. If f_AIC is consistent with zero, the AIC channel is falsified at the population level. The dedicated binary analysis will either confirm a bimodal eccentricity distribution (supporting distinct low-kick channels) or a unimodal distribution (supporting a single low-kick channel). Explicit falsification criteria are defined: the four-channel model is rejected if B_{3ch/4ch} > 100 AND f_AIC < 0.01 (95% upper limit); AIC is 'detected' only if its 95% lower bound exceeds 0.005 AND B_{with/without AIC} > 30.

## 10. 参考论文（References）

| # | arXiv id | 标题 | 作者 | 年份 | 支撑的论点 |
| --- | --- | --- | --- | --- | --- |
| 1 | [1806.07267](https://arxiv.org/abs/1806.07267) | Neutron stars formation and Core Collapse Supernovae | Pablo Cerdá-Durán, Nancy Elias-Rosa | 2018 | Establishes the baseline CCSN channel whose rate, progenitor mass range, and kick distribution anchor the mixture model. |
| 2 | [2205.03989](https://arxiv.org/abs/2205.03989) | Wide binary pulsars from electron-capture supernovae | Simon Stevenson, Reinhold Willcox, Alejandro Vigna-Gómez et al. | 2022 | Directly links EC-SNe to observable orbital signatures (low eccentricity, wide orbits). |
| 3 | [0704.1215](https://arxiv.org/abs/0704.1215) | Double Neutron Stars: Evidence For Two Different Neutron-Star Formation Mechanisms | E. P. J. van den Heuvel | 2007 | Classic quantitative demonstration that orbital eccentricity in DNS systems discriminates between formation channels. |
| 4 | [1406.4128](https://arxiv.org/abs/1406.4128) | The Signature of Single-Degenerate Accretion Induced Collapse | Anthony L. Piro, Todd A. Thompson | 2014 | Authoritative statement that AIC is theoretically predicted but observationally unconfirmed. |
| 5 | [1901.00547](https://arxiv.org/abs/1901.00547) | Probing the Accretion Induced Collapse of White Dwarfs in Millisecond Pulsars | Ali Taani, Awni Khasawneh | 2019 | Supplies observable predictions (long P_orb, low e) for testing the AIC hypothesis. |
| 6 | [2002.01367](https://arxiv.org/abs/2002.01367) | The observed velocity distribution of young pulsars II: analysis of complete PSRπ | Andrei P. Igoshev | 2020 | Provides the empirical natal kick velocity distribution from proper motions. |
| 7 | [2412.08446](https://arxiv.org/abs/2412.08446) | Pulsar Kick: Status and Perspective | Gaetano Lambiase, Tanmay Kumar Poddar | 2024 | Recent review establishing natal kick velocity as a primary observable linked to formation channel. |
| 8 | [0711.3001](https://arxiv.org/abs/0711.3001) | Formation of Millisecond Pulsars in Globular Clusters | Natalia Ivanova, Craig O. Heinke, Frederic A. Rasio | 2007 | Establishes the dynamical formation channel in globular clusters as a physically distinct channel. |
| 9 | [2111.14084](https://arxiv.org/abs/2111.14084) | Advantages of Including Globular Cluster Millisecond Pulsars in Pulsar Timing Arrays | M. Maiorano, F. De Paolis, A. A. Nucita et al. | 2021 | Quantifies the observable distinctiveness of the GC dynamical channel. |
| 10 | [1904.12745](https://arxiv.org/abs/1904.12745) | Double Neutron Star Populations and Formation Channels | Jeff J. Andrews, Ilya Mandel | 2019 | Provides the expanded DNS sample for statistically meaningful eccentricity analysis. |
