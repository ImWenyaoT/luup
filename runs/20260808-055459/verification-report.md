# 验收报告（确定性检查）

run: runs/20260808-055459
时间: 2026-08-08T06:27:55.097Z
结果: 5/17 FAILED

| 检查项 | 结果 | 说明 |
|--------|------|------|
| A.schema | ✅ | proposal.json 通过 10 字段契约 |
| B1.2009.04238 | ✅ | 在本次运行 memory/papers/ 中 |
| B1.2111.10704 | ✅ | 在本次运行 memory/papers/ 中 |
| B1.2409.14016 | ✅ | 在本次运行 memory/papers/ 中 |
| B1.2206.07197 | ✅ | 在本次运行 memory/papers/ 中 |
| B1.2509.09988 | ✅ | 在本次运行 memory/papers/ 中 |
| B3.count | ✅ | references = 5（要求 ≥5） |
| B2.2009.04238 | ✅ | 标题重合度 1.00｜本地「DeepSun: Machine-Learning-as-a-Service for Solar Flare Prediction」｜arXiv「DeepSun: Machine-Learning-as-a-Service for Solar Flare Prediction」 |
| B4.2009.04238 | ❌ | 虚构作者嫌疑：未命中姓氏 [nishizuka, kubo, denker]；第一作者不符（本地「H. Nishizuka」vs arXiv「Yasser Abduallah」） |
| B2.2111.10704 | ✅ | 标题重合度 1.00｜本地「Decreasing False Alarm Rates in ML-based Solar Flare Prediction using SDO/HMI Data」｜arXiv「Decreasing False Alarm Rates in ML-based Solar Flare Prediction using SDO/HMI Data」 |
| B4.2111.10704 | ❌ | 虚构作者嫌疑：未命中姓氏 [husainov, stepanov, grigoryev]；第一作者不符（本地「A. Husainov」vs arXiv「Varad Deshmukh」） |
| B2.2409.14016 | ✅ | 标题重合度 1.00｜本地「Enhancing Multivariate Time Series-based Solar Flare Prediction with Multifaceted Preprocessing and Contrastive Learning」｜arXiv「Enhancing Multivariate Time Series-based Solar Flare Prediction with Multifaceted Preprocessing and Contrastive Learning」 |
| B4.2409.14016 | ❌ | 虚构作者嫌疑：未命中姓氏 [lee, park, kim]；第一作者不符（本地「J. Lee」vs arXiv「MohammadReza EskandariNasab」） |
| B2.2206.07197 | ✅ | 标题重合度 1.00｜本地「Improving Solar Flare Prediction by Time Series Outlier Detection」｜arXiv「Improving Solar Flare Prediction by Time Series Outlier Detection」 |
| B4.2206.07197 | ❌ | 虚构作者嫌疑：未命中姓氏 [chen, wang, zhang]；第一作者不符（本地「R. Chen」vs arXiv「Junzhi Wen」） |
| B2.2509.09988 | ✅ | 标题重合度 1.00｜本地「FLARE-SSM: Deep State Space Models with Influence-Balanced Loss for 72-Hour Solar Flare Prediction」｜arXiv「FLARE-SSM: Deep State Space Models with Influence-Balanced Loss for 72-Hour Solar Flare Prediction」 |
| B4.2509.09988 | ❌ | 虚构作者嫌疑：未命中姓氏 [yamamoto, sato, tanaka]；第一作者不符（本地「T. Yamamoto」vs arXiv「Yusuke Takagi」） |
