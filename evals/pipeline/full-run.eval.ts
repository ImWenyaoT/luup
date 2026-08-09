import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { defineEval } from "eve/evals";
import { equals, satisfies } from "eve/evals/expect";
import { ProposalSchema } from "#lib/contracts.ts";
import { REPO_ROOT, RUNS_DIR } from "../../lib/paths.ts";
import { science125Text } from "../../lib/questionText.ts";
import { findQuestion } from "../../lib/science125.ts";

/**
 * Goal-driven 全链路 eval（criteria 的机器化版本）：
 * 真跑一次 L→H→C→W→master 认证，落盘工件后——
 *  gate：run 成功、verify_references 返回 ok:true、proposal.json 过 10 字段契约、
 *        离线验收器（B1–B4 引用逐条反查 arXiv）exit 0
 *  soft：run 目录是由 master 自己报出来的（而非本文件猜的）、judge 审最终报告是否如实汇报
 *
 * 注意：这是花真钱的 eval（一次完整流水线 ≈20 分钟）。日常回归先跑 smoke，
 * 改动 prompts/循环控制后必须跑本 eval。
 */
/**
 * 仓库根走 lib/paths.ts 的单点判定（本文件曾经手抄过一份「向上找 fixtures/」的
 * 探测器）。eve 会把 eval 编译到 node_modules/.cache 里执行，那里的 import.meta
 * 不指向源码 —— paths.ts 的第三级 fallback（cwd，eve eval 从仓库根启动）正是为
 * 这种情形准备的。
 */
const runsRoot = RUNS_DIR;

/**
 * 首选取证路径：master 的收尾报告按 instructions 必须列出工件路径清单，首行是 run
 * 目录的绝对路径。这里只认「报告里出现过、且磁盘上确实存在」的 run id，因此不受
 * 同机并发或残留目录影响。
 */
function runDirFromReply(reply: string | null): string | null {
  if (!reply) return null;
  for (const m of reply.matchAll(/\d{8}-\d{6}/g)) {
    const dir = join(runsRoot, m[0]);
    if (existsSync(dir)) return dir;
  }
  return null;
}

/**
 * 降级路径：eval 进程未设 LUUP_RUN_DIR，工具层会回退到自建 runs/<ts>/，只能按 mtime
 * 找最新。这是猜，不是取证 —— 同机手跑的流水线会让它选错目标，所以用到它这件事
 * 本身要被记成一条 soft 信息。
 */
function newestRunDirSince(t0: number): string | null {
  if (!existsSync(runsRoot)) return null;
  const dirs = readdirSync(runsRoot)
    .map((d) => join(runsRoot, d))
    .filter((p) => statSync(p).isDirectory() && statSync(p).mtimeMs >= t0);
  return dirs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null;
}

export default defineEval({
  description: "Science-125 选题全链路：认证循环产出可通过确定性验收的研究计划",
  tags: ["pipeline", "expensive"],
  timeoutMs: 45 * 60_000,
  async test(t) {
    const t0 = Date.now();
    // 与 scripts/run.ts 的默认题同源派生：题库是唯一事实源，没有第二份默认题文件
    const q61 = findQuestion(61);
    if (!q61) throw new Error("题库里没有第 61 题");
    const question = science125Text(q61);

    await t.send(
      [
        "运行一次完整的科研假设流水线。",
        "",
        "科学问题：",
        question,
        "",
        "按 instructions 里的 DAG 与循环控制硬规格执行：literature → hypothesis → critique → proposal，",
        "逐节点认证并落盘 verdicts/，最后必须跑 verify_references 并拿到 ok:true 才算成功；否则如实报失败。",
      ].join("\n"),
    );

    t.succeeded();

    // 光「调过」不够：终审闸门的语义是拿到 ok:true，谓词直接判返回值
    t.calledTool("verify_references", {
      output: (value) => (value as { ok?: unknown } | null | undefined)?.ok === true,
    });

    // 取证优先，猜是降级：降级发生这件事本身记一条 soft，报告里看得见
    const reported = runDirFromReply(t.reply);
    t.check(
      reported,
      satisfies((v) => v !== null, "master 的收尾报告里带了 run 目录（未降级到 mtime 猜）"),
    )
      .label("run dir reported")
      .soft();

    const runDir = (await t.require(
      reported ?? newestRunDirSince(t0),
      satisfies((v) => typeof v === "string", "run 目录已定位"),
    ))!;

    // 10 字段契约（gate）
    const proposalPath = join(runDir, "proposal.json");
    await t.require(existsSync(proposalPath), equals(true));
    const parsed = ProposalSchema.safeParse(JSON.parse(readFileSync(proposalPath, "utf8")));
    t.check(parsed.success, equals(true));

    // 离线验收器完整重放：A + B1 + B2 + B3 + B4（含 arXiv 网络反查），exit 0 为 gate
    const verify = spawnSync("node", ["scripts/verify-proposal.ts", runDir], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 5 * 60_000,
    });
    t.check(verify.status, equals(0));

    // soft judge：最终报告须如实汇报认证结论（不复述全文）
    t.judge.autoevals
      .closedQA("回复以中文汇报：胜出假设一句话、verify_references 通过、各节点轮数与工件路径")
      .atLeast(0.6);
  },
});
