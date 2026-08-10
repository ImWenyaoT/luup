import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { api } from "@/api"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { runsQueryOptions } from "@/queries"
import type { Science125 } from "@/types"

export function Picker({
  science,
  active,
}: {
  science: Science125
  active: string | null
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [domain, setDomain] = useState(science.domains[0]?.domain ?? "")
  const [picked, setPicked] = useState<number | null>(null)
  const [free, setFree] = useState("")
  const group = science.domains.find((item) => item.domain === domain)
  const start = useMutation({
    mutationFn: () =>
      api.start(picked ? { science125Id: picked } : { question: free.trim() }),
    onSuccess: (result) => {
      // 触发后活跃 run 变了，回到仪表台时不能还拿旧列表。
      void queryClient.invalidateQueries({
        queryKey: runsQueryOptions.queryKey,
      })
      void navigate({ to: "/runs/$runId", params: { runId: result.runId } })
    },
  })
  const ready = picked !== null || free.trim().length >= 8
  const error = start.error
    ? start.error instanceof Error
      ? start.error.message
      : "网络错误"
    : null

  return (
    <div className="grid gap-3" data-testid="science125-picker">
      <div className="grid gap-px border bg-border md:grid-cols-[minmax(144px,224px)_1fr]">
        <nav
          aria-label="学科"
          className="max-h-[152px] overflow-auto bg-card md:max-h-72"
        >
          {science.domains.map((item) => (
            <button
              type="button"
              key={item.domain}
              data-testid="science125-domain"
              aria-pressed={item.domain === domain}
              onClick={() => setDomain(item.domain)}
              className={cn(
                "flex w-full justify-between gap-2 px-2 py-1.5 text-left text-xs hover:bg-muted",
                item.domain === domain && "bg-primary/10 text-primary",
              )}
            >
              <span>{item.domain}</span>
              <small>{item.count}</small>
            </button>
          ))}
        </nav>
        <ul aria-label="题目" className="max-h-72 overflow-auto bg-card">
          {group?.questions.map((question) => (
            <li key={question.id}>
              <button
                type="button"
                data-testid="science125-question"
                aria-pressed={picked === question.id}
                onClick={() => {
                  setPicked(picked === question.id ? null : question.id)
                  setFree("")
                }}
                className={cn(
                  "flex w-full items-baseline gap-2 px-2 py-1.5 text-left text-xs hover:bg-muted",
                  picked === question.id && "bg-primary/10 text-primary",
                )}
              >
                <small>#{question.id}</small>
                <span className="font-sans text-[13px] leading-snug">
                  {question.question}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
        自由输入（与选题互斥 · ≤2000 字）
        <textarea
          value={free}
          maxLength={2000}
          rows={3}
          placeholder="直接写一个科学问题，服务端会套用与 Science-125 相同的提问模板"
          onChange={(event) => {
            setFree(event.target.value)
            if (event.target.value) setPicked(null)
          }}
          className="mt-1 block w-full rounded-md border border-input bg-transparent p-2 font-sans text-[13px] leading-relaxed shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="border-primary bg-primary/10 text-primary disabled:border-border disabled:bg-transparent disabled:text-muted-foreground"
          disabled={start.isPending || !!active || !ready}
          onClick={() => start.mutate()}
        >
          {start.isPending ? "触发中…" : "触发 pipeline"}
        </Button>
        <small className="text-[11px] text-muted-foreground">
          {picked
            ? `已选 #${picked}`
            : free.trim().length >= 8
              ? `自由输入 ${free.trim().length} 字`
              : "未选题"}
        </small>
        <small className="text-[11px] text-muted-foreground">
          单次通常运行 10–20 分钟，并产生真实 API 费用
        </small>
        {active ? (
          <Link
            to="/runs/$runId"
            params={{ runId: active }}
            className="text-[11px] text-muted-foreground hover:text-primary"
          >
            已有运行中 · {active}
          </Link>
        ) : null}
        {error ? <b className="text-destructive">{error}</b> : null}
      </div>
    </div>
  )
}
