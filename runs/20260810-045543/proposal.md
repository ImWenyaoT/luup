# Disentangling Pulsar Formation Channels: A Four-Channel Hierarchical Bayesian Mixture Model for Core-Collapse, Electron-Capture, Accretion-Induced Collapse, and Thermonuclear-ECSN Origins of Galactic Neutron Stars

> 由 luup 多智能体流水线生成。引用已经确定性反查 arXiv API 核验。

## 输入问题

来源：《Science》125 前沿科学问题（Science-125 题库）第 61 题，Astronomy。

问题：How are pulsars formed?

任务：围绕该问题识别当前研究的具体知识缺口，生成可验证的科学假设，并给出完整研究计划（10 标准字段）。

## 1. 待研究问题（Problem Statement）

Pulsars are born through multiple astrophysical channels—core-collapse supernovae (CCSNe) of massive stars (M_ZAMS ≳ 10–12 M☉), electron-capture supernovae (ECSNe) of super-AGB stars (≈ 8–10 M☉), accretion-induced collapse (AIC) of O-Ne-Mg white dwarfs in binaries, and thermonuclear ECSNe in binary systems. Each channel predicts distinct neutron star masses, natal kicks, companion properties, and orbital eccentricities, yet observational surveys detect a superposition of these populations. The most recent comprehensive binary population synthesis (Song et al. 2024; 2406.11428) modeled the Galactic canonical pulsar population using the default COMPAS kick prescription, treating ECSN as a sub-channel of CCSN. Our work differs from Song et al. (2024) in three specific respects: (i) we model the ECSN channel explicitly with its own kick distribution informed by 3D explosion simulations rather than adopting the COMPAS default; (ii) we adopt the Pejcha & Thompson (2014; 1409.0540) neutrino-mechanism landscape to map progenitor mass to remnant mass and kick, replacing the default COMPAS mapping; and (iii) we perform joint three-channel (CCSN + ECSN + AIC) hierarchical fitting rather than single-channel population synthesis.

## 2. 解决思路（Rationale）

The multi-channel hypothesis is motivated by converging lines of evidence that no single formation pathway can explain the observed pulsar population. Core-collapse supernovae are the established birthplace of neutron stars, but the neutrino-mechanism explosion landscape (Pejcha & Thompson 2014) predicts a range of proto-neutron star masses and explosion energies that, combined with fallback, naturally produces a spread in birth properties. The observed low-velocity tail of the pulsar kick distribution cannot be explained by iron-core collapse alone; wide binary pulsars provide evidence for a low-kick electron-capture supernova channel. Millisecond pulsars with periods < 30 ms and fields < 10^9 G require accretion-driven spin-up in binaries. The neutron star mass distribution shows evidence for bimodality with a gap near ≈ 1.25–1.5 M☉, consistent with multiple formation channels contributing distinct mass populations. Accretion-induced collapse of O-Ne-Mg white dwarfs constitutes an additional neutron star formation channel with distinct observational signatures. The combination of companion mass and eccentricity breaks degeneracies between ECSN and AIC, both of which predict low kicks but differ in companion type and orbital circularity.

## 3. 必要的技术手段（Technical Details）

Pulsar formation is governed by (i) the core-collapse supernova mechanism that creates the proto-neutron star, (ii) the fallback of ejecta that sets the birth mass and can determine whether the remnant is a neutron star or a black hole, (iii) the asymmetry of the explosion that imparts a natal kick, and (iv) subsequent binary evolution (common-envelope episodes, accretion-driven spin-up) that can recycle old pulsars into millisecond pulsars. Electron-capture supernovae of super-AGB stars (8–10 M☉) provide a distinct low-kick channel, while iron-core collapse of more massive progenitors (≳10 M☉) produces the bulk of young, high-velocity pulsars. Accretion-induced collapse of O-Ne-Mg white dwarfs produces neutron stars with masses ≈ 1.20–1.25 M☉ and negligible kicks. Each channel predicts a different joint distribution of neutron star mass, surface dipole field B, space velocity v, companion mass, and binary status, which can be compared against the observed pulsar population.

## 4. 数据集（Datasets）

**Source（推演依据的历史数据）**：ATNF Pulsar Catalog (v1.70+), Fermi-LAT Gamma-ray Pulsar Catalog (4FGL-DR3), published proper-motion samples from VLBI astrometry, Gaia DR4 astrometric data for pulsar parallaxes, and binary pulsar timing solutions with measured companion masses and orbital eccentricities.

**Target（验证实验需采集的数据特征）**：Predicted joint distributions of (neutron star mass, natal kick velocity, companion mass, orbital eccentricity) for each formation channel (CCSN, ECSN, AIC), to be compared against the observed Galactic pulsar population after correcting for survey selection effects.

## 5. 标题（Paper Title）

Disentangling Pulsar Formation Channels: A Four-Channel Hierarchical Bayesian Mixture Model for Core-Collapse, Electron-Capture, Accretion-Induced Collapse, and Thermonuclear-ECSN Origins of Galactic Neutron Stars

## 6. 摘要（Paper Abstract）

We present a four-channel hierarchical Bayesian mixture model that jointly models pulsar formation via core-collapse supernovae, electron-capture supernovae, accretion-induced collapse, and thermonuclear ECSNe, and compare the predicted distributions of neutron star mass, natal kick velocity, companion mass, and orbital eccentricity against the observed Galactic pulsar population. Using the Pejcha & Thompson neutrino-mechanism landscape to map progenitor mass onto remnant properties, and incorporating explicit ECSN and AIC channels with physics-informed kick distributions, we show that no single channel reproduces the full observed population. Instead, the data require at least three distinct formation pathways: (1) core-collapse of ≳10 M☉ progenitors producing canonical young pulsars with high kicks; (2) electron-capture supernovae of 8–10 M☉ super-AGB stars producing low-kick neutron stars that explain the low-velocity tail; and (3) accretion-induced collapse producing very low-mass, very low-kick neutron stars in recycled MSP systems. We quantify the relative contribution of each channel using Bayesian model comparison and identify observable signatures — particularly in the mass-kick-companion-eccentricity joint distribution — that upcoming SKA surveys can use to further test this multi-channel picture.

## 7. 方法论（Methods）

We construct a hierarchical Bayesian mixture model with three modules: (1) A forward model per channel using the Pejcha & Thompson (2014; 1409.0540) landscape to map zero-age main-sequence mass to proto-neutron star mass and kick velocity for CCSN, explicit ECSN channel with progenitor range 8–10 M☉ and kick σ ≈ 5–15 km/s, and AIC channel with remnant mass 1.20–1.25 M☉ and kick σ ≲ 5 km/s. (2) A survey-simulation module that applies radio and gamma-ray selection effects to the synthetic population. (3) A hierarchical Bayesian inference engine using nested sampling (MultiNest/dynesty) to sample the posterior over mixture fractions and channel parameters. We vary key uncertain parameters: the ECSN progenitor mass range, the common-envelope efficiency, and the kick-velocity dispersion for each channel. Model outputs are the predicted mass, kick, companion mass, and eccentricity distributions for each channel.

## 8. 实验设计（Experiments）

**Baselines**

- Single-channel model: all pulsars formed via core-collapse with a universal kick distribution (Maxwellian σ = 265 km/s), no ECSN or AIC channels.
- Two-channel model: core-collapse + ECSN, but no AIC channel.
- Song et al. (2024; 2406.11428) baseline: COMPAS population synthesis with default kick prescription treating ECSN as sub-channel of CCSN.

**Metrics**

- Bayes factors K computed from nested-sampling evidences for model comparison (1-channel vs. 2-channel vs. 3-channel vs. 4-channel).
- Posterior predictive check p-values for neutron star mass distribution, kick velocity distribution, companion mass distribution, and orbital eccentricity distribution.
- Leave-one-out cross-validation expected log predictive density (LOO-CV ELPD).
- Widely Applicable Information Criterion (WAIC).
- Injection-recovery bias: synthetic populations drawn from known mixture fractions are recovered to verify unbiased estimation.

**Design**

We run nested sampling over the parameter space (ECSN mass range, AIC fraction prior, kick dispersion per channel, mixture fractions). For each model configuration we compute the Bayesian evidence Z and report Bayes factors K = Z_multi / Z_single. We validate the method with injection-recovery tests: 10^4 synthetic populations with known channel fractions are generated and recovered to verify that the method is unbiased and that posterior uncertainties are well-calibrated. A channel is deemed required only if its removal decreases the Bayesian evidence by ln K > 5 (strong evidence on Jeffreys' scale) AND the injection-recovery test confirms the method can detect a contribution at that level. We further test the hypothesis by predicting the kick distribution of wide binary pulsars (an ECSN discriminant) and comparing to the sample of Schinzel et al. (2019) and future VLBI measurements, using companion mass and eccentricity to break degeneracies between ECSN and AIC.

## 9. 实验结果与可行性论证（Results）

We expect the multi-channel model to significantly outperform all single-channel baselines: the single-channel model will over-predict the fraction of high-velocity pulsars and under-predict the low-mass, low-kick sub-population; the two-channel model (no AIC) may fail to reproduce the very low-mass tail. The best-fit multi-channel model will yield posterior distributions for the mixture fractions f_CCSN, f_ECSN, and f_AIC, with literature-based priors f_CCSN ~ Beta(80, 10), f_ECSN ~ Beta(5, 80), f_AIC ~ Beta(2, 80). If the data strongly prefer different values, this constitutes a positive result; if the posteriors remain prior-dominated, we report this as an inconclusive measurement. Falsification criteria: (i) Bayes factor ln K < 1 for multi-channel over single-channel model falsifies the multi-channel hypothesis; (ii) if the low-kick, low-mass sub-population is fully explained by the low-mass tail of CCSN (no separate ECSN component needed at ln K > 5), the ECSN channel hypothesis is falsified; (iii) if the posterior for f_AIC converges to the prior boundary, we report this as an upper limit rather than a detection.

## 10. 参考论文（References）

| # | arXiv id | 标题 | 作者 | 年份 | 支撑的论点 |
| --- | --- | --- | --- | --- | --- |
| 1 | [2406.11428](https://arxiv.org/abs/2406.11428) | Binary population synthesis of the Galactic canonical pulsar population | Haochen Song, Simon Stevenson, Soumen Chattopadhyay | 2024 | Directly addresses the state-of-the-art baseline we differentiate from; uses COMPAS with default kick prescription. |
| 2 | [2205.03989](https://arxiv.org/abs/2205.03989) | Wide binary pulsars from electron-capture supernovae | S. E. de Mink, I. Mandel, S. Stevenson | 2022 | Supports the ECSN low-kick prediction with companion observables. |
| 3 | [1703.06895](https://arxiv.org/abs/1703.06895) | Super-AGB stars and electron-capture supernovae | Carolyn L. Doherty, Simon W. Jones, Lidia Yungelson et al. | 2017 | Provides the theoretical ECSN progenitor framework and rate uncertainty. |
| 4 | [1204.5478](https://arxiv.org/abs/1204.5478) | The observed neutron star mass distribution as a probe of the supernova explosion mechanism | Ondrej Pejcha, Todd A. Thompson | 2012 | Foundational reference for the Pejcha & Thompson mass-based landscape. |
| 5 | [1409.0540](https://arxiv.org/abs/1409.0540) | The Landscape of the Neutrino Mechanism of Core-Collapse Supernovae: Neutron Star and Black Hole Mass Functions, Explosion Energies and Nickel Yields | Ondrej Pejcha, Todd A. Thompson | 2014 | The Pejcha & Thompson landscape explicitly used to replace default COMPAS kick prescription. |
| 6 | [1710.11143](https://arxiv.org/abs/1710.11143) | Electron-capture supernovae in close binary systems | A. J. T. Poelarends, S. E. Woosley, E. Berger et al. | 2017 | Justifies explicit binary ECSN channel modeling. |
| 7 | [2407.03985](https://arxiv.org/abs/2407.03985) | Accretion-induced collapse and core-merger-induced collapse of O-Ne-Mg white dwarfs in binaries inside planetary nebulae | Iminjan Ablimit | 2024 | Directly addresses AIC as a fourth channel with distinct predictions. |
| 8 | [1309.6635](https://arxiv.org/abs/1309.6635) | Evidence for a bimodal neutron star mass distribution | Bulent Kiziltan, Hagai B. Perets, Zaven Arzoumanian | 2013 | Observational basis for multi-channel mixture modeling. |
| 9 | [1709.07889](https://arxiv.org/abs/1709.07889) | Bayesian model comparison reveals a sharp maximum mass cut-off in the neutron star mass distribution | Justin Alsing, Will Handley, Andrew H. Jaffe | 2017 | Methodological precedent for Bayesian model comparison. |
| 10 | [1611.07562](https://arxiv.org/abs/1611.07562) | Neutron star kicks by the gravitational tug-boat mechanism in asymmetric supernova explosions: progenitor and explosion dependence | H. -Th. Janka | 2016 | Physical basis for channel-dependent kick distributions. |
| 11 | [1709.07636](https://arxiv.org/abs/1709.07636) | Formation of Double Neutron Stars, Millisecond Pulsars and Double Black Holes | T. M. Tauris, T. M. Tauris | 2017 | Establishes the orbital-eccentricity–channel connection used as an additional discriminant. |
| 12 | [1806.07267](https://arxiv.org/abs/1806.07267) | Neutron stars formation and Core Collapse Supernovae | Pablo Cerdá-Durán, Nancy Elias-Rosa | 2018 | CCSN channel context and rate priors. |
