import type { NextRequest } from "next/server";
import { fail, json, text } from "@/lib/http";
import { BoundaryError } from "@/lib/paths";
import { isRunId } from "@/lib/runId";
import { readArtifact, readRun, readStatusView } from "@/lib/runs";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isRunId(id)) return fail(400, "bad_run_id", "runId 必须形如 20260808-062829");

  const sp = request.nextUrl.searchParams;
  const artifact = sp.get("artifact");

  try {
    if (artifact !== null) {
      const body = readArtifact(id, artifact);
      if (body === null) return fail(404, "artifact_not_found", `工件不存在或不可读：${artifact}`);
      return text(body);
    }
    if (sp.get("view") === "status") {
      const view = readStatusView(id);
      if (!view) return fail(404, "run_not_found", `run 目录不存在：${id}`);
      return json(view);
    }
    const detail = readRun(id);
    if (!detail) return fail(404, "run_not_found", `run 目录不存在：${id}`);
    return json(detail);
  } catch (e) {
    if (e instanceof BoundaryError) return fail(400, "path_escape", "路径越界");
    throw e;
  }
}
