import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useMemo } from "react"
import { summarizeBatch } from "@/batch"
import { BatchView } from "@/components/Batch/BatchView"
import { ErrorBox, PageSkeleton } from "@/components/Common/States"
import { runsQueryOptions, science125QueryOptions } from "@/queries"

export const Route = createFileRoute("/_layout/batch")({
  component: BatchPage,
})

/**
 * 批次概览没有自己的数据源：它读的就是仪表台与历史读的那两个只读端点，
 * 只是换一个「按题号看」的视角。所以这里没有轮询、没有进度文件、没有批次表。
 */
function BatchPage() {
  const science = useQuery(science125QueryOptions)
  // 批次要跑几十小时，这一页是它唯一的观察窗，所以定时重取——不是新状态，
  // 只是把同一个只读端点多读几次。固定间隔而不是「有活跃 run 才轮询」：
  // 批次在两题之间没有活跃 run，那样会在第一次间隙里停下来再也不醒。
  const runs = useQuery({
    ...runsQueryOptions,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  })
  const overview = useMemo(
    () =>
      science.data && runs.data
        ? summarizeBatch(runs.data.runs, science.data)
        : null,
    [science.data, runs.data],
  )
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
  if (!overview || !runs.data) return <PageSkeleton />

  const active = runs.data.active
  return (
    <div className="flex flex-col gap-12 py-10">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-medium tracking-tight">批次概览</h1>
          <p className="max-w-[68ch] text-[13px] text-muted-foreground">
            Science-125 全量批跑的进度与欠账，全部由 runs/
            下已落盘的终态工件派生： 题号来自 meta.json，终态与失败分类来自
            exit.json。这一页不持有任何状态。
          </p>
        </div>
        {active ? (
          <Link
            to="/runs/$runId"
            params={{ runId: active }}
            className="text-[13px] text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            正在跑 <span className="font-mono">{active}</span> →
          </Link>
        ) : (
          <span className="text-[13px] text-muted-foreground">无活跃 run</span>
        )}
      </header>
      <BatchView overview={overview} />
    </div>
  )
}
