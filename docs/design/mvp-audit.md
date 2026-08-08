# MVP 终审报告

日期：2026-08-08。审计人：master（本会话）。判据版本：criteria.md（含 B4、G 面）。
结论：**MVP 达成**。全部判据通过或按披露条款记录。

## 逐项认证

### A 产物契约（科学价值 40）
| 判据 | 结论 | 证据 |
|---|---|---|
| A1–A10 schema | ✅ | 4 个成功 run 的 proposal.json 全过 ProposalSchema（Q61×2/Q54/Q125，verify-proposal.ts 亲跑） |
| 内容非空洞（judge） | ✅ | master 逐字段亲读 Q61（可证伪假设/实名基线/量级估算）、Q125（因果干预设计/信息论推导）；Q54 抽验 |

### B 引用真实性（一票否决项）
| 判据 | 结论 | 证据 |
|---|---|---|
| B1 refs ⊆ 本 run 实检 | ✅ | 4 run 全部（7/7/10/8 条） |
| B2 标题反查 | ✅ | 重合度全 1.00 |
| B3 ≥5 条 | ✅ | 最少 7 条 |
| B4 作者核验 | ✅ | 全部命中；负样本（冒烟 run 5/5 整组虚构作者）被拦截，真阳性对照 0 误报 |

防线纵深实证：模型在证据在手时仍会虚构作者（冒烟 run）→ 机制层四道防线全部必要。

### C 多智能体闭环（技术深度 30）
| 判据 | 结论 | 证据 |
|---|---|---|
| C1 认证循环 | ✅ | verdicts/ 全 run 落盘；语义打回 r1→r3 实证（eval#1）；fail-closed 拒收不合规 verdict 实证（多 run 的 *.rejected.json） |
| C2 ≥3 subagent DAG | ✅ | 4 declared subagents（eve info） |
| C3 显式 handoff | ✅ | evidence/hypotheses/critique.json 工件 + eve subagent 继承 nothing |
| C4 预算与终止 | ✅ | 熔断器实证（eval#1 proposal 3 连拒→停）；FAILED.md 诚实失败实证（含逐判据证据与可恢复路径） |
| C5 无 RAG | ✅ | 零 embedding/vector 依赖；文献层 = arXiv API + 文件式 memory/index |

### D 模型合规
| 判据 | 结论 | 证据 |
|---|---|---|
| D1 百炼 Qwen 凭证 | ✅ | usage.jsonl（`x_billing_type:"response_api"`，百炼官方计费字段）+ /responses URL 日志 |
| D2 responses API | ✅ | 同上；enable_thinking 兼容层实测两档（0 vs 748 reasoning tokens） |

### E 可复现性（应用潜力 30 之一）
| 判据 | 结论 | 证据 |
|---|---|---|
| E0 Science-125 题库 | ✅ | 官方 PDF（Wayback）抓取，125 条交叉核验 |
| E1 单命令 E2E | ✅ | `pnpm run:pipeline`（Q61 1170s exit 0） |
| E1b 批量+续跑 | ✅ | Q54+Q125 双 ALL PASS；skip 判据（meta+ALL PASS 双条件）dry-run 亲验；历史 run 已回填 meta |
| E2 typecheck | ✅ | `pnpm validate`（typecheck + eve info 0 errors） |
| E3 trace | ✅ | verdicts + usage.jsonl + invoke-result + 工件链 |
| eve evals | ✅ | smoke 2/2；full-run 6/6 gates（含 verify_references ok:true 谓词、离线验收器 exit 0 gate、judge 100%） |

### G 交付面（官网提交要求）
| 判据 | 结论 | 证据 |
|---|---|---|
| G1 测试 API | ✅ | /api/runs GET/POST、/api/runs/[id]、/api/science125（master 亲 curl；CSRF 防护 415/403 实测） |
| G2 前端 | ✅ | Next.js 16+Tailwind 4（零多余依赖）；仪表台/历史/详情 SSR；teal/mono/网格/reasoning-spine 落地；UI 零信任重放全 PASS。**后审计增强**：已迁移至 eve 官方 `withEve()` 单项目布局（`app/` 与 `agent/` 平级、`/eve/v1/*` 同源挂载，对照官方 nextjs.mdx 逐条验收通过，tarball 逐字节对拆确认零功能丢失） |
| G3 代表案例 | ✅ | 4 成功 run + 1 FAILED 负样本，前端可浏览 |
| G4 技术报告 | ✅ 骨架 | docs/report/outline.md（11 节 ≤20 页映射） |
| G5 全量 125 能力 | ✅ 能力 | 续跑 runner 就绪；全量生产跑为提交期预算动作（约 125×~20min 串行 + token 费用，待用户拍板） |

## 诚实披露（不隐瞒）

1. **eve 0.31.3 队列重投递竞态**：观测 3 次重投递，2 次自愈、1 次致命（RuntimeSessionOwnershipConflictError 终止会话）。框架内部问题；全量 125 跑时靠续跑 runner 兜底（失败题重跑即可）。
2. **master 首次 verdict 写入系统性被 schema 拒收**（每 run 约 1 次，fail-closed 正确拦截后重写成功）：效率债非正确性债。
3. **usage.jsonl 只在 run.ts 驱动路径生成**（eval 路径不设 LUUP_RUN_DIR）：提交凭证以 run.ts 路径 + 百炼控制台截图为准。
4. **单一事实源债务**：10 字段判据在 criteria.md / instructions / ProposalSchema 三处人工同步（模板研究已裁决：MVP 期以 criteria.md 为 canonical，提交期考虑生成式统一）。
5. **paperTitle 语言不一致**（Q61/eval#2 英文，Q54/Q125 中文）：契约未约束；提交前可在 W instructions 定一条语言规则。
6. **arXiv 覆盖偏物理/CS**：医学/生态类题目文献源单薄，技术报告已列扩展路径（PubMed/Crossref）。
7. **eval#1 的高价值失败**：master 幻觉字段表连拒正确产物至熔断——已用机制层修复（结构判定权收归 artifact_write），eval#2 行为证实（verdict 引用 `validatedAs: ProposalSchema`）。保留 runs/20260808-093646 作负样本证据。

## 关键运行记录

| run | 题 | 结果 |
|---|---|---|
| 20260808-062829 | Q61 脉冲星 | ALL PASS（首次 E2E） |
| 20260808-065103 | Q54 宇宙线 | ALL PASS（批量） |
| 20260808-071315 | Q125 AI 创造力 | ALL PASS（批量，跨学科） |
| 20260808-093646 | Q61 | FAILED（诚实失败负样本，master 幻觉已修复） |
| 20260808-100004 | Q61 | ALL PASS（eval#2，6/6 gates） |
