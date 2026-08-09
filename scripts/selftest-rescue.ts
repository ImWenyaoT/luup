/**
 * 救援升档通道 selftest（**零 API 调用**）。
 *
 *   pnpm selftest:rescue
 *
 * 覆盖两件事，正好是救援通道的两个接缝：
 *
 *  1. **`LUUP_MODEL_ID` 覆盖生效**（`agent/lib/model.ts`）。这是救援轮唯一的传导机制 ——
 *     run-batch 只往子进程塞一个环境变量，四个 agent 节点能不能真的换档全靠它。
 *     反向断言同样重要：**显式传入的 modelId 必须压过环境变量**，否则一次救援轮会顺手
 *     把 judge（`scripts/judgeClient.ts` 自己定档）也换掉，救援轮的分就跟主批不可比了。
 *
 *  2. **救援计划在 `--dry-run` 下只打印不执行**。dry-run 一个子进程都不起，所以这里能
 *     零成本地断言「哪些题会进救援轮」：已交付的题（skipped）不该出现在候选里 —— 救援
 *     救的是失败题，不是重烧已有成果。
 *
 * 真正的救援轮（失败题重跑）本身要花钱，不在 selftest 覆盖范围：它跑的是一次普通 run，
 * 照常走全部 gate 与独立验收，没有专属代码路径可测。
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { QWEN_DEFAULT_MODEL_ID, qwenModel } from "#lib/model.ts";
import { REPO_ROOT, RUNS_DIR } from "../lib/paths.ts";
import { deliveredQuestionId, readRunEvidence } from "../lib/runOutcome.ts";
import { check, eq, report } from "./selftestHarness.ts";

/** `LanguageModel` 是 `string | LanguageModelV*` 的联合，取 id 要两种形态都认。 */
const modelIdOf = (m: unknown): string =>
  typeof m === "object" && m !== null && "modelId" in m ? String((m as { modelId: unknown }).modelId) : String(m);

/* ------------------------------------------------------------------ */
/* 1. LUUP_MODEL_ID 覆盖                                                */
/* ------------------------------------------------------------------ */

console.log("[1] LUUP_MODEL_ID 覆盖（救援通道的传导机制）");

const savedModelId = process.env.LUUP_MODEL_ID;

delete process.env.LUUP_MODEL_ID;
eq("未设 LUUP_MODEL_ID → 默认档", modelIdOf(qwenModel()), QWEN_DEFAULT_MODEL_ID);

process.env.LUUP_MODEL_ID = "qwen3.8-max";
eq("设了 LUUP_MODEL_ID → 覆盖默认档", modelIdOf(qwenModel()), "qwen3.8-max");
eq("thinking 档同样被覆盖", modelIdOf(qwenModel({ thinking: true })), "qwen3.8-max");
eq(
  "显式 modelId 压过 LUUP_MODEL_ID（救援轮不改判分器档位）",
  modelIdOf(qwenModel({ modelId: "qwen3.7-plus" })),
  "qwen3.7-plus",
);

process.env.LUUP_MODEL_ID = "   ";
eq("空白 LUUP_MODEL_ID 视同未设", modelIdOf(qwenModel()), QWEN_DEFAULT_MODEL_ID);

if (savedModelId === undefined) delete process.env.LUUP_MODEL_ID;
else process.env.LUUP_MODEL_ID = savedModelId;

/* ------------------------------------------------------------------ */
/* 2. 救援计划的 dry-run                                                */
/* ------------------------------------------------------------------ */

console.log("\n[2] 救援计划 dry-run（不起子进程，零 API）");

/** 已交付题号：判定 owner 是 lib/runOutcome.ts，与 run-batch 的续跑判据同一份实现。 */
function deliveredIds(): Set<number> {
  const done = new Set<number>();
  if (!existsSync(RUNS_DIR)) return done;
  for (const ent of readdirSync(RUNS_DIR, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const qid = deliveredQuestionId(readRunEvidence(join(RUNS_DIR, ent.name), ent.name));
    if (qid !== null) done.add(qid);
  }
  return done;
}

const delivered = deliveredIds();
const fresh = Array.from({ length: 125 }, (_, i) => i + 1)
  .filter((id) => !delivered.has(id))
  .slice(0, 2);

function batch(args: string[]): { code: number; out: string } {
  const r = spawnSync("node", ["scripts/run-batch.ts", ...args], { cwd: REPO_ROOT, encoding: "utf8" });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** 只取救援计划那一行 —— 候选断言必须针对它，不能针对整个 stdout。 */
const planLine = (out: string): string => out.split("\n").find((l) => l.includes("plan rescue")) ?? "";
/** `Q1` 不能匹配到 `Q125`：后面不许再跟数字。 */
const mentionsQ = (line: string, id: number): boolean => new RegExp(`Q${id}(?![0-9])`).test(line);

const RESCUE_ID = "qwen3.8-max";
const withRescue = batch([...fresh.map(String), "--dry-run", `--rescue-model=${RESCUE_ID}`]);

eq("dry-run + 救援 → 退出码 0", withRescue.code, 0);
check("打印了救援计划行", planLine(withRescue.out) !== "", withRescue.out.slice(0, 400));
check("救援计划写明了模型 id", planLine(withRescue.out).includes(RESCUE_ID));
for (const id of fresh) {
  check(`未交付的 Q${id} 进了救援候选`, mentionsQ(planLine(withRescue.out), id), planLine(withRescue.out));
}

const skipCandidate = [...delivered][0];
if (skipCandidate === undefined) {
  console.log("  · runs/ 里没有已交付的题，跳过「skipped 不进候选」断言");
} else {
  const mixed = batch([String(skipCandidate), ...fresh.map(String), "--dry-run", `--rescue-model=${RESCUE_ID}`]);
  check(
    `已交付的 Q${skipCandidate} 不进救援候选（救失败题，不重烧已有成果）`,
    !mentionsQ(planLine(mixed.out), skipCandidate),
    planLine(mixed.out),
  );
}

const noRescue = batch([...fresh.map(String), "--dry-run"]);
eq("不给 --rescue-model → 退出码 0", noRescue.code, 0);
check("不给 --rescue-model 就没有救援计划（默认不启用）", planLine(noRescue.out) === "", planLine(noRescue.out));

eq("--rescue-model= 空值被拒", batch([...fresh.map(String), "--dry-run", "--rescue-model="]).code, 2);
eq("未知 flag 仍被拒（前缀白名单没放水）", batch([...fresh.map(String), "--dry-run", "--rescue-mode=x"]).code, 2);

const batchReports = existsSync(RUNS_DIR) ? readdirSync(RUNS_DIR).filter((f) => f.startsWith("batch-")).length : 0;
batch([...fresh.map(String), "--dry-run", `--rescue-model=${RESCUE_ID}`]);
const after = existsSync(RUNS_DIR) ? readdirSync(RUNS_DIR).filter((f) => f.startsWith("batch-")).length : 0;
eq("dry-run 不写汇总报告", after, batchReports);

report("selftest-rescue");
