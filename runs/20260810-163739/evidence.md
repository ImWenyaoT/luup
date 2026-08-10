# Evidence

## 2604.03068

- Claim: Stochastic Gradient Descent (SGD) in overparameterized networks exhibits implicit bias towards sparse or low-complexity solutions, which can be analyzed using statistical physics frameworks.
- Relevance: Directly analyzes the escape dynamics and implicit bias of one-pass SGD in overparameterized quadratic networks using statistical physics methods, providing a baseline for mapping optimization to physical systems.

## 2112.11027

- Claim: Overparameterization combined with gradient-based optimization induces sparsity, a phenomenon that requires distinguishing between architectural effects and optimization bias.
- Relevance: Demonstrates that overparameterization leads to sparse solutions via implicit regularization, establishing the target behavior that any RG characterization must explain.

## 2410.00396

- Claim: Renormalization Group (RG) methods can be applied to deep neural networks by coarse-graining neurons, offering a structural analogy to statistical physics, though distinct from optimization trajectory analysis.
- Relevance: Applies RG to DNNs by treating neurons as degrees of freedom, highlighting the existing use of RG in architecture analysis and the need to differentiate it from optimization-dynamics RG.

## 2006.06098

- Claim: Dynamical Mean-Field Theory (DMFT) provides a rigorous high-dimensional description of SGD dynamics, often serving as the standard statistical physics tool rather than exact RG flows.
- Relevance: Establishes DMFT as a primary framework for analyzing SGD in the high-dimensional limit, against which the proposed RG approach must be differentiated as an effective field theory.

## 2504.12700

- Claim: Information-theoretic coarse-graining offers an alternative perspective on how neural networks compress information, paralleling RG's integration of high-frequency modes but focusing on representation rather than parameter updates.
- Relevance: Provides a modern view of coarse-graining in deep learning, helping to define what 'integrating out modes' means in the context of implicit regularization.

## 2507.05164

- Claim: The mapping of SGD to continuous stochastic differential equations (SDEs) is a standard approximation that enables the application of physical tools like Fokker-Planck analysis.
- Relevance: Supports the technical step of modeling SGD as a dynamical system, which is a prerequisite for applying any field-theoretic or RG analysis to the optimization trajectory.
