import type { NextRequest } from "next/server";
import { fail, json } from "@/lib/http";
import { acquire, release } from "@/lib/lock";
import { activeRun, listRuns } from "@/lib/runs";
import { readRunsIndex } from "@/lib/runsIndex";
import { findQuestion } from "@/lib/science125";
import { freeformText, science125Text, startRun } from "@/lib/spawn";

export const dynamic = "force-dynamic";

const MAX_BODY = 4 * 1024;

export function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("limit");
  const parsed = raw === null ? 50 : Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    return fail(400, "bad_limit", "limit 必须是 1..500 的整数");
  }
  // 派生缓存优先；缺失/损坏/过期时 readRunsIndex 返回 null，退回全量扫盘
  return json({ active: activeRun(), runs: readRunsIndex(parsed) ?? listRuns(parsed) });
}

/**
 * 无鉴权的本地工具，但 POST 会起一个 10~20 分钟的付费子进程——必须挡住跨站触发。
 * 两道：① 强制 application/json（HTML form 发不出这个类型，跨源 fetch 会被迫预检，
 * 而本路由不返 CORS 头，预检必失败）；② Origin 存在时必须与 Host 同源。
 */
function crossSite(request: NextRequest): Response | null {
  const ct = request.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().split(";")[0].trim().startsWith("application/json")) {
    return fail(415, "bad_content_type", "content-type 必须是 application/json");
  }
  const origin = request.headers.get("origin");
  if (origin === null) return null;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return fail(403, "cross_site", "Origin 不可解析");
  }
  return host === request.headers.get("host") ? null : fail(403, "cross_site", "跨站请求被拒绝");
}

export async function POST(request: NextRequest) {
  const blocked = crossSite(request);
  if (blocked) return blocked;

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY) {
    return fail(413, "body_too_large", `请求体超过 ${MAX_BODY} 字节`);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw || "null");
  } catch {
    return fail(400, "bad_json", "请求体不是合法 JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail(400, "bad_body", "请求体必须是 JSON 对象");
  }

  const { question, science125Id } = body as { question?: unknown; science125Id?: unknown };
  const hasQuestion = question !== undefined && question !== null && question !== "";
  const hasId = science125Id !== undefined && science125Id !== null;
  if (hasQuestion === hasId) {
    return fail(400, "bad_input", "question 与 science125Id 必须给且只给一个");
  }

  let text: string;
  let questionId: number | null = null;

  if (hasId) {
    const id = typeof science125Id === "number" ? science125Id : Number.NaN;
    if (!Number.isInteger(id) || id < 1 || id > 125) {
      return fail(400, "bad_science125_id", "science125Id 必须是 1..125 的整数");
    }
    const q = findQuestion(id);
    if (!q) return fail(404, "question_not_found", `fixtures/science125.json 里没有第 ${id} 题`);
    text = science125Text(q);
    questionId = id;
  } else {
    if (typeof question !== "string") return fail(400, "bad_question", "question 必须是字符串");
    const trimmed = question.trim();
    if (trimmed.length < 8 || trimmed.length > 2000) {
      return fail(400, "bad_question_length", "question 长度必须在 8..2000 之间");
    }
    // run.ts 的 readQuestion 会把「不含空白且存在」的字符串当文件路径读——直接拒掉这种形状
    if (/^\S+$/.test(trimmed)) {
      return fail(400, "bad_question_shape", "question 不能是单个无空白 token（会被当成文件路径）");
    }
    text = freeformText(trimmed);
  }

  const lock = acquire();
  if (!lock.ok) {
    return fail(409, "run_in_progress", "已有运行中的 run，pipeline 串行执行", {
      activeRunId: lock.held.runId,
    });
  }

  try {
    const { runId, runDir } = await startRun(text, questionId);
    return json(
      { runId, runDir, status: "running", pollUrl: `/api/runs/${runId}?view=status` },
      202,
    );
  } catch (e) {
    // 归属释放：startRun 内部可能已经放过一次，这里的补偿不能误删下一个 run 的锁
    release({ pid: process.pid, runId: null });
    return fail(500, "spawn_failed", e instanceof Error ? e.message : String(e));
  }
}
