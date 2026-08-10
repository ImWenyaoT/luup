import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Panel } from "@/components/Common/Panel"
import { ErrorBox, Loading } from "@/components/Common/States"
import { RunsTable } from "@/components/Runs/RunsTable"
import { runsQueryOptions } from "@/queries"

export const Route = createFileRoute("/_layout/runs/")({
  component: RunsPage,
})

function RunsPage() {
  const runs = useQuery(runsQueryOptions)
  if (runs.error)
    return (
      <div className="pt-6">
        <ErrorBox error={runs.error} retry={() => void runs.refetch()} />
      </div>
    )
  if (!runs.data)
    return (
      <div className="pt-6">
        <Loading />
      </div>
    )
  const data = runs.data
  return (
    <div className="pt-6">
      <Panel
        title="运行历史"
        right={
          data.active ? (
            <Link
              to="/runs/$runId"
              params={{ runId: data.active }}
              className="hover:text-primary"
            >
              活跃 {data.active} →
            </Link>
          ) : (
            "无活跃 run"
          )
        }
      >
        {data.runs.length ? (
          <RunsTable runs={data.runs} />
        ) : (
          <Loading label="尚无运行" />
        )}
      </Panel>
    </div>
  )
}
