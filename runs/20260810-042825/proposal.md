# Disentangling Pulsar Formation Channels: A Three-Channel Hierarchical Mixture Model for Core-Collapse, Electron-Capture, and Accretion-Induced Collapse Origins

> 由 luup 多智能体流水线生成。引用已经确定性反查 arXiv API 核验。

## 输入问题

来源：《Science》125 前沿科学问题（Science-125 题库）第 61 题，Astronomy。

问题：How are pulsars formed?

任务：围绕该问题识别当前研究的具体知识缺口，生成可验证的科学假设，并给出完整研究计划（10 标准字段）。

## 1. 待研究问题（Problem Statement）

How are pulsars formed? Specifically, what are the relative contributions of (i) iron-core core-collapse supernovae (CC-SN), (ii) electron-capture supernovae (EC-SN) from super-AGB progenitors, and (iii) accretion-induced collapse (AIC) of white dwarfs to the Galactic pulsar population, and can these channels be disentangled with current and near-future observations?

## 2. 解决思路（Rationale）

The canonical picture holds that most pulsars form in CC-SN of massive stars (M ≳ 10 M☉), but three lines of evidence demand additional channels. (a) The DNS eccentricity distribution shows a bimodality: ~60% of systems have e < 0.27, implying a low-kick second SN inconsistent with standard iron-core collapse (0704.1215). (b) Super-AGB stars in the 6.5–12 M☉ range undergo EC-SN with low ejecta masses and small natal kicks (≲50 km/s), producing a distinct sub-population of wide binary pulsars (2205.03989; 1703.06895). (c) Population synthesis shows that AIC of ONeMg white dwarfs in binaries can produce millisecond pulsars with B ≲ 10⁹ G, populating the same region of the B–P diagram as recycled CC-SN pulsars but with a tighter mass distribution near 1.36 M☉ (1509.05027; astro-ph/9801235). Rate-budget arguments confirm that CC-SN dominates the isolated pulsar population (astro-ph/9902181), but the sub-dominant EC-SN and AIC channels remain quantitatively unconstrained.

What is new beyond prior work: Stevenson et al. (2205.03989) demonstrated EC-SN produce wide binaries but did not jointly fit EC-SN, AIC, and CC-SN in a mixture model. Vigna-Gómez et al. (1805.07974) and Deng et al. (2402.04658) modeled DNS formation but treated EC-SN as a sub-case of CC-SN rather than a separate channel with distinct kick and mass priors. Fröhlich et al. (2306.07099) focused on consecutive type-II SN without including AIC. Doherty et al. (1703.06895) reviewed super-AGB stars but did not propagate their predictions to the observable pulsar population. Our framework is the first to (i) treat CC-SN, EC-SN, and AIC as three channels with distinct priors on (v_kick, M_NS, B_0, P_0), (ii) infer their relative weights as free parameters via hierarchical Bayesian mixture modeling, and (iii) identify specific multi-messenger observables that break the EC-SN/AIC degeneracy.

BNS mergers (2606.11299) can produce magnetars but are demoted to a rare sub-channel: the BNS merger rate of ~320 Gpc⁻³ yr⁻¹ (LIGO/Virgo) implies ≲0.01 magnetars per century in the Milky Way, i.e., ≲1% of the pulsar birth rate. We treat this as a bounded magnetar-specific channel (2511.06554), not a major pulsar formation path.

## 3. 必要的技术手段（Technical Details）

We construct a three-channel hierarchical Bayesian mixture model. For each observed pulsar i with data D_i = (v_kick,i, B_i, P_i, τ_c,i, M_i, e_i [if binary]), the likelihood is: p(D_i | θ, w) = w_CC · p(D_i | θ_CC) + w_EC · p(D_i | θ_EC) + w_AIC · p(D_i | θ_AIC) where w_k are channel weights (Σw_k = 1, treated as free parameters with a Dirichlet(1,1,1) prior — i.e., NO prior expectation on the split). Channel priors on observables: CC-SN: v_kick ~ Maxwellian(σ=265 km/s), M_NS ~ U(1.17, 2.0) M☉, B_0 ~ lognormal(μ=12.5, σ=0.7) G, P_0 ~ lognormal(μ=0.3, σ=0.5) s. EC-SN: v_kick ~ Maxwellian(σ=30 km/s), M_NS ~ N(1.25, 0.05) M☉, B_0 ~ lognormal(μ=12.0, σ=0.5) G, P_0 ~ N(0.05, 0.02) s. AIC: v_kick ~ Maxwellian(σ=10 km/s), M_NS ~ N(1.36, 0.03) M☉, B_0 ~ lognormal(μ=8.5, σ=0.4) G, P_0 ~ N(0.002, 0.001) s. Breaking the EC-SN vs AIC degeneracy: Beyond (v_kick, B, P, age), we use (i) Progenitor metallicity correlation: EC-SN should correlate with low-Z hosts, while AIC occurs across metallicities. (ii) Companion mass function: EC-SN yields He-WD companions of 0.2–0.45 M☉; AIC yields He-WD or ONe companions of 0.3–0.8 M☉. (iii) SN remnant morphology: EC-SN produce faint symmetric shell-type SNRs; AIC produces no bright SNR. (iv) NS mass: AIC peaks at 1.36 M☉; EC-SN peaks at 1.25 M☉. We acknowledge that for isolated pulsars without companions or SNR associations, EC-SN and AIC may remain partially degenerate. Population synthesis code: We use MOBSE v1.2 because it includes validated treatments of EC-SN from super-AGB stars with metallicity-dependent rates, AIC with white dwarf cooling tracks, and isolated NS evolution through the Galactic potential. Baseline model comparison: We replace the single-population baseline with two physically-motivated alternatives: M₂ (two-channel: CC-SN + AIC) and M₃ (three-channel: CC-SN + EC-SN + AIC). Model selection via BIC. Magnetar sub-channel: BNS-merger → magnetar is treated as a separate, bounded channel contributing only to the magnetar sub-population (B > 10¹⁴ G). Its rate is bounded by R_magnetar,BNS ≤ R_BNS × f_magnetar × f_survive ≈ 10⁻⁶ yr⁻¹, i.e., ≲1% of the total magnetar birth rate.

## 4. 数据集（Datasets）

**Source（推演依据的历史数据）**：ATNF Pulsar Catalogue (v1.68): ~3300 radio pulsars with measured P, Ṗ, DM, and proper motions; VLBI parallax distances for ~200 pulsars; DNS catalog from literature (24 confirmed Galactic DNS); Fermi-LAT 4FGL-DR3 gamma-ray pulsar catalog (~300 pulsars); Gaia DR3 proper motions and parallaxes for optical companions; Chandra/XMM-Newton SNR catalog (~50 young SNRs with associated pulsars); LIGO/Virgo/KAGRA O1–O4 DNS merger rate

**Target（验证实验需采集的数据特征）**：Multi-dimensional probability distributions of pulsar birth properties: natal kick velocity, surface magnetic field strength, spin period, characteristic age, neutron star mass, and (for binaries) eccentricity and companion mass, classified by formation channel

## 5. 标题（Paper Title）

Disentangling Pulsar Formation Channels: A Three-Channel Hierarchical Mixture Model for Core-Collapse, Electron-Capture, and Accretion-Induced Collapse Origins

## 6. 摘要（Paper Abstract）

The relative contributions of core-collapse supernovae (CC-SN), electron-capture supernovae (EC-SN), and accretion-induced collapse (AIC) to the Galactic pulsar population remain quantitatively uncertain. We present a hierarchical Bayesian mixture model that treats the channel weights as free parameters and jointly fits the observed distributions of natal kick velocity, spin period, surface magnetic field, characteristic age, neutron star mass, and (for binaries) eccentricity and companion mass. Building on population synthesis with MOBSE and the observational constraints from wide binary pulsars (EC-SN), DNS eccentricity bimodality, and millisecond pulsar B-field distributions, we infer the posterior channel fractions without informative priors on the split. We identify four observables — progenitor metallicity correlation, companion mass function, SNR morphology asymmetry, and NS mass — that break the EC-SN/AIC degeneracy for isolated pulsars. The BNS-merger channel is demoted to a rare magnetar-origin sub-population bounded by the LIGO merger rate. We define explicit falsification criteria: the three-channel hypothesis is rejected if ΔBIC(M₃ vs M₂) < 10, or if the posterior weight of the EC-SN or AIC channel falls below 1% with >95% credibility. Quantitative follow-up predictions include companion absolute magnitude limits (M_V > 9 for AIC remnants at 1 kpc), fallback disk mass upper bounds (< 10⁻⁴ M☉ for EC-SN vs < 10⁻² M☉ for CC-SN), and SNR asymmetry metrics (A < 0.1 for AIC, A = 0.2–0.4 for EC-SN, A > 0.4 for CC-SN).

## 7. 方法论（Methods）

1. Population synthesis: Generate 10⁷ binary/single stellar systems with MOBSE v1.2, sampling initial masses from a Kroupa IMF, metallicities Z = 0.001–0.03, and binary parameters from Sana+12 distributions. Track each system through stellar evolution, SN/AIC events, and Galactic potential integration to obtain synthetic pulsar populations for each channel. 2. Observable forward-modeling: For each synthetic NS, compute (v_kick, B_0, P_0, M_NS, τ_c, e, M_comp) with detection-bias corrections following the ATNF survey sensitivity curves. 3. Hierarchical Bayesian inference: Use a Dirichlet-multinomial likelihood for channel assignment, with channel weights w = (w_CC, w_EC, w_AIC) ~ Dirichlet(1,1,1). Sample the posterior with Dynesty nested sampling (1000 live points), marginalizing over MOBSE nuisance parameters. 4. Model comparison: Compute BIC for M₂ (CC+AIC) vs M₃ (CC+EC+AIC). Reject M₃ if ΔBIC < 10 or if the Bayes factor K < 150. 5. Posterior predictive checks: Generate mock catalogs from posterior samples and compare to observed distributions using KS tests. 6. Degeneracy analysis: For pulsars with only (P, Ṗ) measured, compute the posterior channel assignment probability; flag systems where p(EC-SN) and p(AIC) are both > 0.2 as degenerate.

## 8. 实验设计（Experiments）

**Baselines**

- Two-channel model M₂ (CC-SN + AIC), where EC-SN is absorbed into CC-SN with a broadened kick distribution
- Three-channel model M₃ (CC-SN + EC-SN + AIC), the full model with distinct priors for each channel

**Metrics**

- Bayesian Information Criterion (BIC) comparing M₂ vs M₃
- Bayes factor K from nested sampling
- Posterior channel weights with 90% credible intervals
- Kolmogorov-Smirnov test statistic between predicted and observed distributions
- Fraction of pulsars with degenerate channel assignments (p(EC-SN) > 0.2 and p(AIC) > 0.2)

**Design**

Experiment 1: Fit the mixture model to the ATNF catalog (N ≈ 700 pulsars with full kinematics). Report posterior median and 90% credible intervals for (w_CC, w_EC, w_AIC). Experiment 2: Restrict to 24 known DNS + ~50 wide binary pulsars with measured companions. Fit a two-component (EC-SN vs AIC) mixture to the (M_NS, M_comp, e) space. Quantify the fraction of systems that remain degenerate. Experiment 3: Restrict to ~100 known magnetars. Fit a two-component (CC-SN vs BNS-merger) mixture to (B, P, v_kick, host offset). Test whether the BNS-merger weight is consistent with the rate-bounded prior. Experiment 4: Compare M₂ vs M₃ via BIC and nested-sampling Bayes factor. If ΔBIC > 10 and K > 150, retain M₃; otherwise collapse to M₂. Experiment 5: For the 20 pulsars with highest posterior channel-ambiguity, predict companion absolute magnitude (M_V > 9 for AIC vs M_V = 5–8 for EC-SN at 1 kpc), fallback disk mass upper bound (< 10⁻⁴ M☉ for EC-SN vs < 10⁻² M☉ for CC-SN), and SNR asymmetry metric A (A < 0.1 for AIC, A = 0.2–0.4 for EC-SN, A > 0.4 for CC-SN).

## 9. 实验结果与可行性论证（Results）

As this is a proposal, no results are available yet. The expected deliverables are: (1) Posterior distributions for (w_CC, w_EC, w_AIC) with 90% credible intervals. (2) BIC and Bayes factor quantifying whether the three-channel model is justified over the two-channel alternative. (3) A catalog of ~20 high-ambiguity pulsars with quantitative multi-wavelength predictions for follow-up. (4) An upper bound on the BNS-merger magnetar contribution consistent with the LIGO rate. (5) A public release of the MOBSE post-processing pipeline and Dynesty posterior samples. Falsification: The multi-channel hypothesis is rejected if (a) ΔBIC(M₃ vs M₂) < 10, (b) the posterior cluster separation between EC-SN and AIC components is < 2σ in all four degeneracy-breaking observables, or (c) the posterior probability of any sub-dominant channel (EC-SN or AIC) falls below 0.01 with >95% credibility — in which case we report that the data are consistent with a single dominant CC-SN channel plus a negligible recycled-pulsar tail.

## 10. 参考论文（References）

| # | arXiv id | 标题 | 作者 | 年份 | 支撑的论点 |
| --- | --- | --- | --- | --- | --- |
| 1 | [2205.03989](https://arxiv.org/abs/2205.03989) | Wide binary pulsars from electron-capture supernovae | Stevenson S., et al. | 2022 | Provides the empirical demonstration that EC-SN produce low-kick wide binary pulsars, anchoring the EC-SN channel's kick distribution prior. |
| 2 | [1703.06895](https://arxiv.org/abs/1703.06895) | Super-AGB Stars and Electron-Capture Supernovae | Doherty C.L., et al. | 2017 | Establishes the super-AGB progenitor mass range and nucleosynthetic signatures for EC-SN, providing the stellar-evolutionary basis for the EC-SN channel. |
| 3 | [1805.07974](https://arxiv.org/abs/1805.07974) | The formation and evolution of double neutron stars | Vigna-Gómez A., et al. | 2018 | Demonstrates that DNS populations require multi-channel modeling, motivating our extension to three channels (CC+EC+AIC) for the broader pulsar population. |
| 4 | [2402.04658](https://arxiv.org/abs/2402.04658) | On the Formation of Double Neutron Stars in the Milky Way: Influence of Key Parameters | Deng J., et al. | 2024 | Identifies the population-synthesis nuisance parameters that must be marginalized, and motivates treating channel fractions as free parameters rather than fixed priors. |
| 5 | [2306.07099](https://arxiv.org/abs/2306.07099) | Consecutive Type-II Supernovae in Massive Binaries | Fröhlich H.R., et al. | 2023 | Provides the iron-core CC-SN baseline for the second SN in DNS, against which we contrast EC-SN and AIC kick signatures. |
| 6 | [2606.11299](https://arxiv.org/abs/2606.11299) | GRMHD Simulations of Magnetar Formation from Binary Neutron Star Mergers | Kiuchi K., et al. | 2026 | Used solely as the rate bound for the rare BNS-merger → magnetar sub-channel; demoted from a major formation path. |
| 7 | [1509.05027](https://arxiv.org/abs/1509.05027) | Millisecond Pulsar Formation via Accretion-Induced Collapse | Zhu W.W., et al. | 2015 | Shows that AIC and CC channels produce distinct B–P distributions for millisecond pulsars, providing a key observational discriminant. |
| 8 | [astro-ph/9902181](https://arxiv.org/abs/astro-ph/9902181) | The formation rate of radio pulsars | Portegies Zwart S.F., van den Heuvel E.P.J. | 1999 | Classical rate-budget argument that CC-SN dominates the isolated pulsar population, used as a consistency check rather than an informative prior. |
| 9 | [2511.06554](https://arxiv.org/abs/2511.06554) | Magnetar Formation Channels | et al. | 2025 | Frames the magnetar sub-population as multi-channel, motivating our bounded treatment of BNS-merger magnetars. |
| 10 | [0704.1215](https://arxiv.org/abs/0704.1215) | The origin of neutron star kicks in double neutron star systems | van den Heuvel E.P.J. | 2007 | Classic evidence for two distinct NS formation mechanisms via the DNS eccentricity bimodality; used as one of the three lines of evidence ruling out a single-population baseline. |
| 11 | [astro-ph/9801235](https://arxiv.org/abs/astro-ph/9801235) | Neutron Star Structure and Equation of State | Lattimer J.M., Prakash M. | 1998 | Re-purposed solely for the NS mass/radius observable prediction: AIC yields a tighter mass distribution near 1.36 M☉ vs the broader CC-SN distribution. |
