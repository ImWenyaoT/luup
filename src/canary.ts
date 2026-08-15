import { EvidenceLedger } from "./agent/evidence.ts";
import { Harness } from "./harness.ts";
import { createQwenExecutor, type StageMetrics } from "./executor.ts";
import { SqliteStore } from "./store/store.ts";

// 只放问题本身。检索怎么做是角色 instructions 该管的事 —— 把操作指令混进 question，
// 模型会只把问题那部分填回 Artifact，然后撞上「不得改写冻结问题」这道门。
const question = "设计一个可证伪的实验，检验强制引用可核验来源能否降低大语言模型生成内容中的事实性错误率。";

const metrics: StageMetrics[] = [];
const store = new SqliteStore(process.env.LUUP_DATABASE || ":memory:");
const searches: unknown[] = [];

try {
  const harness = new Harness(store, createQwenExecutor((item) => metrics.push(item)), {
    createLedger: (scope) => {
      const ledger = new EvidenceLedger({
        namespace: `${scope.attemptId}_`,
        onRecord: (record) => store.recordEvidence(scope.runId, scope.attemptId, record),
      });
      searches.push(ledger);
      return ledger;
    },
  });
  const runId = harness.createRun(question);
  const outcome = await harness.execute(runId);

  const snapshot = store.snapshot(runId)!;
  process.stdout.write(`${JSON.stringify({
    status: snapshot.status,
    error_code: snapshot.error_code,
    final_artifact_id: snapshot.final_artifact_id,
    outcome,
    attempts: snapshot.attempts.map((a: any) => ({
      role: a.role, ordinal: a.ordinal, status: a.status,
      corrections: a.corrections, failure_code: a.failure_code,
    })),
    artifacts: snapshot.artifacts.map((a: any) => ({ id: a.id, type: a.type })),
    events: snapshot.recent_events.map((e: any) => ({ version: e.version, kind: e.kind, payload: e.payload })),
    metrics,
    searches: (searches as EvidenceLedger[]).flatMap((ledger) => ledger.values()),
  }, null, 2)}\n`);
  if (snapshot.status !== "completed") process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    error: error instanceof Error ? error.message : String(error),
    metrics,
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  store.close();
}
