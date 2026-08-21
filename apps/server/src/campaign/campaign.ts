/** 跨 run 战役记忆：确定性读写 `memory/`，零 LLM。
 *
 * Run 数据搬进了 SQLite，战役记忆没有跟着搬 —— 它仍是 repo 根的 `memory/`，append-only
 * 的 Markdown。三个理由：
 *
 * 1. **连续性**：`memory/log.md` 与 `memory/questions/q*.md` 里已经有 Python 期跑批留下的
 *    战役史。换存储等于把那段历史切成两半，而战役记忆的全部价值就是「跨 run 累积」。
 * 2. **消融语义**：`--no-memory` 要能一眼说清关掉的是什么。关掉一个目录是可陈述的；
 *    关掉一张表的某几行不是。
 * 3. **红线**：criteria C5 与 `memory/SCHEMA.md` 写死了「文件 + 确定性字符匹配，零 embedding」。
 *
 * 与 Python 期 `app/agent/campaign.py`（ADR-0004 已删）的行格式对齐 —— `memory/` 里两栈写的行
 * 必须能被同一个 grep 读，
 * 只有两处按 TS 栈的事实改写：run 定位符从 `runs/<ts>` 改成 `<db 相对路径>#<runId>`，
 * 失败分类从 `分类：x` 改成可机读的 `cls=x`。
 *
 * 本模块**不含检索工具**。TS 栈的记忆通道只有一条：批跑发起 run 之前确定性读同题页末
 * 几行，注入 researcher 的输入。没有 memory_search，模型没有任何自主读记忆的通路 ——
 * 消融臂因此是「注入开 / 关」，而不是「工具返回真数据 / 返回 enabled=false」。
 */

import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** 注入给新 run 的历史条数上限。与 Python `PRIOR_ATTEMPT_LIMIT` 同值。 */
const PRIOR_ATTEMPT_LIMIT = 3;

/** 每条确定性记录一行，前缀固定 ⇒ 读取端是 grep，不是解析器。 */
export const ENTRY_PREFIX = "- [";

/** 一个 run 收尾时值得记进战役史的全部事实。全部来自落盘工件，模型无从改写。 */
export type CampaignFacts = {
  runId: string;
  questionId: number | null;
  status: "completed" | "review_rejected" | "failed";
  /** 终态失败分类；completed 时为 null。 */
  failureCode: string | null;
  /** 胜出计划的标题；没产出计划时为 null。 */
  title: string | null;
  /** 计划引用（URL 或 arXiv id 原样）；记进记忆时缩成 arXiv id。 */
  references: readonly string[];
};

/** 记忆读取的状态。`empty` 只能表示「文件可读但没有记录」，不是 I/O 失败。 */
export type CampaignReadResult = {
  status: "not_applicable" | "disabled" | "empty" | "available" | "unavailable";
  entries: string[];
  reason: string | null;
};

/** 记忆写入的状态。写入失败是 Run 的旁路降级，不应改写 Run 终态。 */
export type CampaignWriteResult = {
  status: "disabled" | "written" | "unavailable";
  reason: string | null;
};

/** 只有 completed 才算交付。`review_rejected` 与 `failed` 一样是「这条路没走通」。 */
const verdictOf = (status: CampaignFacts["status"]) => (status === "completed" ? "SUCCESS" : "FAILED");

// `2301.12345v2`、`hep-th/9901001`，以及被包在 arXiv URL 里的同两种写法。
const ARXIV_ID = /(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[a-z]{2})?\/\d{7}(?:v\d+)?)/i;

/** 引用缩成可读的短标识。提不出 arXiv id 的（Crossref/网页）原样保留。
 *
 * 这里**故意不 import** `verify/references.ts` 的 id 解析：那是验收判据，改动它必须重跑
 * 验收；战役记忆只是给下一个 run 看的一行摘要，两者的稳定性要求不同，不该拴在一起。
 */
export function referenceLabel(reference: string): string {
  return ARXIV_ID.exec(reference)?.[1] ?? reference;
}

/** 一条战役记录的摘要段：标题 + 引用 + 失败分类。三段都可缺，缺了就不写空占位。 */
function summarize(facts: CampaignFacts): string {
  const parts = [facts.title || "未产出 research-plan"];
  if (facts.references.length > 0) {
    parts.push(`引用 ${facts.references.map(referenceLabel).join(", ")}`);
  }
  if (facts.failureCode) parts.push(`cls=${facts.failureCode}`);
  return parts.join("｜");
}

/** `memory/log.md` 的一段。格式与 Python `campaign.record_run` 对齐。 */
export function formatLogEntry(facts: CampaignFacts, locator: string, now: Date): string {
  const label = facts.questionId === null ? "q-" : `q${facts.questionId}`;
  return (
    `\n## [${now.toISOString().slice(0, 10)}] run | ${label} | ${verdictOf(facts.status)}\n` +
    `- ${locator}｜${summarize(facts)}\n`
  );
}

/** `memory/questions/q<id>.md` 的一行。前缀就是 `ENTRY_PREFIX`，读取端据此 grep。 */
export function formatQuestionEntry(facts: CampaignFacts, now: Date): string {
  const stamp = `${now.toISOString().slice(0, 19)}Z`;
  return `${ENTRY_PREFIX}${stamp}] ${verdictOf(facts.status)} | run ${facts.runId} | ${summarize(facts)}\n`;
}

function pageSeed(questionId: number): string {
  return (
    `# q${questionId}\n\n` +
    `Science-125 第 ${questionId} 题的跨 run 战役页。**append-only**：由 Harness 在 run 收尾时` +
    "确定性追加一行，旧记录不改写、不删除。\n"
  );
}

/** 读旧内容后原子替换整页，使并发读者不会看到半条追加记录。 */
type AppendResult = { status: "written" | "unavailable"; reason: string | null };

function errorReason(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const code = "code" in error && typeof error.code === "string" ? error.code : null;
    const name = "name" in error && typeof error.name === "string" ? error.name : null;
    if (code && name) return `${name}:${code}`;
    if (code) return code;
    if (name) return name;
  }
  return error instanceof Error ? error.name : "unknown_error";
}

function append(path: string, block: string, seed: string, reportError: (error: unknown) => void): AppendResult {
  let existing = seed;
  try {
    existing = readFileSync(path, "utf8");
  } catch (error) {
    if (!isMissing(error)) {
      reportError(error);
      return { status: "unavailable", reason: errorReason(error) };
    }
  }
  if (existing && !existing.endsWith("\n")) existing += "\n";
  try {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, existing + block, "utf8");
    renameSync(temporary, path);
  } catch (error) {
    reportError(error);
    return { status: "unavailable", reason: errorReason(error) };
  }
  return { status: "written", reason: null };
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/** 战役记忆的读写通道。构造它就是「记忆开」，不构造（传 null）就是消融臂。 */
export class CampaignMemory {
  readonly #dir: string;
  readonly #locate: (runId: string) => string;
  readonly #reportError: (error: unknown) => void;

  constructor(options: {
    /** `memory/` 目录。不存在表示显式停用；存在但不可读写则返回 unavailable。 */
    memoryDir: string;
    /** run 的仓库相对定位符。战役记忆比写它的 checkout 活得久，不能记绝对路径。 */
    locate: (runId: string) => string;
    /** 记忆是旁路，失败不打死 Run，但必须进入可观测通道。 */
    reportError?: (error: unknown) => void;
  }) {
    this.#dir = options.memoryDir;
    this.#locate = options.locate;
    this.#reportError = options.reportError ?? ((error) => console.error("campaign memory failed", error));
  }

  #directoryStatus(): { status: "disabled" | "available" | "unavailable"; reason: string | null } {
    try {
      if (!statSync(this.#dir).isDirectory()) return { status: "unavailable", reason: "memory_dir_not_directory" };
      return { status: "available", reason: null };
    } catch (error) {
      if (isMissing(error)) return { status: "disabled", reason: null };
      this.#reportError(error);
      return { status: "unavailable", reason: errorReason(error) };
    }
  }

  /** 同题最近若干条记录，供新 run 开局避开已知死路。零解析、零模型。 */
  readPriorAttempts(questionId: number | null): CampaignReadResult {
    if (questionId === null) return { status: "not_applicable", entries: [], reason: null };
    const directory = this.#directoryStatus();
    if (directory.status === "disabled") return { status: "disabled", entries: [], reason: null };
    if (directory.status === "unavailable") {
      return { status: "unavailable", entries: [], reason: directory.reason };
    }
    let text: string;
    try {
      text = readFileSync(join(this.#dir, "questions", `q${questionId}.md`), "utf8");
    } catch (error) {
      if (isMissing(error)) return { status: "empty", entries: [], reason: null };
      this.#reportError(error);
      return { status: "unavailable", entries: [], reason: errorReason(error) };
    }
    const entries = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith(ENTRY_PREFIX));
    const limited = entries.slice(-PRIOR_ATTEMPT_LIMIT);
    return { status: limited.length > 0 ? "available" : "empty", entries: limited, reason: null };
  }

  /** run 终态后追加一行。总日志必写，题页在有题号时同步。 */
  recordRun(facts: CampaignFacts, now: Date = new Date()): CampaignWriteResult {
    const directory = this.#directoryStatus();
    if (directory.status === "disabled") return { status: "disabled", reason: null };
    if (directory.status === "unavailable") return { status: "unavailable", reason: directory.reason };

    let locator: string;
    try {
      locator = this.#locate(facts.runId);
    } catch (error) {
      this.#reportError(error);
      return { status: "unavailable", reason: errorReason(error) };
    }

    const results = [append(join(this.#dir, "log.md"), formatLogEntry(facts, locator, now), "", this.#reportError)];
    if (facts.questionId !== null) {
      results.push(
        append(
          join(this.#dir, "questions", `q${facts.questionId}.md`),
          formatQuestionEntry(facts, now),
          pageSeed(facts.questionId),
          this.#reportError,
        ),
      );
    }
    const failed = results.filter((result) => result.status === "unavailable");
    if (failed.length > 0) {
      return { status: "unavailable", reason: failed.map((result) => result.reason ?? "unknown_error").join(",") };
    }
    return { status: "written", reason: null };
  }
}
