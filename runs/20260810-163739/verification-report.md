# 验收报告（确定性检查）

结果: 6/16 FAILED

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| B3.count | ✅ PASS | references = 6（要求 ≥5） |
| B1.2604.03068 | ✅ PASS | 在本次运行 memory/papers/ 中 |
| B1.2112.11027 | ✅ PASS | 在本次运行 memory/papers/ 中 |
| B1.2410.00396 | ❌ FAIL | 未在本次运行实检命中（papers/ 共 6 篇）——必须先 arxiv_save |
| B1.2006.06098 | ❌ FAIL | 未在本次运行实检命中（papers/ 共 6 篇）——必须先 arxiv_save |
| B1.2504.12700 | ❌ FAIL | 未在本次运行实检命中（papers/ 共 6 篇）——必须先 arxiv_save |
| B1.2507.05164 | ✅ PASS | 在本次运行 memory/papers/ 中 |
| B4.2604.03068 | ✅ PASS | 作者与年份与本 run 落盘卡片一致，第一作者一致 |
| B4.2112.11027 | ✅ PASS | 作者与年份与本 run 落盘卡片一致，第一作者一致 |
| B4.2507.05164 | ✅ PASS | 作者与年份与本 run 落盘卡片一致，第一作者一致 |
| B2.2604.03068 | ✅ PASS | 标题重合度 1.00（阈值 0.8）｜产物「Escape dynamics and implicit bias of one-pass SGD in overparameterized quadratic networks」｜arXiv「Escape dynamics and implicit bias of one-pass SGD in overparameterized quadratic networks」 |
| B2.2112.11027 | ✅ PASS | 标题重合度 1.00（阈值 0.8）｜产物「More is Less: Inducing Sparsity via Overparameterization」｜arXiv「More is Less: Inducing Sparsity via Overparameterization」 |
| B2.2410.00396 | ❌ FAIL | 标题重合度 0.46（阈值 0.8）｜产物「Renormalization Group Analysis of Deep Neural Networks」｜arXiv「Dynamic neuron approach to deep neural networks: Decoupling neurons for renormalization group analysis」 |
| B2.2006.06098 | ❌ FAIL | 标题重合度 0.17（阈值 0.8）｜产物「A Modern Theory of Fat-Tailed Distributions in Deep Learning」｜arXiv「Dynamical mean-field theory for stochastic gradient descent in Gaussian mixture classification」 |
| B2.2504.12700 | ❌ FAIL | 标题重合度 0.25（阈值 0.8）｜产物「Information-Theoretic Coarse-Graining in Deep Learning」｜arXiv「A Two-Phase Perspective on Deep Learning Dynamics」 |
| B2.2507.05164 | ✅ PASS | 标题重合度 1.00（阈值 0.8）｜产物「A Dynamical Systems Perspective on the Analysis of Neural Networks」｜arXiv「A Dynamical Systems Perspective on the Analysis of Neural Networks」 |
