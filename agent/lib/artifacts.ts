/**
 * Run 工件的读写与路径 jail（architecture.md「handoff 工件」/「memory 布局」）。
 *
 * 工件面（master 唯一的落盘通道）：
 *   runs/<ts>/evidence.md        L 的事实卡片
 *   runs/<ts>/hypotheses.md      H 的候选假设
 *   runs/<ts>/critique.json      C 的批判（写入即校验 CritiqueSchema）
 *   runs/<ts>/proposal.json      W 的 10 字段计划（写入即校验 ProposalSchema）
 *   runs/<ts>/verdicts/*.json    master 每轮认证（写入即校验 VerdictSchema）
 *   runs/<ts>/memory/rejected.md 负结果记忆
 *   runs/<ts>/FAILED.md          预算耗尽时的失败报告
 *
 * 三条硬约束（机制层，不靠 prompt）：
 *  1. **jail**：一切路径相对 LUUP_RUN_DIR 解析；绝对路径、`..`、NUL 一律拒绝，
 *     解析后再确认仍在 run 目录内（防符号写法绕过）。
 *  2. **保护区**：`memory/papers/**` 与 `memory/index.md` 只允许 arxiv_save 经由
 *     paperStore 写入。若模型能自由写这两处，就能伪造「本次运行实检命中」的文献，
 *     verify_references 的 B1 当场失效 —— 这是引用真实性防线的地基。
 *  3. **fail-closed 结构化**：`critique.json`、`proposal.json` 与 `verdicts/*.json` 写入前
 *     按契约校验，不合法拒写（草稿另存 `<name>.rejected.json` 保留失败证据链）。
 *  4. **返工预算**：`verdicts/*.json` 过了契约校验还要过 `lib/rework.ts` 的准入 ——
 *     第 4 轮直接拒写。轮数上限从此是代码的事，不是 master 在提示词里自己数的事
 *     （eval#1 的事故正是它数错了）。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { NODE_BY_KEY } from "../../lib/nodes.ts";
import {
  type NodeBudget,
  type ReworkCap,
  type ReworkNode,
  admitVerdict,
  readVerdictEvidence,
  reworkBudget,
} from "../../lib/rework.ts";
import { CritiqueSchema, ProposalSchema, ReviewSchema, VerdictSchema } from "#lib/contracts.ts";
import { resolveRunDir } from "./runContext.ts";

export class ArtifactPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactPathError";
  }
}

/** 只有 paperStore 能写的区域（见文件头约束 2）。比较用小写，见 resolveArtifactPath。 */
const PROTECTED_KEYS = [`memory${sep}papers`, `memory${sep}index.md`].map((p) => p.toLowerCase());

const VERDICTS_DIR = "verdicts";

/** run 目录里的 verdict 工件（`verdicts/<node>-r<round>.json`）——契约与返工预算都认它。 */
const isVerdictArtifact = (rel: string): boolean => rel.startsWith(`${VERDICTS_DIR}${sep}`) && rel.endsWith(".json");

/**
 * 写入即按契约校验的工件。工件名本身仍取自 `lib/nodes.ts` 的注册表（那是单一事实源，
 * 2026-08-08 `critique.md` → `critique.json` 就是漏改这一侧漏出来的），这张表只多挂
 * 一个 zod schema —— 不合并进注册表，是因为注册表要能进客户端 bundle，而 schema 不能。
 * 注册表本身没有运行时依赖（只有常量），import 它是安全的。
 */
const SCHEMA_GUARDS: Array<{
  test: (rel: string) => boolean;
  name: string;
  schema: typeof ProposalSchema | typeof VerdictSchema | typeof CritiqueSchema | typeof ReviewSchema;
}> = [
  { test: (rel) => rel === NODE_BY_KEY.proposal.artifact, name: "ProposalSchema", schema: ProposalSchema },
  { test: (rel) => rel === "review.json", name: "ReviewSchema", schema: ReviewSchema },
  { test: (rel) => rel === NODE_BY_KEY.critique.artifact, name: "CritiqueSchema", schema: CritiqueSchema },
  { test: isVerdictArtifact, name: "VerdictSchema", schema: VerdictSchema },
];

/**
 * 把模型给的相对路径收敛成 run 目录内的绝对路径。
 * @returns `{ abs, rel }`，`rel` 用平台分隔符，便于与保护区前缀比较。
 */
export function resolveArtifactPath(relPath: string, runDir = resolveRunDir()): { abs: string; rel: string } {
  const raw = String(relPath ?? "").trim();
  if (!raw) throw new ArtifactPathError("路径为空");
  if (raw.includes("\0")) throw new ArtifactPathError("路径含非法字符");
  if (raw.startsWith("~")) throw new ArtifactPathError(`拒绝 home 相对路径：${raw}`);
  if (isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw)) {
    throw new ArtifactPathError(`拒绝绝对路径：${raw}（工件路径必须相对本 run 目录）`);
  }
  const segments = raw.split(/[\\/]+/).filter((s) => s !== "" && s !== ".");
  if (segments.length === 0) throw new ArtifactPathError("路径为空");
  if (segments.includes("..")) throw new ArtifactPathError(`拒绝越级路径：${raw}`);

  const base = resolve(runDir);
  const abs = resolve(base, segments.join(sep));
  if (abs !== base && !abs.startsWith(base + sep)) {
    throw new ArtifactPathError(`路径逃逸 run 目录：${raw}`);
  }

  const rel = segments.join(sep);
  // 大小写归一：macOS / Windows 的文件系统不区分大小写，`Memory/Papers/x.md` 会写到
  // 同一个保护区里。前缀比较必须跟着文件系统走，否则保护区在这些平台上形同虚设。
  const relKey = rel.toLowerCase();
  for (const p of PROTECTED_KEYS) {
    if (relKey === p || relKey.startsWith(p + sep)) {
      throw new ArtifactPathError(
        `${rel} 由文献工具（arxiv_save）独占写入，不可手写 —— 引用真实性依赖它。`,
      );
    }
  }
  return { abs, rel };
}

export type ArtifactWriteResult = {
  path: string;
  bytes: number;
  created: boolean;
  /** 命中契约校验的工件名；无则 null */
  validatedAs: string | null;
  ok: boolean;
  /** ok=false 时的校验错误（每条 `字段: 说明`） */
  issues: string[];
  /** ok=false 时草稿的留存路径 */
  draftPath?: string;
  /** verdict 写入才有：该节点的返工余额（写入后的实况）。 */
  budget?: NodeBudget;
  /** 被返工预算拒写时，管事的那条上限。schema 校验失败不设它。 */
  deniedBy?: ReworkCap;
};

/**
 * 写一个工件。契约工件不合法时**拒写**，草稿另存 `.rejected.json`；
 * verdict 还要再过一道返工预算（超轮次拒写，且**不留草稿** —— 草稿会被算成格式重试）。
 */
export function writeArtifact(relPath: string, content: string, runDir = resolveRunDir()): ArtifactWriteResult {
  const { abs, rel } = resolveArtifactPath(relPath, runDir);
  const guard = SCHEMA_GUARDS.find((g) => g.test(rel));
  const verdictsDir = join(resolve(runDir), VERDICTS_DIR);
  /** verdict 写入时由契约校验后的内容给出（`node` 是 schema 保过的枚举）。 */
  let verdictNode: ReworkNode | null = null;

  if (guard) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      const draft = `${abs}.rejected.json`;
      mkdirSync(dirname(draft), { recursive: true });
      writeFileSync(draft, content, "utf8");
      return {
        path: rel,
        bytes: 0,
        created: false,
        validatedAs: guard.name,
        ok: false,
        issues: [`JSON 解析失败: ${String(e)}`],
        draftPath: `${rel}.rejected.json`,
      };
    }
    const result = guard.schema.safeParse(parsed);
    if (!result.success) {
      const draft = `${abs}.rejected.json`;
      mkdirSync(dirname(draft), { recursive: true });
      writeFileSync(draft, content, "utf8");
      return {
        path: rel,
        bytes: 0,
        created: false,
        validatedAs: guard.name,
        ok: false,
        issues: result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
        draftPath: `${rel}.rejected.json`,
      };
    }
    if (isVerdictArtifact(rel)) {
      // 契约过了才轮到预算：格式重试留下的 `.rejected.json` 因此永远不占语义轮
      verdictNode = (result.data as { node: ReworkNode }).node;
      const admission = admitVerdict(readVerdictEvidence(verdictsDir), {
        node: verdictNode,
        file: rel.slice(`${VERDICTS_DIR}${sep}`.length),
      });
      if (!admission.ok) {
        // 不留草稿：草稿会被算作格式重试，一次拒写不该顺手把另一本账也搅浑
        return {
          path: rel,
          bytes: 0,
          created: false,
          validatedAs: guard.name,
          ok: false,
          issues: [admission.error],
          budget: admission.budget,
          deniedBy: admission.governingCap,
        };
      }
    }
  } else if (rel.endsWith(".json")) {
    try {
      JSON.parse(content);
    } catch (e) {
      return {
        path: rel,
        bytes: 0,
        created: false,
        validatedAs: "JSON",
        ok: false,
        issues: [`JSON 解析失败: ${String(e)}`],
      };
    }
  }

  const created = !existsSync(abs);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
  return {
    path: rel,
    bytes: Buffer.byteLength(content, "utf8"),
    created,
    validatedAs: guard?.name ?? null,
    ok: true,
    issues: [],
    // 落盘后重算一次：master 拿到的是「这一轮已经记上了」之后的余额
    ...(verdictNode === null ? {} : { budget: reworkBudget(readVerdictEvidence(verdictsDir))[verdictNode] }),
  };
}

export type ArtifactReadResult =
  | { path: string; kind: "file"; exists: true; content: string; bytes: number }
  | { path: string; kind: "directory"; exists: true; entries: string[] }
  | { path: string; kind: "missing"; exists: false; available: string[] };

/** 读一个工件；路径是目录则列目录，缺失则回列 run 根目录已有条目。 */
export function readArtifact(relPath: string, runDir = resolveRunDir()): ArtifactReadResult {
  const { abs, rel } = resolveArtifactPath(relPath, runDir);
  if (!existsSync(abs)) {
    return { path: rel, kind: "missing", exists: false, available: listArtifacts(runDir) };
  }
  if (statSync(abs).isDirectory()) {
    return {
      path: rel,
      kind: "directory",
      exists: true,
      entries: readdirSync(abs).sort((a, b) => a.localeCompare(b)),
    };
  }
  const content = readFileSync(abs, "utf8");
  return { path: rel, kind: "file", exists: true, content, bytes: Buffer.byteLength(content, "utf8") };
}

/** run 根目录下的工件清单（含 verdicts/ 内条目），供 master 定位与失败报告用。 */
export function listArtifacts(runDir = resolveRunDir()): string[] {
  const base = resolve(runDir);
  if (!existsSync(base)) return [];
  const out: string[] = [];
  for (const name of readdirSync(base).sort((a, b) => a.localeCompare(b))) {
    if (name === "memory") continue;
    const p = join(base, name);
    if (statSync(p).isDirectory()) {
      for (const child of readdirSync(p).sort((a, b) => a.localeCompare(b))) out.push(`${name}/${child}`);
    } else {
      out.push(name);
    }
  }
  if (existsSync(join(base, "memory", "rejected.md"))) out.push("memory/rejected.md");
  return out;
}
