import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useCallback, useState } from "react"
import { ErrorBox, Loading } from "@/components/Common/States"
import { ApiExamples } from "@/components/Runs/ApiExamples"
import { Monitor } from "@/components/Runs/Monitor"
import { artifactForTab, TabContent } from "@/components/Runs/RunTabs"
import { Spine } from "@/components/Runs/Spine"
import { Pill, StatusPill } from "@/components/Runs/StatusBadge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { displayNodes, fmtDur, fmtTime, tabForNode } from "@/format"
import { cn } from "@/lib/utils"
import { runDetailQueryOptions } from "@/queries"
import type { RunDetail } from "@/types"

export const Route = createFileRoute("/_layout/runs/$runId")({
  component: RunDetailPage,
})

function RunDetailPage() {
  const { runId } = Route.useParams()
  const queryClient = useQueryClient()
  const detail = useQuery(runDetailQueryOptions(runId))
  const reload = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: runDetailQueryOptions(runId).queryKey,
    })
  }, [queryClient, runId])

  if (detail.error)
    return (
      <div className="pt-6">
        <ErrorBox error={detail.error} retry={() => void detail.refetch()} />
      </div>
    )
  if (!detail.data)
    return (
      <div className="pt-6">
        <Loading />
      </div>
    )
  return <RunDetailView key={runId} run={detail.data} reload={reload} />
}

function RunDetailView({
  run,
  reload,
}: {
  run: RunDetail
  reload: () => void
}) {
  const artifacts = new Set(run.artifactNames)
  const nodes = displayNodes(run.nodes)
  const [active, setActive] = useState<string>(
    run.failedText
      ? "failed"
      : artifactForTab("proposal", artifacts)
        ? "proposal"
        : "evidence",
  )
  const entries: { id: string; label: string; disabled?: boolean }[] = [
    ...(run.failedText ? [{ id: "failed", label: "FAILED" }] : []),
    {
      id: "evidence",
      label: "evidence",
      disabled: !artifactForTab("evidence", artifacts),
    },
    {
      id: "proposal",
      label: "proposal",
      disabled: !artifactForTab("proposal", artifacts) && !run.proposalRejected,
    },
    {
      id: "review",
      label: "review",
      disabled: !artifactForTab("review", artifacts),
    },
    {
      id: "verification",
      label: "verification",
      disabled: !run.verify && !artifactForTab("verification", artifacts),
    },
    {
      id: "verdicts",
      label: `verdicts (${run.verdicts.length})`,
      disabled: !run.verdicts.length,
    },
    {
      id: "papers",
      label: `papers (${run.papers.length})`,
      disabled: !run.papers.length,
    },
    ...(["hypotheses", "critique"] as const).map((id) => ({
      id,
      label: id,
      disabled: !artifactForTab(id, artifacts),
    })),
  ]
  const working = run.status === "working"

  return (
    <div
      className="grid gap-3 pt-6"
      data-testid="run-detail"
      data-run-id={run.id}
    >
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/runs" className="hover:text-primary">
            ← 历史
          </Link>
          <h1 className="text-[15px] font-normal" data-testid="run-id">
            {run.id}
          </h1>
          <StatusPill status={run.status} testId="run-status" />
          {run.domain ? <Pill>{run.domain}</Pill> : null}
          {run.science125Id ? <Pill>#{run.science125Id}</Pill> : null}
          {run.verify ? (
            <Pill tone={run.verify.pass ? "good" : "bad"} testId="run-verify">
              验收 {run.verify.result}
            </Pill>
          ) : null}
        </div>
        <p className="text-[11px] text-muted-foreground">
          开始 {fmtTime(run.startedAt)}　结束 {fmtTime(run.finishedAt)}　耗时{" "}
          {fmtDur(run.durationSec)}　引用{" "}
          {run.proposal?.references.length ?? "—"}
        </p>
        {run.proposal ? (
          <h2 className="font-sans text-[15px] font-medium">
            {run.proposal.paperTitle}
          </h2>
        ) : null}
        <details className="border bg-card px-2 py-1.5 text-[11px] text-muted-foreground">
          <summary className="cursor-pointer">
            问题原文 · 本 run 的 curl
          </summary>
          <pre className="whitespace-pre-wrap font-sans text-[13px] text-foreground">
            {run.questionText || "（无 question.md）"}
          </pre>
          <ApiExamples sample={run.id} />
          <small>
            可取工件（{run.artifactNames.length}）：
            {run.artifactNames.join(" · ")}
          </small>
        </details>
        {run.status === "failed" ? (
          <div className="border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            该 run 未走到终点。已有工件照常展示，缺的标签灰显。
          </div>
        ) : null}
        {run.failedText ? (
          <div className="border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            pipeline 判定失败并写下 FAILED.md —— 如实报失败是设计的一部分。
          </div>
        ) : null}
      </header>

      <div
        className={cn(
          "grid gap-4",
          !working && "md:grid-cols-[208px_minmax(0,1fr)]",
        )}
      >
        {working ? (
          <Monitor id={run.id} initial={run} done={reload} />
        ) : (
          <Spine
            className="self-start max-md:hidden md:sticky md:top-4"
            nodes={nodes}
            select={(node) => {
              const tab = tabForNode(node)
              if (tab) setActive(tab)
            }}
          />
        )}
        <Tabs value={active} onValueChange={setActive}>
          <TabsList className="h-auto flex-wrap">
            {entries.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} disabled={tab.disabled}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent
            value={active}
            className="min-h-44 border bg-card p-3"
            data-testid="tab-content"
          >
            <TabContent tab={active} run={run} artifacts={artifacts} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
