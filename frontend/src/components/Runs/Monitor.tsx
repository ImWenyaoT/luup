import { useQuery } from "@tanstack/react-query"
import { useEffect } from "react"
import { Spine } from "@/components/Runs/Spine"
import { runStatusQueryOptions } from "@/queries"
import type { RunStatusView } from "@/types"

/**
 * run 还在跑时接管详情页：每 2s 轮询 ?view=status，页面切到后台就停。
 * 失联不是错误态——连续 3 次失败只降级提示，重试永不放弃，与旧 setInterval 一致。
 * done 必须是稳定引用（调用方用 useCallback 包），否则终态回调会自激。
 */
export function Monitor({
  id,
  initial,
  done,
}: {
  id: string
  initial: RunStatusView
  done: () => void
}) {
  const status = useQuery({
    ...runStatusQueryOptions(id),
    initialData: initial,
    refetchInterval: (query) =>
      query.state.data?.status === "working" ? 2000 : false,
    refetchIntervalInBackground: false,
    retry: true,
    retryDelay: 2000,
  })
  const view = status.data
  const working = view.status === "working"
  const degraded = status.failureCount >= 3

  useEffect(() => {
    if (!working) done()
  }, [working, done])

  return (
    <div className="grid gap-3">
      <div className="border bg-card p-3 text-[11px] uppercase text-primary">
        实时推进 {degraded ? "· 与本地服务失联，已继续重试" : ""}
      </div>
      <Spine nodes={view.nodes} select={() => undefined} />
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
        console.log · 末 {view.logTail.length} 行
      </div>
      <pre className="max-h-64 overflow-auto bg-neutral-950 p-2 text-[11.5px] text-neutral-300">
        {view.logTail.join("\n") || "（等待子进程输出…）"}
      </pre>
    </div>
  )
}
