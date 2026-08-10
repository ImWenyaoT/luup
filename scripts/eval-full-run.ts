/**
 * Goal-driven 全链路 eval（criteria 的机器化版本；**花真钱**，一次完整流水线 ≈20 分钟）：
 * 真跑一次 L→H→C→W→master 认证，落盘工件后——
 *
 *  gate：run exit 0、proposal.json 过 10 字段契约、离线验收器（B1–B4 引用逐条
 *        反查 arXiv）exit 0
 *  soft：run 目录是从 run.ts 的 stdout 报出来的（而非本文件猜的）
 *
 * 日常回归先跑 eval:smoke；改动 prompts / 循环控制后必须跑本 eval。
 *
 *   pnpm eval:full            # 默认题（run.ts 的默认 = Science-125 #61）
 *   pnpm eval:full "<问题>"   # 指定问题
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ProposalSchema } from "#lib/contracts.ts";
import { REPO_ROOT } from "../lib/paths.ts";
import { check, report } from "./selftestHarness.ts";

function runNode(args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((res, rej) => {
    const child = spawn("node", args, {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "inherit"],
    });
    let stdout = "";
    child.stdout.on("data", (c: Buffer) => {
      const s = c.toString();
      stdout += s;
      process.stdout.write(s);
    });
    child.on("error", rej);
    child.on("close", (code) => res({ code: code ?? -1, stdout }));
  });
}

const question = process.argv[2];
console.log("[eval-full] 起一次完整流水线（≈20 分钟，花真钱）…\n");
const pipeline = await runNode(["scripts/run.ts", ...(question ? [question] : [])]);

check("gate: pipeline exit 0", pipeline.code === 0, `exit=${pipeline.code}`);

/** 首选取证：run 目录从 run.ts 的 stdout 报出来（不猜最新目录，不受同机并发影响）。 */
const runDir = pipeline.stdout.match(/\[luup\] run dir : (.+)/)?.[1]?.trim() ?? "";
check("soft: run 目录由 stdout 报出", runDir !== "" && existsSync(runDir), runDir || "(未报出)");

if (runDir && existsSync(runDir)) {
  const proposalPath = join(runDir, "proposal.json");
  let contractOk = false;
  let issues = "(proposal.json 缺失)";
  if (existsSync(proposalPath)) {
    try {
      const parsed = ProposalSchema.safeParse(JSON.parse(readFileSync(proposalPath, "utf8")));
      contractOk = parsed.success;
      issues = parsed.success ? "" : parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    } catch (e) {
      issues = `JSON 解析失败：${String(e)}`;
    }
  }
  check("gate: proposal.json 过 10 字段契约", contractOk, issues);

  console.log("\n[eval-full] 离线验收（B1–B4 逐条反查 arXiv）…\n");
  const verify = await runNode(["scripts/verify-proposal.ts", runDir]);
  check("gate: 离线验收器 exit 0（ALL PASS）", verify.code === 0, `exit=${verify.code}`);
}

report("eval-full-run");
