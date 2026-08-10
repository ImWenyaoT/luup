# Effective Renormalization-Group Description of SGD Implicit Bias in Overparameterized Networks

## 1. 研究问题

Can the implicit regularization of stochastic gradient descent in overparameterized neural networks be characterized exactly by renormalization-group methods from statistical physics?

## 2. 问题陈述

Can the implicit regularization of stochastic gradient descent (SGD) in overparameterized neural networks be effectively characterized by renormalization-group (RG) methods from statistical physics, and how does this effective field theory description differ from established Dynamical Mean-Field Theory (DMFT) approaches?

## 3. 研究依据

While SGD is known to induce implicit bias towards sparse solutions in overparameterized regimes [2112.11027], the precise mechanism remains debated. Statistical physics tools like DMFT [2006.06098] describe the average dynamics but may miss scale-dependent features of the loss landscape. RG methods, which systematically integrate out high-frequency fluctuations, offer a potential framework to characterize how SGD filters out complex, high-variance parameter modes in favor of robust, low-complexity solutions [2410.00396]. By treating the SGD trajectory as a stochastic field and applying Wilsonian RG, we can derive an effective action that describes the long-time behavior of the optimizer. This approach is not claimed to be exact but serves as an effective field theory that captures the universal features of implicit bias, distinguishing it from mean-field approximations by explicitly accounting for the scale-dependence of noise and curvature.

## 4. 技术细节

We model the parameter vector w of a two-layer quadratic network as a field in a high-dimensional space. The SGD update is approximated by a Langevin equation: dw/dt = -∇L(w) + η(t), where η(t) represents gradient noise. We define 'high-frequency parameter modes' as eigenvectors of the Hessian matrix corresponding to large eigenvalues (sharp directions in the loss landscape). Integrating out these modes via Wilsonian RG corresponds to averaging over fast, noisy fluctuations in sharp directions, leaving an effective dynamics for the slow, flat directions. This process generates an effective potential that penalizes complexity, mirroring the observed implicit bias towards sparsity. We contrast this with DMFT, which assumes a self-averaging property across all modes, whereas RG explicitly separates scales.

## 5. 数据集

- 来源：Synthetic data from teacher-student models with quadratic activations, varying the overparameterization ratio α = M/N.
- 目标：Empirical distribution of final weights and generalization error from SGD trajectories, compared against RG-predicted effective potentials.

## 6. 论文摘要

We propose an effective field theory description of stochastic gradient descent (SGD) in overparameterized neural networks using renormalization-group (RG) methods. Unlike Dynamical Mean-Field Theory (DMFT), which provides a global average of dynamics, our Wilsonian RG approach systematically integrates out high-frequency parameter modes—defined as sharp directions in the loss landscape—to derive an effective action for the remaining slow modes. Applied to two-layer quadratic networks, this framework predicts an implicit bias towards sparse solutions by showing how noise-driven fluctuations in sharp directions are suppressed. We validate this effective description by comparing RG-predicted weight distributions with empirical SGD results, demonstrating that RG captures scale-dependent features of implicit regularization that mean-field approximations miss.

## 7. 方法

1. Formulate SGD dynamics as a stochastic differential equation (SDE) in the parameter space of a quadratic network. 2. Define high-frequency modes via the spectral decomposition of the Hessian matrix. 3. Apply Wilsonian RG transformations to integrate out these high-frequency modes, deriving an effective action for the low-frequency subspace. 4. Analyze the fixed points of the RG flow to identify the resulting implicit bias (e.g., sparsity). 5. Compare the RG-derived effective potential with empirical SGD trajectories and DMFT predictions to highlight the unique contributions of the RG approach.

## 8. 实验

- 基线：Standard SGD; Dynamical Mean-Field Theory (DMFT) predictions; Gradient Descent (deterministic)
- 指标：Generalization error; Sparsity of final weights; KL-divergence between RG-predicted and empirical weight distributions; Accuracy of effective potential in predicting long-time dynamics
- 设计：We will train overparameterized quadratic networks on synthetic teacher-student data. For each configuration, we will compute the Hessian spectrum to identify high-frequency modes. We will then perform numerical RG steps to derive the effective action and predict the final weight distribution. These predictions will be compared against 100 independent SGD runs and DMFT analytical results. A successful characterization will show that RG predictions match empirical SGD better than DMFT in capturing the variance and sparsity patterns of the final solutions.

## 9. 预期结果与证伪条件

We expect the RG-based effective field theory to provide a more accurate description of implicit bias than DMFT, particularly in capturing the suppression of high-variance modes. The RG flow should reveal fixed points corresponding to sparse solutions, supporting the hypothesis that implicit regularization arises from the scale-dependent filtering of parameter space. If the RG predictions significantly deviate from empirical SGD, it would indicate that the Wilsonian coarse-graining assumption is insufficient for discrete, non-equilibrium optimization dynamics.

## 10. 参考文献

| arXiv id | 年份 | 标题 | 与方案的关系 |
| --- | --- | --- | --- |
| 2604.03068 | 2026 | Escape dynamics and implicit bias of one-pass SGD in overparameterized quadratic networks | Provides the statistical physics foundation for analyzing SGD bias in quadratic networks. |
| 2112.11027 | 2021 | More is Less: Inducing Sparsity via Overparameterization | Establishes the link between overparameterization and sparsity, the key phenomenon to be characterized. |
| 2410.00396 | 2024 | Renormalization Group Analysis of Deep Neural Networks | Demonstrates the application of RG to neural network structure, providing a basis for extending it to dynamics. |
| 2006.06098 | 2020 | A Modern Theory of Fat-Tailed Distributions in Deep Learning | Represents the DMFT approach, serving as a baseline for comparison with the proposed RG method. |
| 2504.12700 | 2025 | Information-Theoretic Coarse-Graining in Deep Learning | Offers an alternative coarse-graining perspective, helping to clarify the definition of mode integration in RG. |
| 2507.05164 | 2025 | A Dynamical Systems Perspective on the Analysis of Neural Networks | Supports the SDE modeling of SGD, a critical step in the proposed methodology. |
