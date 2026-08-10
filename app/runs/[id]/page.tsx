import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Curl } from "@/components/Curl";
import { Markdown } from "@/components/Markdown";
import { Monitor } from "@/components/Monitor";
import { PapersIndex } from "@/components/PapersIndex";
import { Spine } from "@/components/Spine";
import { type Tab, Tabs } from "@/components/Tabs";
import { Verdicts } from "@/components/Verdicts";
import { VerifyTable } from "@/components/VerifyTable";
import { EmptyState, Kv, Pill } from "@/components/ui";
import { STATUS_LABEL, STATUS_TONE, fmtDur, fmtTime } from "@/lib/format";
import { activeRunId } from "@/lib/lock";
import { NODE_BY_KEY, resolveArtifact } from "@/lib/nodes";
import { isRunId } from "@/lib/runId";
import { scanRun } from "@/lib/phase";
import { readArtifactFrom, readRunFrom } from "@/lib/runs";
import type { NodeKey } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * kind:"json" 工件的面板：缩进即可读性，套 <Markdown> 只会把 JSON 揉成一段。
 * 解析失败退回原文 —— 工件是模型写的，一个裸 JSON.parse 抛出去就是整页 500，
 * 而「JSON 写坏了」恰恰是最该被看见的一种内容。
 */
function JsonArtifact({ source }: { source: string }) {
  let body = source;
  try {
    body = JSON.stringify(JSON.parse(source), null, 2);
  } catch {
    /* 原样显示 */
  }
  return (
    <pre className="overflow-x-auto border border-line bg-panel-2 p-3 text-[11.5px] leading-relaxed">
      <code>{body}</code>
    </pre>
  );
}

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isRunId(id)) notFound();
  // 目录只扫这一次：详情与下面每个 tab 的工件原文都从同一个 Scan 里取
  const scan = scanRun(id);
  if (!scan) notFound();
  const run = readRunFrom(scan, activeRunId());

  // 「有没有这个工件」与「?artifact= 能取哪些」是同一个集合，不再各存一份
  const artifacts = new Set(run.artifactNames);
  const has = (name: string) => artifacts.has(name);
  const md = (name: string) => readArtifactFrom(scan, name) ?? "";

  const h = await headers();
  const base = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;

  const proposalPanel = has("proposal.md") ? (
    <Markdown source={md("proposal.md")} />
  ) : run.proposalRejected ? (
    <div className="space-y-2">
      <div className="border border-danger/50 bg-danger-soft px-3 py-2 text-[12px] text-danger">
        proposal.json 未通过 10 字段契约，run.ts 因此跳过了 Markdown 渲染。下面是被打回的原文。
      </div>
      <pre className="max-h-[32rem] overflow-auto border border-line bg-panel-2 p-2 text-[11.5px] leading-relaxed">
        <code>{run.proposalRejected}</code>
      </pre>
      {run.logTail.length > 0 ? (
        <details className="border border-line">
          <summary className="cursor-pointer bg-panel-2 px-2 py-1 text-[11px] text-muted">
            schema 错误提示（console.log 末尾）
          </summary>
          <pre className="max-h-64 overflow-auto p-2 text-[11.5px]">
            <code>{run.logTail.join("\n")}</code>
          </pre>
        </details>
      ) : null}
    </div>
  ) : (
    <EmptyState title="尚无研究计划" hint="proposal.json / proposal.md 都未产出" />
  );

  /**
   * 节点工件面板全部由注册表派生：标签 id、渲染形态、以及工件改名后老 run 的回退路径，
   * 都不在这里第二次写死（2026-08-08 的 critique.md → critique.json 就是这么漏掉的）。
   * proposal 与 verify 不走这里 —— 它们的面板是派生视图而非工件原文，见下。
   */
  const nodeTab = (key: NodeKey): Tab => {
    const spec = NODE_BY_KEY[key];
    const found = resolveArtifact(spec, has);
    return {
      id: spec.tabId,
      label: spec.tabId,
      disabled: found === null,
      content:
        found === null ? (
          <EmptyState title={`未产出 ${spec.artifact}`} />
        ) : found.kind === "json" ? (
          <JsonArtifact source={md(found.file)} />
        ) : (
          <Markdown source={md(found.file)} />
        ),
    };
  };

  const tabs: Tab[] = [
    ...(run.failedText
      ? [{ id: "failed", label: "FAILED", tone: "danger" as const, content: <Markdown source={run.failedText} /> }]
      : []),
    nodeTab("literature"),
    nodeTab("hypothesis"),
    nodeTab("critique"),
    {
      // 计划节点的工件是 proposal.json，但这里端的是 run.ts 确定性渲染出的 proposal.md
      id: NODE_BY_KEY.proposal.tabId,
      label: NODE_BY_KEY.proposal.tabId,
      disabled: !has("proposal.md") && !run.proposalRejected,
      content: proposalPanel,
    },
    {
      id: "verdicts",
      label: `verdicts (${run.verdicts.length})`,
      disabled: run.verdicts.length === 0,
      content: <Verdicts verdicts={run.verdicts} />,
    },
    {
      // 验收报告不按 markdown 端出去：结论要能分组、能统计，那需要解析后的结构
      id: NODE_BY_KEY.verify.tabId,
      label: NODE_BY_KEY.verify.tabId,
      // 报告没落盘、也解析不出结构 ⇒ 与别的未产出工件一样灰显
      disabled: run.verify === null && !has(NODE_BY_KEY.verify.artifact),
      content: <VerifyTable report={run.verify} runId={id} />,
    },
    {
      id: "papers",
      label: `papers (${run.papers.length})`,
      disabled: run.papers.length === 0,
      content: <PapersIndex papers={run.papers} runId={id} />,
    },
  ];

  const initial = run.failedText ? "failed" : has("proposal.md") ? "proposal" : undefined;

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/runs" className="text-[12px] text-muted hover:text-accent">
            ← 历史
          </Link>
          {/* 这一页讲的是这一次 run，标题就该是它的 id——论文标题是产物，降一级 */}
          <h1 className="text-[15px]">{id}</h1>
          <Pill tone={STATUS_TONE[run.status]}>{STATUS_LABEL[run.status]}</Pill>
          {run.domain ? <Pill>{run.domain}</Pill> : null}
          {run.science125Id ? <Pill title="Science-125 题号">#{run.science125Id}</Pill> : null}
          {run.verify ? (
            <Pill tone={run.verify.pass ? "accent" : "danger"}>验收 {run.verify.result}</Pill>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-muted">
          <Kv k="开始" v={fmtTime(run.startedAt)} />
          <Kv k="结束" v={fmtTime(run.finishedAt)} />
          <Kv k="耗时" v={fmtDur(run.durationSec)} />
          <Kv k="引用" v={run.proposal ? `${run.proposal.references.length} 条` : "—"} />
        </div>

        {run.proposal ? (
          <h2 className="prose-body max-w-4xl text-[15px] leading-snug">{run.proposal.paperTitle}</h2>
        ) : null}

        <details className="border border-line bg-panel">
          <summary className="cursor-pointer px-2 py-1 text-[11px] text-muted">问题原文 · 本 run 的 curl</summary>
          <div className="space-y-2 p-2">
            <pre className="prose-body overflow-x-auto text-[13px] whitespace-pre-wrap">
              <code>{run.questionText || "（无 question.md）"}</code>
            </pre>
            <Curl
              cmds={[
                { label: "状态（轻量）", cmd: `curl -s '${base}/api/runs/${id}?view=status'` },
                { label: "完整详情", cmd: `curl -s ${base}/api/runs/${id}` },
                { label: "工件原文", cmd: `curl -s '${base}/api/runs/${id}?artifact=proposal.md'` },
                { label: "本地独立验收", cmd: `pnpm verify runs/${id}` },
              ]}
            />
            <div className="text-[11px] text-faint">
              可取工件（{run.artifactNames.length}）：{run.artifactNames.join(" · ")}
            </div>
          </div>
        </details>

        {run.status === "stale" ? (
          <div className="border border-line bg-panel-2 px-3 py-2 text-[12px] text-muted">
            该 run 未走到终点（进程中断）。已有工件照常展示，缺的标签灰显。
          </div>
        ) : null}
        {run.failedText ? (
          <div className="border border-danger/50 bg-danger-soft px-3 py-2 text-[12px] text-danger">
            pipeline 判定失败并写下 FAILED.md —— 如实报失败是设计的一部分，不是异常。
          </div>
        ) : null}
      </header>

      <div className={`grid gap-4 ${run.status === "running" ? "" : "md:grid-cols-[13rem_minmax(0,1fr)]"}`}>
        {run.status === "running" ? null : (
          <aside className="md:sticky md:top-4 md:self-start">
            <div className="mb-2 text-[11px] tracking-wide text-muted uppercase">reasoning spine</div>
            <Spine nodes={run.nodes} />
          </aside>
        )}

        <div className="min-w-0 space-y-3">
          {run.status === "running" ? <Monitor runId={id} initial={run} /> : null}
          <Tabs tabs={tabs} initial={initial} />
        </div>
      </div>
    </div>
  );
}
