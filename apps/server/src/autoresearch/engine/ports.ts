import type { LanguageModel } from "ai";

import type { Assignment, ResearchTicket, WorkerReport } from "../domain.ts";
import type { AutoresearchGate } from "../types.ts";
import type { BrowserRunner } from "../tools/browser.ts";
import type { SessionLog } from "../session/log.ts";

export type Assessor = {
  assess(ticket: ResearchTicket): AutoresearchGate;
};

export type ExecutorLaunchInput = {
  ticket: ResearchTicket;
  assignment: Assignment;
  session: SessionLog;
  model: LanguageModel;
  browserRunner?: BrowserRunner;
  abortSignal?: AbortSignal;
};

export type WorkerExecutor = {
  run(input: ExecutorLaunchInput): Promise<WorkerReport>;
};

export type ResearchRepositories = {
  saveTicket(ticket: ResearchTicket): void;
  getTicket(id: string): ResearchTicket | null;
  saveSession(session: SessionLog): void;
  getSession(id: string): SessionLog | null;
};

export type EngineEmit = (event: { type: string; ticketId: string; detail?: Record<string, unknown> }) => void;

export type EnginePorts = {
  assessor: Assessor;
  executor: WorkerExecutor;
  repos: ResearchRepositories;
  model: LanguageModel;
  browserRunner?: BrowserRunner;
  emit?: EngineEmit;
  clock?: () => Date;
};
