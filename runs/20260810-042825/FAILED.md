# FAILED

verify_references 未通过，ok: false

## 失败项汇总

共 20 项失败：

### B2 标题重合度不足（9 项）
标题与 arXiv 实际返回的标题重合度 < 0.8：
- B2.1703.06895: 重合度 0.55 | 产物「Super-AGB Stars and Electron-Capture Supernovae」| arXiv「Super-AGB Stars and their role as Electron Capture Supernova progenitors」
- B2.1805.07974: 重合度 0.67 | 产物「The formation and evolution of double neutron stars」| arXiv「On the formation history of Galactic double neutron stars」
- B2.2306.07099: 重合度 0.30 | 产物「Consecutive Type-II Supernovae in Massive Binaries」| arXiv「Double neutron star formation via consecutive type II supernova explosions」
- B2.2606.11299: 重合度 0.50 | 产物「GRMHD Simulations of Magnetar Formation from Binary Neutron Star Mergers」| arXiv「A magnetar formation in binary neutron star merger」
- B2.1509.05027: 重合度 0.14 | 产物「Millisecond Pulsar Formation via Accretion-Induced Collapse」| arXiv「Population Synthesis of Millisecond X-ray Pulsars」
- B2.astro-ph/9902181: 重合度 0.67 | 产物「The formation rate of radio pulsars」| arXiv「The origin of single radio pulsars」
- B2.2511.06554: 重合度 0.50 | 产物「Magnetar Formation Channels」| arXiv「Formation Channels of Magnetars」
- B2.0704.1215: 重合度 0.30 | 产物「The origin of neutron star kicks in double neutron star systems」| arXiv「Double Neutron Stars: Evidence For Two Different Neutron-Star Formation Mechanisms」
- B2.astro-ph/9801235: 重合度 0.43 | 产物「Neutron Star Structure and Equation of State」| arXiv「Neutron Stars: Formation and Structure」

### B4 作者/年份不符（11 项）
作者或年份与 memory/papers/ 中的元数据不符：
- B4.2205.03989: 作者不符（产物「Stevenson S., et al.」，arXiv「Simon Stevenson, Reinhold Willcox, Alejandro Vigna-Gomez, Floor Broekgaarden」）
- B4.1703.06895: 作者不符（产物「Doherty C.L., et al.」，arXiv「Carolyn L. Doherty, Pilar Gil-Pons, Lionel Siess, John C. Lattanzio」）
- B4.1805.07974: 作者不符（产物「Vigna-Gómez A., et al.」，arXiv「Alejandro Vigna-Gómez, Coenraad J. Neijssel, Simon Stevenson, Jim W. Barrett, Krzysztof Belczynski, Stephen Justham, Selma E. de Mink, Bernhard Müller, Philipp Podsiadlowski, Mathieu Renzo, Dorottya Szécsi, Ilya Mandel」）
- B4.2402.04658: 作者不符（产物「Deng J., et al.」，arXiv「Zhu-Ling Deng, Xiang-Dong Li, Yong Shao, Kun Xu」）
- B4.2306.07099: 作者不符（产物「Fröhlich H.R., et al.」，arXiv「Viktória Fröhlich, Zsolt Regály, József Vinkó」）
- B4.2606.11299: 作者不符（产物「Kiuchi K., et al.」，arXiv「Kenta Kiuchi, Alexis Reboul-Salze, Yuichiro Sekiguchi, Masaru Shibata」）
- B4.1509.05027: 作者不符（产物「Zhu W.W., et al.」，arXiv「Chunhua Zhu, Guoliang Lu, Zhaojun Wang」）
- B4.astro-ph/9902181: 作者不符（产物「Portegies Zwart S.F., van den Heuvel E.P.J.」，arXiv「Simon Portegies Zwart, Edward van den Heuvel」）
- B4.2511.06554: 作者不符（产物「et al.」，arXiv「Rui-Chong Hu, Bing Zhang」）
- B4.0704.1215: 作者不符（产物「van den Heuvel E.P.J.」，arXiv「E. P. J. van den Heuvel」）
- B4.astro-ph/9801235: 作者不符（产物「Lattimer J.M., Prakash M.」，arXiv「Marek Kutschera」）

## 根本原因

proposal.json 中的参考文献标题和作者字段是凭记忆编造的，未从 memory/papers/ 中照抄 arXiv 返回的实际元数据。验证器要求：
- B2: 标题必须与 arXiv API 返回的标题有 >= 0.8 的 token 重合度
- B4: 作者和年份必须与 memory/papers/ 中的元数据完全一致

由于已用完 Scientist 的一次返修机会，无法再进行修正。

Run 目录：/home/ail510/tian_wenyao/projects/luup/runs/20260810-042825