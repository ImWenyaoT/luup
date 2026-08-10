import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Panel } from "@/components/Common/Panel"
import { ErrorBox, Loading } from "@/components/Common/States"
import { ApiExamples } from "@/components/Runs/ApiExamples"
import { MiniSpine } from "@/components/Runs/Spine"
import { StatusPill, verifyClass } from "@/components/Runs/StatusBadge"
import { Picker } from "@/components/Science125/Picker"
import { fmtDur } from "@/format"
import { cn } from "@/lib/utils"
import { runsQueryOptions, science125QueryOptions } from "@/queries"

export const Route = createFileRoute("/_layout/")({
  component: Dashboard,
})

function Dashboard() {
  const science = useQuery(science125QueryOptions)
  const runs = useQuery(runsQueryOptions)
  const error = science.error ?? runs.error
  if (error)
    return (
      <div className="pt-6">
        <ErrorBox
          error={error}
          retry={() => {
            void science.refetch()
            void runs.refetch()
          }}
        />
      </div>
    )
  if (!science.data || !runs.data)
    return (
      <div className="pt-6">
        <Loading />
      </div>
    )

  const runData = runs.data
  const passed = runData.runs.filter((run) => run.verify === "pass").length
  return (
    <div className="grid gap-6 pt-6">
      <section className="flex flex-wrap items-center gap-3 border bg-card px-3 py-2 md:gap-6">
        <div>
          <div className="text-[11px] uppercase text-muted-foreground">
            runs
          </div>
          <strong className="text-xl font-normal">{runData.runs.length}</strong>
        </div>
        <div className="min-w-32 flex-1">
          <span className="flex justify-between text-[11px] text-muted-foreground">
            通过独立验收{" "}
            <b className="font-normal text-foreground">
              {passed}/{runData.runs.length}
            </b>
          </span>
          <i className="mt-1 block h-1 bg-border">
            <em
              className="block h-full bg-primary"
              style={{
                width: `${runData.runs.length ? (passed / runData.runs.length) * 100 : 0}%`,
              }}
            />
          </i>
        </div>
        <div className="min-w-56 flex-1 text-[11px] text-muted-foreground max-md:basis-full">
          {runData.active ? (
            <Link to="/runs/$runId" params={{ runId: runData.active }}>
              活跃 run <b className="text-primary">{runData.active}</b> ·
              点击查看实时 spine
            </Link>
          ) : (
            "无活跃 run · pipeline 串行，一次只跑一个"
          )}
        </div>
      </section>

      <Panel
        title="选题 · Science-125"
        right={`${science.data.total} 题 / ${science.data.domains.length} 学科`}
      >
        <Picker science={science.data} active={runData.active} />
      </Panel>

      <Panel
        title="最近的 run"
        right={
          <Link to="/runs" className="hover:text-primary">
            全部历史 →
          </Link>
        }
      >
        {runData.runs.length === 0 ? (
          <Loading label="尚无运行" />
        ) : (
          <ul>
            {runData.runs.slice(0, 8).map((run) => (
              <li key={run.id} className="border-b">
                <Link
                  to="/runs/$runId"
                  params={{ runId: run.id }}
                  className="flex items-center gap-3 py-1.5 max-md:flex-wrap max-md:items-start"
                >
                  <StatusPill status={run.status} />
                  <code className="w-36">{run.id}</code>
                  <MiniSpine nodes={run.nodes} />
                  <span className="min-w-0 flex-1 truncate font-sans text-[13px] max-md:order-5 max-md:basis-full max-md:whitespace-normal">
                    {run.question}
                  </span>
                  <small className="text-[11px] text-muted-foreground">
                    refs {run.refs ?? "—"}
                  </small>
                  <small className={cn("text-[11px]", verifyClass(run.verify))}>
                    {run.verify === "pass"
                      ? "ALL PASS"
                      : run.verify === "fail"
                        ? "FAIL"
                        : "未验收"}
                  </small>
                  <small className="text-[11px] text-muted-foreground">
                    {fmtDur(run.durationSec)}
                  </small>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel id="api" title="可调用测试 API" right={window.location.origin}>
        <ApiExamples
          sample={
            runData.runs.find((run) => run.status === "passed")?.id ??
            runData.runs[0]?.id ??
            "20260808-062829"
          }
        />
      </Panel>
    </div>
  )
}
