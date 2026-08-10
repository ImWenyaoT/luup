# FAILED

verify_references 未通过，ok: false

## 失败项列表

### B2 标题重合度失败（阈值 ≥ 0.8）

1. **B2.1703.06895**: 标题重合度 0.55
   - 产物标题: "Super-AGB stars and electron-capture supernovae"
   - arXiv 标题: "Super-AGB Stars and their role as Electron Capture Supernova progenitors"

2. **B2.2407.03985**: 标题重合度 0.67
   - 产物标题: "Accretion-induced collapse and core-merger-induced collapse of O-Ne-Mg white dwarfs in binaries inside planetary nebulae"
   - arXiv 标题: "Formation of neutron stars via accretion-induced collapse and core-merger-induced collapse inside planetary nebulae from white dwarf binaries"

3. **B2.1309.6635**: 标题重合度 0.50
   - 产物标题: "Evidence for a bimodal neutron star mass distribution"
   - arXiv 标题: "The Neutron Star Mass Distribution"

4. **B2.1709.07889**: 标题重合度 0.56
   - 产物标题: "Bayesian model comparison reveals a sharp maximum mass cut-off in the neutron star mass distribution"
   - arXiv 标题: "Evidence for a maximum mass cut-off in the neutron star mass distribution and constraints on the equation of state"

### B4 作者/年份不符

5. **B4.2205.03989**: 作者不符
   - 产物作者: ["S. E. de Mink", "I. Mandel", "S. Stevenson"]
   - arXiv 作者: ["Simon Stevenson", "Reinhold Willcox", "Alejandro Vigna-Gomez", "Floor Broekgaarden"]
   - 第一作者不符

6. **B4.1703.06895**: 作者不符
   - 产物作者: ["Carolyn L. Doherty", "Simon W. Jones", "Lidia Yungelson", "John C. Lattanzio"]
   - arXiv 作者: ["Carolyn L. Doherty", "Pilar Gil-Pons", "Lionel Siess", "John C. Lattanzio"]

7. **B4.1710.11143**: 作者不符
   - 产物作者: ["A. J. T. Poelarends", "S. E. Woosley", "E. Berger", "A. Heger"]
   - arXiv 作者: ["Arend J. T. Poelarends", "Scott Wurtz", "James Tarka", "Cole Adams", "Spencer T. Hills"]

8. **B4.1309.6635**: 作者不符
   - 产物作者: ["Bulent Kiziltan", "Hagai B. Perets", "Zaven Arzoumanian"]
   - arXiv 作者: ["Bulent Kiziltan", "Athanasios Kottas", "Maria De Yoreo", "Stephen E. Thorsett"]

9. **B4.1709.07889**: 作者不符
   - 产物作者: ["Justin Alsing", "Will Handley", "Andrew H. Jaffe"]
   - arXiv 作者: ["Justin Alsing", "Hector O. Silva", "Emanuele Berti"]

10. **B4.1709.07636**: 作者不符
    - 产物作者: ["T. M. Tauris", "T. M. Tauris"]
    - arXiv 作者: ["Edward P. J. van den Heuvel"]
    - 第一作者不符

## 总结

共 10 项失败：
- B2 标题重合度失败: 4 项 (1703.06895, 2407.03985, 1309.6635, 1709.07889)
- B4 作者/年份不符: 6 项 (2205.03989, 1703.06895, 1710.11143, 1309.6635, 1709.07889, 1709.07636)

原因：proposal 中的引用元数据（标题、作者）与 arXiv 实际返回的不一致，属于凭记忆编造而非照抄 memory/papers/ 中的元数据。

Run 目录: /home/ail510/tian_wenyao/projects/luup/runs/20260810-045543