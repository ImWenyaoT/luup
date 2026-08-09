import { readdirSync } from "node:fs";
import { paperFilename } from "#lib/paperStore.ts";
import { parseTableRows } from "./mdTable.ts";
import { RUNS_DIR } from "./paths.ts";
import {
  type Scan,
  deriveNodes,
  deriveStatus,
  evidenceFromScan,
  outcomeOf,
  parseVerdicts,
  parseVerifyReport,
  readJson,
  readText,
  reportOf,
  scanRun,
  tailLines,
} from "./phase.ts";
import { parseQuestion } from "./questionText.ts";
import { isRunId } from "./runId.ts";
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

/**
 * 每个读入口都要一个 `activeId`（此刻持锁的 run，`activeRunId()`）：它是 running 态的
 * 唯一来源，也是这一层唯一的进程外事实。列表页取一次往下传，一次请求只读一次锁。
 */
export function readSummary(id: string, activeId: string | null): RunSummary | null {
  const scan = scanRun(id);
  if (!scan) return null;
  const status = deriveStatus(scan, activeId);
  const verdicts = parseVerdicts(scan);
  const nodes = deriveNodes(scan, status, verdicts);
  const q = parseQuestion(readText(scan, "question.md"));
  const proposal = readJson<Proposal>(scan, "proposal.json");
  const verify = parseVerifyReport(reportOf(scan));
  const o = outcomeOf(scan);
  const started = o.startedMs;
  // 在跑的 run 不显示结束时间——这是表示层的选择，与「有没有结束时间」是两件事
  const finished = status === "running" ? null : o.finishedMs;
  const byKey = Object.fromEntries(nodes.map((n) => [n.key, n.state]));
  return {
    id,
    startedAt: new Date(started ?? 0).toISOString(),
    finishedAt: finished !== null ? new Date(finished).toISOString() : null,
    status,
    question: q.short,
    domain: q.domain,
    science125Id: evidenceFromScan(scan).meta?.questionId ?? q.science125Id,
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

/** `ids` 可由已经 readdir 过的调用方传进来（lib/runsIndex.ts 的回退分支），别扫第二次。 */
export function listRuns(limit: number, activeId: string | null, ids: string[] = listRunIds()): RunSummary[] {
  const out: RunSummary[] = [];
  for (const id of ids) {
    if (out.length >= limit) break;
    const s = readSummary(id, activeId);
    if (s) out.push(s);
  }
  return out;
}

/**
 * ?artifact= 的白名单不是正则放行，而是与 readdir 的真实结果做集合匹配。
 * 想不到的路径形态（编码、大小写、软链）都会因为不在集合里而落空。
 */
export function artifactNamesFrom(scan: Scan): string[] {
  return [...scan.files.keys()].filter((f) => !ARTIFACT_DENY.has(f)).sort();
}

export function readArtifactFrom(scan: Scan, name: string): string | null {
  if (ARTIFACT_DENY.has(name)) return null;
  return readText(scan, name); // 命中集合才读盘，name 无从越界
}

export function readArtifact(id: string, name: string): string | null {
  const scan = scanRun(id);
  return scan ? readArtifactFrom(scan, name) : null;
}

/* ------------------------------------------------------------------ */
/* memory/index.md → 论文索引                                           */
/* ------------------------------------------------------------------ */

/** id↔文件名映射的唯一实现在 paperStore；这里只是拼上 run 内的相对目录。 */
export const paperFile = (arxivId: string) => `memory/papers/${paperFilename(arxivId)}`;

export function parsePapers(text: string | null): Paper[] {
  if (!text) return [];
  const out: Paper[] = [];
  for (const cells of parseTableRows(text ?? "", 4)) {
    if (cells[0] === "arXiv id") continue;
    out.push({ arxivId: cells[0], year: cells[1], title: cells[2], oneline: cells[3], file: paperFile(cells[0]) });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 详情                                                                 */
/* ------------------------------------------------------------------ */

/**
 * 一次 scanRun 是一次递归 readdir + 每文件 statSync；一次请求扫一遍就够。
 * 所以详情侧的读取全部以 Scan 为入参（*From 后缀），id 版只是「扫一次再转发」的薄壳。
 */
export function statusViewFrom(scan: Scan, activeId: string | null): RunStatusView {
  const status = deriveStatus(scan, activeId);
  const verdicts = parseVerdicts(scan);
  const nodes = deriveNodes(scan, status, verdicts);
  return {
    id: scan.id,
    status,
    updatedAt: new Date().toISOString(),
    nodes,
    verdicts,
    logTail: tailLines(readText(scan, "console.log"), 40),
  };
}

export function readStatusView(id: string, activeId: string | null): RunStatusView | null {
  const scan = scanRun(id);
  return scan ? statusViewFrom(scan, activeId) : null;
}

export function readRunFrom(scan: Scan, activeId: string | null): RunDetail {
  const base = statusViewFrom(scan, activeId);
  const q = parseQuestion(readText(scan, "question.md"));
  const o = outcomeOf(scan);
  const started = o.startedMs;
  const finished = base.status === "running" ? null : o.finishedMs;
  return {
    ...base,
    questionText: q.full,
    domain: q.domain,
    science125Id: evidenceFromScan(scan).meta?.questionId ?? q.science125Id,
    startedAt: new Date(started ?? 0).toISOString(),
    finishedAt: finished !== null ? new Date(finished).toISOString() : null,
    durationSec: started !== null && finished !== null ? Math.round((finished - started) / 1000) : null,
    proposal: readJson<Proposal>(scan, "proposal.json"),
    proposalRejected: readText(scan, "proposal.json.rejected.json"),
    verify: parseVerifyReport(reportOf(scan)),
    papers: parsePapers(readText(scan, "memory/index.md")),
    failedText: readText(scan, "FAILED.md"),
    artifactNames: artifactNamesFrom(scan),
  };
}

export function readRun(id: string, activeId: string | null): RunDetail | null {
  const scan = scanRun(id);
  return scan ? readRunFrom(scan, activeId) : null;
}
