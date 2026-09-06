import type { Harness } from "./harness.ts";
import { ControlSubmissionError, type SqliteStore } from "./store/store.ts";

/** 单进程的运行所有权。取消后保留并发名额，直到执行器真正退出；事实仍由 SQLite 持有。 */
export class RunScheduler {
  readonly #queue = new Set<string>();
  readonly #active = new Map<string, { controller: AbortController; done: Promise<void> }>();
  #closed = false;

  constructor(
    private readonly store: SqliteStore,
    private readonly harness: Harness,
    private readonly reportError: (message: string, error: unknown) => void,
  ) {}

  get size(): number {
    return this.#queue.size + this.#active.size;
  }

  get accepting(): boolean {
    return !this.#closed;
  }

  schedule(runId: string): void {
    if (this.#closed) throw new ControlSubmissionError("conflict", "运行服务正在关闭。");
    if (this.#queue.has(runId) || this.#active.has(runId) || this.store.readRunOutcome(runId)) return;
    this.store.emit(runId, "harness.queued", {});
    this.#queue.add(runId);
    this.#drain();
  }

  cancel(runId: string): "stopping" | "settled" {
    if (this.store.readRunOutcome(runId)) return "settled";
    const active = this.#active.get(runId);
    if (!active && !this.#queue.has(runId)) {
      throw new ControlSubmissionError("conflict", "此运行不由当前服务执行，无法停止。");
    }
    if (active?.controller.signal.aborted) return "stopping";
    this.store.emit(runId, "harness.stop_requested", {});
    if (this.#queue.delete(runId)) {
      this.store.settleAbandonedRun(runId, "interrupted", "UserCancellation");
      return "settled";
    }
    const reason = new Error("用户停止了研究。");
    reason.name = "UserCancellation";
    active!.controller.abort(reason);
    return "stopping";
  }

  async close(): Promise<void> {
    this.#closed = true;
    for (const runId of [...this.#queue, ...this.#active.keys()]) this.cancel(runId);
    await Promise.all([...this.#active.values()].map((entry) => entry.done));
  }

  #drain(): void {
    while (!this.#closed && this.#active.size < 2 && this.#queue.size > 0) {
      const runId = this.#queue.values().next().value!;
      this.#queue.delete(runId);
      const controller = new AbortController();
      const done = Promise.resolve()
        .then(async () => {
          if (this.store.readRunOutcome(runId)) return;
          this.store.emit(runId, "harness.dispatched", {});
          await this.harness.execute(runId, { signal: controller.signal });
        })
        .catch((error: unknown) => {
          this.reportError("background run failed", error);
          try {
            this.store.settleAbandonedRun(
              runId,
              controller.signal.aborted ? "interrupted" : "runtime_error",
              controller.signal.aborted ? "UserCancellation" : "BackgroundRunError",
            );
          } catch (settleError) {
            this.reportError("failed to settle background run", settleError);
          }
        })
        .finally(() => {
          this.#active.delete(runId);
          this.#drain();
        });
      this.#active.set(runId, { controller, done });
    }
  }
}
