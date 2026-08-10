import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { EmptyState, ErrorBox, PageSkeleton } from "@/components/Common/States"
import { RunsTable } from "@/components/Runs/RunsTable"
import { runsQueryOptions } from "@/queries"

export const Route = createFileRoute("/_layout/runs/")({
  component: RunsPage,
})

function RunsPage() {
  const runs = useQuery(runsQueryOptions)
  if (runs.error)
    return (
      <div className="py-10">
        <ErrorBox error={runs.error} retry={() => void runs.refetch()} />
      </div>
    )
  if (!runs.data) return <PageSkeleton />
  const data = runs.data
  return (
    <div className="flex flex-col gap-6 py-10">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-medium tracking-tight">运行历史</h1>
          <p className="max-w-[68ch] text-[13px] text-muted-foreground">
            runs/ 目录下每一次运行的证据都不可变；下表直接读取它，不经缓存。
          </p>
        </div>
        {data.active ? (
          <Link
            to="/runs/$runId"
            params={{ runId: data.active }}
            className="text-[13px] text-primary underline-offset-4 hover:underline"
          >
            活跃 <span className="font-mono">{data.active}</span> →
          </Link>
        ) : (
          <span className="text-[13px] text-muted-foreground">无活跃 run</span>
        )}
      </header>
      {data.runs.length ? (
        <RunsTable runs={data.runs} />
      ) : (
        <EmptyState
          title="尚无运行"
          description="回仪表台选一题并触发 pipeline。"
        />
      )}
    </div>
  )
}
