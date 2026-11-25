import { newId, nowIso } from "../domain.ts";
import type { ResearchEngine, RunResearchResult } from "../runtime.ts";
import { extractFollowUps, mintPaperDraft } from "./paper.ts";
import type {
  AgendaItem,
  MillSnapshot,
  MillStatus,
  MillTicketRecord,
  PaperDraft,
  ResearchAgenda,
  StartMillInput,
} from "./types.ts";

export type MillEnginePort = {
  runResearch: ResearchEngine["runResearch"];
};

export type ResearchMillOptions = {
  engine: MillEnginePort;
  clock?: () => Date;
  /** 两张 Ticket 之间的间隔（ms）；测试可 0。 */
  tickDelayMs?: number;
  onUpdate?: (snapshot: MillSnapshot) => void;
};

/**
 * ResearchMill：连续开 Ticket → 铸 Paper → 产量门。
 * 宿主环，不是模型自循环（ADR-0016）。
 */
export class ResearchMill {
  readonly #engine: MillEnginePort;
  readonly #clock: () => Date;
  readonly #tickDelayMs: number;
  readonly #onUpdate?: (snapshot: MillSnapshot) => void;
  #snapshot: MillSnapshot;
  #abort: AbortController | null = null;
  #loop: Promise<void> | null = null;

  constructor(options: ResearchMillOptions) {
    this.#engine = options.engine;
    this.#clock = options.clock ?? (() => new Date());
    this.#tickDelayMs = options.tickDelayMs ?? 0;
    this.#onUpdate = options.onUpdate;
    this.#snapshot = emptySnapshot(this.#clock);
  }

  snapshot(): MillSnapshot {
    return structuredClone(this.#snapshot);
  }

  /** 启动战役；已在跑则抛错。 */
  start(input: StartMillInput): MillSnapshot {
    if (this.#snapshot.status === "running") {
      throw new Error("mill_already_running");
    }
    const topic = input.topic.trim();
    const seeds = input.seedQuestions.map((q) => q.trim()).filter(Boolean);
    if (!topic) throw new Error("empty_topic");
    if (seeds.length === 0) throw new Error("empty_seeds");
    if (input.targetPapers < 1) throw new Error("invalid_target_papers");
    if (input.maxTickets < 1) throw new Error("invalid_max_tickets");

    const at = nowIso(this.#clock);
    const agenda: ResearchAgenda = {
      topic,
      items: seeds.map((question) => makeAgendaItem(question, "seed", at)),
    };
    this.#abort = new AbortController();
    this.#snapshot = {
      id: newId("mill"),
      status: "running",
      agenda,
      papers: [],
      tickets: [],
      quantity: {
        targetPapers: input.targetPapers,
        papersProduced: 0,
        ok: false,
      },
      maxTickets: input.maxTickets,
      ticketsStarted: 0,
      createdAt: at,
      updatedAt: at,
      finishedAt: null,
      lastError: null,
    };
    this.#emit();
    this.#loop = this.#runLoop(this.#abort.signal).finally(() => {
      this.#loop = null;
      this.#abort = null;
    });
    return this.snapshot();
  }

  async stop(): Promise<MillSnapshot> {
    if (this.#snapshot.status !== "running") return this.snapshot();
    this.#abort?.abort();
    if (this.#loop) {
      try {
        await this.#loop;
      } catch {
        /* loop owns terminal status */
      }
    }
    if (this.#snapshot.status === "running") {
      this.#finish("stopped");
    }
    return this.snapshot();
  }

  async waitUntilSettled(): Promise<MillSnapshot> {
    if (this.#loop) await this.#loop;
    return this.snapshot();
  }

  async #runLoop(signal: AbortSignal): Promise<void> {
    try {
      while (!signal.aborted) {
        if (this.#snapshot.quantity.papersProduced >= this.#snapshot.quantity.targetPapers) {
          this.#finish("completed");
          return;
        }
        if (this.#snapshot.ticketsStarted >= this.#snapshot.maxTickets) {
          this.#finish("exhausted");
          return;
        }
        const next = this.#takeNextAgendaItem();
        if (!next) {
          // 议程空且未达产量 → 用 topic 再开一问（永动机保底），计入 follow_up
          const refill = `Continue research on: ${this.#snapshot.agenda.topic}. Propose the next concrete experiment or claim to verify.`;
          this.#snapshot.agenda.items.push(makeAgendaItem(refill, "follow_up", nowIso(this.#clock)));
          this.#touch();
          continue;
        }

        this.#snapshot.ticketsStarted += 1;
        this.#touch();
        let result: RunResearchResult;
        try {
          result = await this.#engine.runResearch(next.question, { abortSignal: signal });
        } catch (error) {
          if (signal.aborted) {
            this.#finish("stopped");
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          this.#recordTicket({
            ticketId: `error_${this.#snapshot.ticketsStarted}`,
            question: next.question,
            outcome: "error",
            reason: message.slice(0, 400),
            paperId: null,
            at: nowIso(this.#clock),
          });
          continue;
        }

        const verified = result.ticket.status === "verified";
        let paper: PaperDraft | null = null;
        if (verified) {
          paper = mintPaperDraft(result.ticket, this.#clock);
          this.#snapshot.papers.push(paper);
          this.#snapshot.quantity.papersProduced = this.#snapshot.papers.length;
          this.#snapshot.quantity.ok = this.#snapshot.quantity.papersProduced >= this.#snapshot.quantity.targetPapers;
          for (const follow of extractFollowUps(result.deliveryText)) {
            this.#snapshot.agenda.items.push(makeAgendaItem(follow, "follow_up", nowIso(this.#clock)));
          }
          // 保底：每篇 verified 至少再塞一条续研，避免议程枯竭
          if (extractFollowUps(result.deliveryText).length === 0) {
            this.#snapshot.agenda.items.push(
              makeAgendaItem(
                `What is the strongest next experiment after: ${result.ticket.question}`,
                "follow_up",
                nowIso(this.#clock),
              ),
            );
          }
        }

        this.#recordTicket({
          ticketId: result.ticket.id,
          question: next.question,
          outcome: verified ? "verified" : "fail_closed",
          reason: result.ticket.decisions.at(-1)?.reason ?? result.ticket.status,
          paperId: paper?.id ?? null,
          at: nowIso(this.#clock),
        });

        if (this.#snapshot.quantity.ok) {
          this.#finish("completed");
          return;
        }
        if (this.#tickDelayMs > 0) {
          try {
            await delay(this.#tickDelayMs, signal);
          } catch {
            this.#finish("stopped");
            return;
          }
        }
      }
      this.#finish("stopped");
    } catch (error) {
      if (signal.aborted) {
        this.#finish("stopped");
        return;
      }
      this.#snapshot.lastError = error instanceof Error ? error.message : String(error);
      this.#finish("failed");
    }
  }

  #takeNextAgendaItem(): AgendaItem | null {
    const item = this.#snapshot.agenda.items.find((i) => i.consumedAt === null);
    if (!item) return null;
    item.consumedAt = nowIso(this.#clock);
    this.#touch();
    return item;
  }

  #recordTicket(record: MillTicketRecord): void {
    this.#snapshot.tickets.push(record);
    this.#touch();
  }

  #finish(status: Exclude<MillStatus, "idle" | "running">): void {
    this.#snapshot.status = status;
    this.#snapshot.finishedAt = nowIso(this.#clock);
    this.#snapshot.quantity.ok = this.#snapshot.quantity.papersProduced >= this.#snapshot.quantity.targetPapers;
    if (status === "completed" && !this.#snapshot.quantity.ok) {
      // 不变量：completed 必须过产量门
      this.#snapshot.status = "exhausted";
    }
    this.#touch();
  }

  #touch(): void {
    this.#snapshot.updatedAt = nowIso(this.#clock);
    this.#emit();
  }

  #emit(): void {
    this.#onUpdate?.(this.snapshot());
  }
}

function makeAgendaItem(question: string, source: AgendaItem["source"], at: string): AgendaItem {
  return {
    id: newId("agenda"),
    question,
    source,
    createdAt: at,
    consumedAt: null,
  };
}

function emptySnapshot(clock: () => Date): MillSnapshot {
  const at = nowIso(clock);
  return {
    id: "mill_idle",
    status: "idle",
    agenda: { topic: "", items: [] },
    papers: [],
    tickets: [],
    quantity: { targetPapers: 0, papersProduced: 0, ok: false },
    maxTickets: 0,
    ticketsStarted: 0,
    createdAt: at,
    updatedAt: at,
    finishedAt: null,
    lastError: null,
  };
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      return;
    }
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
