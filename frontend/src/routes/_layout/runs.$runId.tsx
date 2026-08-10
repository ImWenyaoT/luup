import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowLeftIcon } from "lucide-react"
import { useCallback, useState } from "react"
import { ErrorBox, PageSkeleton } from "@/components/Common/States"
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

const TAB_TRIGGER =
  "relative h-9 flex-none rounded-none border-0 bg-transparent px-0 text-[13px] font-normal text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:font-medium data-[state=active]:text-foreground data-[state=active]:shadow-none after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-transparent data-[state=active]:after:bg-foreground disabled:opacity-50"

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
      <div className="py-10">
        <ErrorBox error={detail.error} retry={() => void detail.refetch()} />
      </div>
    )
  if (!detail.data) return <PageSkeleton />
  return <RunDetailView key={runId} run={detail.data} reload={reload} />
}

function Meta({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-[13px]">{children}</dd>
    </div>
  )
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
      className="flex flex-col gap-8 py-10"
      data-testid="run-detail"
      data-run-id={run.id}
    >
      <header className="flex flex-col gap-5">
        <Link
          to="/runs"
          className="-my-2 flex w-fit items-center gap-1.5 py-2 text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ArrowLeftIcon className="size-3.5" />
          历史
        </Link>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1
              className="font-mono text-xl font-medium tracking-tight"
              data-testid="run-id"
            >
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
          {run.proposal ? (
            <h2 className="max-w-[68ch] text-lg leading-snug font-medium tracking-tight">
              {run.proposal.paperTitle}
            </h2>
          ) : null}
        </div>

        <dl className="flex flex-wrap gap-x-10 gap-y-3">
          <Meta label="开始">
            <span className="font-mono">{fmtTime(run.startedAt)}</span>
          </Meta>
          <Meta label="结束">
            <span className="font-mono">{fmtTime(run.finishedAt)}</span>
          </Meta>
          <Meta label="耗时">
            <span className="tabular-nums">{fmtDur(run.durationSec)}</span>
          </Meta>
          <Meta label="引用">
            <span className="tabular-nums">
              {run.proposal?.references.length ?? "—"}
            </span>
          </Meta>
          <Meta label="工件">
            <span className="tabular-nums">{run.artifactNames.length}</span>
          </Meta>
        </dl>

        <details className="group flex flex-col gap-3 border-t pt-4">
          <summary className="w-fit cursor-pointer list-none text-[13px] text-muted-foreground transition-colors hover:text-foreground">
            <span className="inline-block w-4 transition-transform group-open:rotate-90">
              ›
            </span>
            问题原文 · 本 run 的 curl
          </summary>
          <div className="flex flex-col gap-4 pt-3 pl-4">
            <p className="max-w-[68ch] text-sm leading-relaxed whitespace-pre-wrap">
              {run.questionText || "（无 question.md）"}
            </p>
            <ApiExamples sample={run.id} />
            <p className="text-xs text-muted-foreground">
              可取工件：
              <span className="font-mono">{run.artifactNames.join(" · ")}</span>
            </p>
          </div>
        </details>

        {run.status === "failed" ? (
          <p className="text-[13px] text-muted-foreground">
            该 run 未走到终点。已有工件照常展示，缺的标签灰显。
          </p>
        ) : null}
        {run.failedText ? (
          <p className="text-[13px] text-destructive">
            pipeline 判定失败并写下 FAILED.md —— 如实报失败是设计的一部分。
          </p>
        ) : null}
      </header>

      <div
        className={cn(
          "grid gap-10",
          !working && "grid-cols-[224px_minmax(0,1fr)]",
        )}
      >
        {working ? (
          <Monitor id={run.id} initial={run} done={reload} />
        ) : (
          <Spine
            className="self-start sticky top-20"
            nodes={nodes}
            select={(node) => {
              const tab = tabForNode(node)
              if (tab) setActive(tab)
            }}
          />
        )}
        <Tabs value={active} onValueChange={setActive} className="gap-0">
          <TabsList className="h-auto w-full flex-wrap justify-start gap-6 rounded-none border-b bg-transparent p-0">
            {entries.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                disabled={tab.disabled}
                className={TAB_TRIGGER}
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent
            value={active}
            className="min-h-72 pt-5"
            data-testid="tab-content"
          >
            <TabContent tab={active} run={run} artifacts={artifacts} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
