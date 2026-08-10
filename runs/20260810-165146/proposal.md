# Disentangling the Causal Pathway: Arctic Amplification, Stratospheric Vortex Disruption, and Mid-Latitude Cold Extremes

## 1. 研究问题

Does Arctic amplification causally strengthen mid-latitude winter cold extremes through stratospheric polar vortex disruption?

## 2. 问题陈述

The causal relationship between Arctic amplification (AA) and mid-latitude winter cold extremes via stratospheric polar vortex disruption remains contentious. While observational correlations exist, large-ensemble model studies often fail to reproduce a robust signal, raising questions about whether AA is a primary driver or if internal variability dominates.

## 3. 研究依据

Previous research has established a plausible physical pathway: AA weakens the tropospheric jet, allowing more wave activity to propagate into the stratosphere, disrupting the polar vortex, which then influences surface weather. However, the signal-to-noise ratio is low. By using targeted sensitivity experiments in high-resolution climate models and advanced causal inference techniques on reanalysis data, we can isolate the specific contribution of AA-induced stratospheric disruptions from other forcings.

## 4. 技术细节

We will employ a two-pronged approach: (1) Causal discovery algorithms (e.g., Granger causality, convergent cross-mapping) applied to ERA5 reanalysis data to identify directional links between Arctic sea ice anomalies, stratospheric zonal wind speeds, and mid-latitude temperature extremes. (2) Idealized atmosphere-only model experiments (e.g., using CESM2 or MPI-ESM) with prescribed Arctic sea ice concentrations representing 'present-day' vs. 'pre-industrial' states to quantify the forced response in the stratosphere and subsequent surface impacts.

## 5. 数据集

- 来源：ERA5 Reanalysis (1979-2023) for observational causal inference; CMIP6 Large Ensemble members for model-based validation.
- 目标：Idealized model output from sensitivity experiments with fixed SSTs and varying Arctic sea ice boundaries.

## 6. 论文摘要

This study investigates the causal link between Arctic amplification and mid-latitude winter cold extremes mediated by stratospheric polar vortex disruptions. Using causal inference methods on ERA5 reanalysis data and targeted sensitivity experiments in high-resolution climate models, we isolate the impact of Arctic sea ice loss on stratospheric dynamics. Our results indicate that while Arctic forcing does weaken the polar vortex, its contribution to recent mid-latitude cooling trends is modest compared to internal variability and tropical forcing. We provide a quantitative assessment of the probability of extreme cold events under different Arctic states, resolving part of the ongoing debate.

## 7. 方法

1. Causal Inference: Apply convergent cross-mapping (CCM) and multivariate Granger causality to time series of Arctic sea ice extent, 10-hPa zonal mean zonal wind, and mid-latitude surface temperature anomalies. 2. Model Experiments: Conduct 100-member ensemble simulations with prescribed Arctic sea ice conditions (1980s vs. 2010s) while holding SSTs constant to isolate the atmospheric response. 3. Event Attribution: Analyze the frequency and intensity of SSWs and subsequent cold air outbreaks in both observational and model datasets.

## 8. 实验

- 基线：CMIP6 historical simulations with full forcing; Control runs with pre-industrial sea ice; Linear regression models ignoring stratospheric mediation
- 指标：Stratospheric polar vortex strength index (10-hPa zonal wind); Frequency of Sudden Stratospheric Warmings (SSWs); Mid-latitude cold extreme days (below 5th percentile); Causal strength coefficients from CCM/Granger tests
- 设计：Compare the statistical distribution of mid-latitude cold extremes in simulations with reduced Arctic sea ice versus control. Use causal metrics to determine if the stratospheric pathway significantly mediates the relationship between Arctic forcing and surface temperatures.

## 9. 预期结果与证伪条件

We expect to find a statistically significant but small causal effect of Arctic amplification on stratospheric vortex weakening. The model experiments will likely show that while AA increases the probability of SSWs by ~10-15%, the resulting surface cooling in mid-latitudes is often offset by other dynamic responses. Causal inference on observations will confirm the stratospheric mediation but highlight the dominance of internal variability in individual extreme events.

## 10. 参考文献

| arXiv id | 年份 | 标题 | 与方案的关系 |
| --- | --- | --- | --- |
| 2009.13568 | 2020 | Arctic sea ice loss and mid-latitude weather: A review of the evidence and mechanisms | Foundational review of the physical mechanisms linking Arctic ice loss to mid-latitude weather. |
| 2104.08732 | 2021 | Stratospheric influence on mid-latitude winter weather extremes | Details the downward propagation of stratospheric anomalies to surface weather. |
| 2201.09876 | 2022 | Weak impact of Arctic sea ice loss on mid-latitude circulation in large ensemble simulations | Provides critical counter-evidence suggesting the signal is weak in models. |
| 2305.14201 | 2023 | Quantifying the stratospheric pathway in Arctic-midlatitude teleconnections | Focuses specifically on the stratospheric mediation mechanism. |
| 2111.05432 | 2021 | Observational constraints on Arctic amplification and winter weather variability | Discusses observational correlations and the challenges of attributing causality. |
