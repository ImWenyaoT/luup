/**
 * `.eve/.workflow-data` 保留策略的 CLI 壳。判定引擎在 `lib/retention.ts`。
 *
 *   node scripts/prune-eve-state.ts                  # 默认 dry-run：只报告，不删
 *   node scripts/prune-eve-state.ts --apply          # 真删
 *   node scripts/prune-eve-state.ts --apply --grace-min=30
 *   node scripts/prune-eve-state.ts --json           # 机器可读
 *
 * 这里只做三件事：解析 argv、调 planPrune、把结果打给人看。
 * 一行判据都不许住在这个文件里 —— 批跑与自测都直接调引擎，脚本只是它的一个前端。
 */
import { type PruneResult, formatBytes, planPrune, summarize } from "../lib/retention.ts";

const DEFAULT_GRACE_MIN = 60;
const USAGE = "usage: node scripts/prune-eve-state.ts [--apply] [--grace-min=N] [--json] [--top=N]";

function render(r: PruneResult, graceMin: number, asJson: boolean, top: number): void {
  if (asJson) {
    console.log(
      JSON.stringify(
        {
          applied: r.applied,
          graceMin,
          floorAt: new Date(r.floorMs).toISOString(),
          scanned: r.scanned,
          prunable: r.prunable.length,
          prunableBytes: r.prunableBytes,
          deleted: r.deleted.length,
          freedBytes: r.freedBytes,
          totalBytes: r.totalBytes,
          keepReasons: r.keepReasons,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`[prune] 状态盘   : ${r.stateDir}`);
  console.log(`[prune] 模式     : ${r.applied ? "APPLY（真删）" : "DRY-RUN（只报告，加 --apply 才删）"}`);
  console.log(`[prune] 活跃下限 : ${new Date(r.floorMs).toISOString()}（grace ${graceMin} 分钟）`);
  console.log(`[prune] 扫描     : ${r.scanned} 个流，合计 ${formatBytes(r.totalBytes)}`);

  if (r.scanned === 0) {
    console.log("[prune] streams/chunks 为空或不存在，无事可做。");
    return;
  }

  const shown = r.prunable.slice(0, top);
  if (shown.length > 0) {
    console.log(`\n[prune] ${r.applied ? "已删" : "可删"}（按体量降序，前 ${shown.length}/${r.prunable.length}）：`);
    for (const p of shown) {
      const via = p.runId ? `run ${p.runId}` : p.wrunId ? `wf ${p.workflowStatus ?? "?"}（无 run 映射）` : "孤儿流";
      console.log(`  ${formatBytes(p.bytes).padStart(9)}  ${String(p.files).padStart(6)} 文件  ${p.id}  ← ${via}`);
    }
  } else {
    console.log("\n[prune] 没有可删的流：全部被安全判据挡下。");
  }

  const reasons = Object.entries(r.keepReasons).sort((a, b) => b[1] - a[1]);
  if (reasons.length > 0) {
    console.log("\n[prune] 保留原因：");
    for (const [reason, n] of reasons) console.log(`  ${String(n).padStart(4)}  ${reason}`);
  }

  console.log(`\n[prune] ${summarize(r)}`);
  if (!r.applied && r.prunable.length > 0) {
    console.log("[prune] 这是 dry-run —— 加 --apply 才会真的删。");
  }
}

function main(argv: string[]): number {
  let apply = false;
  let graceMin = DEFAULT_GRACE_MIN;
  let asJson = false;
  let top = 10;

  for (const a of argv) {
    if (a === "--apply") apply = true;
    else if (a === "--dry-run") apply = false;
    else if (a === "--json") asJson = true;
    else if (a.startsWith("--grace-min=")) graceMin = Number.parseInt(a.slice("--grace-min=".length), 10);
    else if (a.startsWith("--top=")) top = Number.parseInt(a.slice("--top=".length), 10);
    else {
      console.error(`unknown flag: ${a}\n${USAGE}`);
      return 2;
    }
  }
  if (!Number.isInteger(graceMin) || graceMin < 0) {
    console.error(`--grace-min 必须是非负整数\n${USAGE}`);
    return 2;
  }
  if (!Number.isInteger(top) || top < 0) {
    console.error(`--top 必须是非负整数\n${USAGE}`);
    return 2;
  }

  render(planPrune({ apply, graceMs: graceMin * 60 * 1000 }), graceMin, asJson, top);
  return 0;
}

process.exit(main(process.argv.slice(2)));
