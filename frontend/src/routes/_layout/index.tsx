import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Section } from "@/components/Common/Section"
import { EmptyState, ErrorBox, PageSkeleton } from "@/components/Common/States"
import { ApiExamples } from "@/components/Runs/ApiExamples"
import { MiniSpine } from "@/components/Runs/Spine"
import { StatusPill, verifyClass } from "@/components/Runs/StatusBadge"
import { Picker } from "@/components/Science125/Picker"
import { fmtDur } from "@/format"
import { cn } from "@/lib/utils"
import { runsQueryOptions, science125QueryOptions } from "@/queries"
import type { RunSummary } from "@/types"

export const Route = createFileRoute("/_layout/")({
  component: Dashboard,
})

const verifyLabel = (verify: RunSummary["verify"]) =>
  verify === "pass" ? "ALL PASS" : verify === "fail" ? "FAIL" : "未验收"

function Dashboard() {
  const science = useQuery(science125QueryOptions)
  const runs = useQuery(runsQueryOptions)
  const error = science.error ?? runs.error
  if (error)
    return (
      <div className="py-10">
        <ErrorBox
          error={error}
          retry={() => {
            void science.refetch()
            void runs.refetch()
          }}
        />
      </div>
    )
  if (!science.data || !runs.data) return <PageSkeleton />

  const runData = runs.data
  const total = runData.runs.length
  const passed = runData.runs.filter((run) => run.verify === "pass").length

  return (
    <div className="flex flex-col gap-12 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-medium tracking-tight">仪表台</h1>
        <p className="max-w-[68ch] text-base">
          <span className="font-medium tabular-nums">{passed}</span>
          <span className="text-muted-foreground"> / </span>
          <span className="font-medium tabular-nums">{total}</span>{" "}
          次运行通过独立验收
          {total ? (
            <span className="text-muted-foreground">
              （{Math.round((passed / total) * 100)}%）
            </span>
          ) : null}
        </p>
        <p className="max-w-[68ch] text-[13px] text-muted-foreground">
          pipeline 串行，一次只跑一个。
          {runData.active ? (
            <>
              {" "}
              当前活跃{" "}
              <Link
                to="/runs/$runId"
                params={{ runId: runData.active }}
                className="font-mono text-primary underline-offset-4 hover:underline"
              >
                {runData.active}
              </Link>
              ，可查看实时 spine。
            </>
          ) : (
            "当前无活跃 run。"
          )}
        </p>
      </header>

      <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start gap-12">
        <Section
          title="选题 · Science-125"
          meta={`${science.data.total} 题 / ${science.data.domains.length} 学科`}
        >
          <Picker science={science.data} active={runData.active} />
        </Section>

        <Section
          title="最近的 run"
          meta={
            <Link
              to="/runs"
              className="-my-2 inline-flex items-center py-2 underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              全部历史 →
            </Link>
          }
        >
          {total === 0 ? (
            <EmptyState
              title="尚无运行"
              description="从左边选一题并触发 pipeline。"
            />
          ) : (
            <ul className="flex flex-col">
              {runData.runs.slice(0, 8).map((run) => (
                <li key={run.id} className="border-b last:border-b-0">
                  <Link
                    to="/runs/$runId"
                    params={{ runId: run.id }}
                    className="-mx-2 flex flex-col gap-1 rounded-sm px-2 py-2.5 transition-colors hover:bg-accent/60 active:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                  >
                    <span className="flex items-center gap-2">
                      <StatusPill status={run.status} />
                      <span className="font-mono text-[13px]">{run.id}</span>
                      <MiniSpine nodes={run.nodes} />
                      <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                        {fmtDur(run.durationSec)}
                      </span>
                    </span>
                    <span className="flex items-baseline gap-3">
                      <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                        {run.question}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-xs",
                          verifyClass(run.verify),
                        )}
                      >
                        {verifyLabel(run.verify)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section
        id="api"
        title="可调用测试 API"
        meta={<span className="font-mono">{window.location.origin}</span>}
      >
        <ApiExamples
          sample={
            runData.runs.find((run) => run.status === "passed")?.id ??
            runData.runs[0]?.id ??
            "20260808-062829"
          }
        />
      </Section>
    </div>
  )
}
