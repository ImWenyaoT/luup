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
    <div className="flex flex-col gap-6">
      {degraded ? (
        <p className="text-[13px] text-muted-foreground">
          与本地服务失联，已继续重试
        </p>
      ) : null}
      <Spine nodes={view.nodes} select={() => undefined} />
    </div>
  )
}
