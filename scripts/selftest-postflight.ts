import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finalizeRun } from "../lib/postflight.ts";

let failed = 0;
function check(label: string, pass: boolean): void {
  console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
  if (!pass) failed++;
}

function renderedRun(): string {
  const dir = mkdtempSync(join(tmpdir(), "luup-postflight-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "proposal.md"), "# proposal\n", "utf8");
  return dir;
}

{
  const dir = renderedRun();
  const result = await finalizeRun({
    runDir: dir,
    pipelineExitCode: 0,
    verify: async (runDir) => {
      writeFileSync(
        join(runDir, "verification-report.md"),
        "# 验收报告\n\n结果: ALL PASS\n",
        "utf8",
      );
      return 0;
    },
  });

  check("pipeline 成功后自动验收并成为 deliverable", result.deliverable && result.exitCode === 0);
  check(
    "通过报告真实落盘",
    readFileSync(join(dir, "verification-report.md"), "utf8").includes("结果: ALL PASS"),
  );
}

{
  const dir = renderedRun();
  const result = await finalizeRun({
    runDir: dir,
    pipelineExitCode: 0,
    verify: async () => {
      throw new Error("offline verifier unavailable");
    },
  });

  check("验收异常时不可交付且退出失败", !result.deliverable && result.exitCode === 1);
  check(
    "验收异常被诚实记录",
    readFileSync(join(dir, "verification-report.md"), "utf8").includes("offline verifier unavailable"),
  );
}

{
  const dir = renderedRun();
  const result = await finalizeRun({
    runDir: dir,
    pipelineExitCode: 0,
    verify: async () => 1,
  });

  check("验收返回失败时不可交付", !result.deliverable && result.exitCode === 1);
  check(
    "验收返回失败但漏写报告时由 driver 补记",
    readFileSync(join(dir, "verification-report.md"), "utf8").includes("FAILED"),
  );
}

process.exit(failed === 0 ? 0 : 1);
