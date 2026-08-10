/**
 * E2E 的 fixture 就是仓里已提交的 `runs/`：只走读路径，绝不 POST /api/runs
 * （那会真的调 Qwen 并产生费用，CI 也没有密钥）。
 */

/** 完整走完 Scientist → Reviewer → Verify 且验收 ALL PASS 的 run。 */
export const PASSED_RUN_ID = "20260810-092300"

/** 该 run 的 proposal.md 首行标题，用来证明 tab 里是真工件而不是空壳。 */
export const PASSED_RUN_PAPER_TITLE =
  "Probabilistic Kinematic Signatures of Electron-Capture Supernovae"
