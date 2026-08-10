import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./paths.ts";
import { readRunEvidence, reachedProposal, runOutcome, type RunPhase } from "./runOutcome.ts";

export type VerifyRun = (runDir: string) => Promise<number>;

export type PostflightResult = {
  exitCode: number;
  verificationExitCode: number | null;
  phase: RunPhase;
  deliverable: boolean;
};

/** 独立验收器的进程 adapter；判据实现仍只在 scripts/verify-proposal.ts。 */
export function verifyOffline(runDir: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(REPO_ROOT, "scripts", "verify-proposal.ts"), runDir], {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/**
 * 一次 run 的统一收尾闸门：pipeline 先产出 proposal，再自动执行独立验收。
 * CLI、web 与 batch 都通过 scripts/run.ts 进入这里，因此不会再出现只有 batch 验收的分叉。
 */
export async function finalizeRun(input: {
  runDir: string;
  pipelineExitCode: number;
  verify: VerifyRun;
}): Promise<PostflightResult> {
  const before = runOutcome(readRunEvidence(input.runDir));
  if (input.pipelineExitCode !== 0 || !reachedProposal(before)) {
    return {
      exitCode: 1,
      verificationExitCode: null,
      phase: before.phase,
      deliverable: false,
    };
  }

  const reportPath = join(input.runDir, "verification-report.md");
  const recordVerifierFailure = (detail: string) =>
    writeFileSync(
      reportPath,
      ["# 验收报告（确定性检查）", "", "结果: 1/1 FAILED", "", `- ${detail}`, ""].join("\n"),
      "utf8",
    );

  let verificationExitCode: number;
  try {
    verificationExitCode = await input.verify(input.runDir);
    if (verificationExitCode !== 0 && !existsSync(reportPath)) {
      recordVerifierFailure(`offline verifier 退出码 ${verificationExitCode}，且未生成验收报告。`);
    }
  } catch (error) {
    verificationExitCode = 1;
    recordVerifierFailure(
      `offline verifier 执行失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const after = runOutcome(readRunEvidence(input.runDir));
  const deliverable = verificationExitCode === 0 && after.deliverable;
  return {
    exitCode: deliverable ? 0 : 1,
    verificationExitCode,
    phase: after.phase,
    deliverable,
  };
}
