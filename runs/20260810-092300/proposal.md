# Probabilistic Kinematic Signatures of Electron-Capture Supernovae in Young Neutron-Star Populations with Selection Bias Correction

## 1. 研究问题

What observable signature could distinguish electron-capture supernovae from iron core-collapse supernovae in young neutron-star populations?

## 2. 问题陈述

Distinguishing electron-capture supernovae (ECSNe) from iron core-collapse supernovae (CCSNe) in young neutron-star populations requires accounting for overlapping kick velocity distributions and observational selection biases. A rigid velocity cutoff is insufficient; instead, we need a probabilistic framework that accommodates the full range of ECS kicks, including outliers like the Crab pulsar, while quantifying how detection limits skew observed velocity distributions.

## 3. 研究依据

ECSNe originate from super asymptotic giant branch stars (8-10 solar masses) with degenerate O-Ne-Mg cores. The gravitational tug-boat mechanism dictates that natal kicks scale with asymmetric mass ejection; ECSNe typically have lower ejecta masses and reduced asymmetries, producing lower average kicks. However, hydrodynamical simulations show that ECS kicks follow a broad distribution with significant overlap with low-kick CCSNe, rather than exhibiting a sharp cutoff. The Crab pulsar, potentially an ECSN remnant, demonstrates that some ECS events can produce moderate kicks (~150 km/s). Selection biases in proper motion surveys further complicate identification, as low-velocity pulsars may be underrepresented due to detection limits favoring high-transverse-velocity objects. A probabilistic mixture model, combined with careful bias correction, provides a robust statistical signature for distinguishing ECS contributions.

## 4. 技术细节

We will analyze the transverse velocity distribution of young radio pulsars (< 10 Myr) using a Bayesian hierarchical mixture model that allows for overlapping kick distributions between ECS and CCS channels. Rather than imposing a rigid <50 km/s cutoff, we model ECS kicks as a Maxwellian distribution with scale parameter σ_ECS ≈ 30-80 km/s and CCS kicks as σ_CCS ≈ 200-300 km/s, with mixing fraction f_ECS treated as a free parameter. We explicitly account for selection biases by modeling the detection probability as a function of transverse velocity, incorporating Gaia magnitude limits and VLBI sensitivity thresholds. The Crab pulsar is included as a known outlier to test model flexibility.

## 5. 数据集

- 来源：ATNF Pulsar Catalogue and Gaia DR3 astrometric data for young pulsars with characteristic ages < 10 Myr, supplemented by VLBI proper motions where available
- 目标：Bias-corrected natal kick velocity distribution decomposed into ECS and CCS components using probabilistic mixture modeling

## 6. 论文摘要

We propose a probabilistic framework for distinguishing electron-capture supernovae (ECSNe) from iron core-collapse supernovae (CCSNe) in young neutron-star populations, addressing limitations of rigid velocity cutoffs. Leveraging the gravitational tug-boat mechanism, we model ECS kicks as a broad Maxwellian distribution (σ ≈ 30-80 km/s) that overlaps with low-kick CCSNe, accommodating outliers such as the Crab pulsar. By analyzing proper motions of young pulsars (< 10 Myr) from Gaia and VLBI, we implement a Bayesian hierarchical mixture model that simultaneously infers kick distribution parameters and corrects for selection biases arising from detection limits. Our approach quantifies the ECS fraction while accounting for observational incompleteness at low transverse velocities, providing a statistically robust method to isolate these rare events in Galactic surveys.

## 7. 方法

1. Select a sample of young radio pulsars (characteristic age < 10 Myr) with precise proper motion measurements from Gaia DR3 and VLBI, including known outliers like the Crab pulsar. 2. Model selection biases by computing detection probabilities as functions of transverse velocity, accounting for Gaia magnitude limits (G < 20.7) and VLBI flux density thresholds. 3. Implement a Bayesian hierarchical mixture model with two Maxwellian kick components (ECS and CCS) and a free mixing fraction, allowing for distribution overlap. 4. Use Markov Chain Monte Carlo sampling to infer posterior distributions for σ_ECS, σ_CCS, and f_ECS, marginalizing over distance and age uncertainties. 5. Validate the model by testing whether it can recover known ECS candidates (e.g., Crab pulsar) within the inferred ECS distribution tail.

## 8. 实验

- 基线：Single-component Maxwellian kick distribution (standard CCSN model without ECS channel); Bimodal kick distribution with rigid <50 km/s ECS cutoff (previous approach); Bimodal distribution without selection bias correction
- 指标：Bayesian evidence ratio for bimodal vs unimodal models; Posterior distribution of ECS mixing fraction f_ECS; Goodness-of-fit via posterior predictive checks on velocity distribution; Recovery rate of known ECS candidates (e.g., Crab pulsar) within credible intervals
- 设计：Statistical analysis of the transverse velocity distribution of young pulsars with explicit bias correction. We compare three models: (1) single-component CCS-only, (2) bimodal with rigid cutoff, and (3) bimodal with overlapping distributions and bias correction. Support for the hypothesis requires that model (3) provides significantly better Bayesian evidence than alternatives, recovers the Crab pulsar within the ECS component's credible interval, and yields an ECS fraction consistent with stellar evolution predictions (10-20%). Failure to detect a distinct low-kick component after bias correction would challenge the standard ECS kick models or suggest that ECSNe are rarer than predicted.

## 9. 预期结果与证伪条件

We expect the probabilistic mixture model with bias correction to reveal a low-kick component comprising 10-20% of young pulsars, with σ_ECS ≈ 50 km/s and significant overlap with the low-velocity tail of the CCS distribution. The Crab pulsar should fall within the upper tail of the ECS distribution, demonstrating that ECS kicks are not universally low but follow a broad distribution. Selection bias correction will increase the inferred ECS fraction by 20-30% compared to naive analyses, as low-velocity pulsars are systematically underdetected. If the bimodal model does not significantly outperform the single-component model after accounting for biases, this would suggest either that ECS kicks are indistinguishable from low-kick CCSNe or that the ECS channel is less common than current stellar evolution models predict.

## 10. 参考文献

| arXiv id | 年份 | 标题 | 与方案的关系 |
| --- | --- | --- | --- |
| 1802.05274 | 2018 | Hydrodynamical Neutron-star Kicks in Electron-capture Supernovae and Implications for the CRAB Supernova | Demonstrates that ECS kicks follow a distribution with variability, directly addressing the Crab pulsar as an ECS candidate with moderate kick velocity. |
| 2205.03989 | 2022 | Wide binary pulsars from electron-capture supernovae | Provides independent constraints on ECS kick distributions from wide binary survival rates, supporting probabilistic modeling approaches. |
| 2107.04251 | 2021 | Constraints on Weak Supernova Kicks from Observed Pulsar Velocities | Establishes observational evidence for weak natal kicks in pulsar populations, supporting the existence of a low-kick component distinct from typical CCSNe. |
| 1611.07562 | 2016 | Neutron star kicks by the gravitational tug-boat mechanism in asymmetric supernova explosions: progenitor and explosion dependence | Provides theoretical foundation for kick generation via asymmetric mass ejection, explaining why ECSNe typically produce lower but variable kicks. |
| 1710.04508 | 2017 | Emission line models for the lowest-mass core collapse supernovae. I: Case study of a 9 $M_\odot$ one-dimensional neutrino-driven explosion | Characterizes explosion properties of low-mass progenitors relevant to ECSNe, supporting the physical distinction between formation channels. |
