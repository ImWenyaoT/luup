import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { activeRunId } from "./lock.ts";
import { RUNS_DIR, isRunId, runDir } from "./paths.ts";
import {
  deriveNodes,
  deriveStatus,
  finishedAtMs,
  parseQuestion,
  parseVerdicts,
  parseVerifyReport,
  readJson,
  readMeta,
  readText,
  scanRun,
  startedAtMs,
  tailLines,
} from "./phase.ts";
import type { Paper, Proposal, RunDetail, RunStatusView, RunSummary } from "./types.ts";

/** console.log 可能带环境噪声（pipeline 继承 QWEN_*），只以末 40 行形式经 status 返回。 */
const ARTIFACT_DENY = new Set(["console.log"]);

export function listRunIds(): string[] {
  let entries: string[];
  try {
    entries = readdirSync(RUNS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && isRunId(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
  return entries.sort().reverse();
}

export function readSummary(id: string): RunSummary | null {
  const scan = scanRun(id);
  if (!scan) return null;
  const status = deriveStatus(scan);
  const verdicts = parseVerdicts(scan);
  const nodes = deriveNodes(scan, status, verdicts);
  const q = parseQuestion(readText(scan, "question.md"));
  const meta = readMeta(scan);
  const proposal = readJson<Proposal>(scan, "proposal.json");
  const verify = parseVerifyReport(readText(scan, "verification-report.md"));
  const started = startedAtMs(scan);
  const finished = finishedAtMs(scan, status);
  const byKey = Object.fromEntries(nodes.map((n) => [n.key, n.state]));
  return {
    id,
    startedAt: new Date(started ?? 0).toISOString(),
    finishedAt: finished !== null ? new Date(finished).toISOString() : null,
    status,
    question: q.short,
    domain: q.domain,
    science125Id: typeof meta?.questionId === "number" ? meta.questionId : q.science125Id,
    refs: Array.isArray(proposal?.references) ? proposal.references.length : null,
    verify: verify ? (verify.pass ? "pass" : "fail") : null,
    durationSec: started !== null && finished !== null ? Math.round((finished - started) / 1000) : null,
    nodes: {
      literature: byKey.literature,
      hypothesis: byKey.hypothesis,
      critique: byKey.critique,
      proposal: byKey.proposal,
    },
  };
}

export function listRuns(limit = 50): RunSummary[] {
  const out: RunSummary[] = [];
  for (const id of listRunIds()) {
    if (out.length >= limit) break;
    const s = readSummary(id);
    if (s) out.push(s);
  }
  return out;
}

/**
 * ?artifact= 的白名单不是正则放行，而是与 readdir 的真实结果做集合匹配。
 * 想不到的路径形态（编码、大小写、软链）都会因为不在集合里而落空。
 */
export function artifactNames(id: string): string[] {
  const scan = scanRun(id);
  if (!scan) return [];
  return [...scan.files.keys()].filter((f) => !ARTIFACT_DENY.has(f)).sort();
}

export function readArtifact(id: string, name: string): string | null {
  const scan = scanRun(id);
  if (!scan) return null;
  if (ARTIFACT_DENY.has(name) || !scan.files.has(name)) return null;
  try {
    return readFileSync(join(runDir(id), name), "utf8");
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* memory/index.md → 论文索引                                           */
/* ------------------------------------------------------------------ */

/** paperStore 用 `__` 替掉旧式 id 里的斜杠：astro-ph/0402200 → astro-ph__0402200.md */
export const paperFile = (arxivId: string) => `memory/papers/${arxivId.replace(/\//g, "__")}.md`;

export function parsePapers(text: string | null): Paper[] {
  if (!text) return [];
  const out: Paper[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 4) continue;
    if (cells[0] === "arXiv id" || /^-+$/.test(cells[0])) continue;
    out.push({ arxivId: cells[0], year: cells[1], title: cells[2], oneline: cells[3], file: paperFile(cells[0]) });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 详情                                                                 */
/* ------------------------------------------------------------------ */

export function readStatusView(id: string): RunStatusView | null {
  const scan = scanRun(id);
  if (!scan) return null;
  const status = deriveStatus(scan);
  const verdicts = parseVerdicts(scan);
  const nodes = deriveNodes(scan, status, verdicts);
  const names = [...scan.files.keys()];
  return {
    id,
    status,
    updatedAt: new Date().toISOString(),
    nodes,
    artifacts: Object.fromEntries(names.map((n) => [n, true])),
    verdicts,
    logTail: tailLines(readText(scan, "console.log"), 40),
  };
}

export function readRun(id: string): RunDetail | null {
  const base = readStatusView(id);
  const scan = scanRun(id);
  if (!base || !scan) return null;
  const q = parseQuestion(readText(scan, "question.md"));
  const meta = readMeta(scan);
  const started = startedAtMs(scan);
  const finished = finishedAtMs(scan, base.status);
  return {
    ...base,
    questionText: q.full,
    domain: q.domain,
    science125Id: typeof meta?.questionId === "number" ? meta.questionId : q.science125Id,
    startedAt: new Date(started ?? 0).toISOString(),
    finishedAt: finished !== null ? new Date(finished).toISOString() : null,
    durationSec: started !== null && finished !== null ? Math.round((finished - started) / 1000) : null,
    proposal: readJson<Proposal>(scan, "proposal.json"),
    proposalRejected: readText(scan, "proposal.json.rejected.json"),
    verify: parseVerifyReport(readText(scan, "verification-report.md")),
    papers: parsePapers(readText(scan, "memory/index.md")),
    failedText: readText(scan, "FAILED.md"),
    artifactNames: artifactNames(id),
  };
}

export const activeRun = activeRunId;
