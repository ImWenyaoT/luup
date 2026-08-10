import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { CheckIcon } from "lucide-react"
import { useId, useState } from "react"
import { api } from "@/api"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { runsQueryOptions } from "@/queries"
import type { Science125 } from "@/types"

/**
 * 选中态：底色 + 字重 + 勾号三重编码，不靠颜色单独承载。
 * 行高 36px（py-2 + 20px 行高），hover / active / focus-visible 三态齐全。
 */
const ROW =
  "flex w-full gap-3 px-3 py-2 text-left transition-colors hover:bg-accent/60 active:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"

export function Picker({
  science,
  active,
}: {
  science: Science125
  active: string | null
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const freeId = useId()
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
    <div className="flex flex-col gap-5" data-testid="science125-picker">
      <div className="grid grid-cols-[minmax(180px,220px)_minmax(0,1fr)] overflow-hidden rounded-sm border">
        <ScrollArea type="always" className="h-64 border-r">
          <nav aria-label="学科" className="flex flex-col py-1">
            {science.domains.map((item) => {
              const on = item.domain === domain
              return (
                <button
                  type="button"
                  key={item.domain}
                  data-testid="science125-domain"
                  aria-pressed={on}
                  onClick={() => setDomain(item.domain)}
                  className={cn(
                    ROW,
                    "items-center justify-between text-[13px]",
                    on && "bg-accent font-medium",
                  )}
                >
                  <span className="min-w-0 flex-1">{item.domain}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {item.count}
                  </span>
                </button>
              )
            })}
          </nav>
        </ScrollArea>
        <ScrollArea type="always" className="h-64">
          <ul aria-label="题目" className="flex flex-col py-1">
            {group?.questions.map((question) => {
              const on = picked === question.id
              return (
                <li key={question.id}>
                  <button
                    type="button"
                    data-testid="science125-question"
                    aria-pressed={on}
                    onClick={() => {
                      setPicked(on ? null : question.id)
                      setFree("")
                    }}
                    className={cn(ROW, "items-start", on && "bg-accent")}
                  >
                    <span className="w-7 shrink-0 pt-px text-right font-mono text-xs text-muted-foreground">
                      {question.id}
                    </span>
                    <span
                      className={cn(
                        "min-w-0 flex-1 text-[13px] leading-snug",
                        on && "font-medium",
                      )}
                    >
                      {question.question}
                    </span>
                    {on ? (
                      <CheckIcon className="mt-px size-3.5 shrink-0 text-primary" />
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        </ScrollArea>
      </div>

      <Field>
        <FieldLabel htmlFor={freeId}>自由输入</FieldLabel>
        <Textarea
          id={freeId}
          value={free}
          maxLength={2000}
          rows={3}
          placeholder="直接写一个科学问题，服务端会套用与 Science-125 相同的提问模板"
          onChange={(event) => {
            setFree(event.target.value)
            if (event.target.value) setPicked(null)
          }}
        />
        <FieldDescription>与上方选题互斥，最多 2000 字。</FieldDescription>
      </Field>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button
          type="button"
          // 主动作唯一：只有真正可触发时才拿到实心主色，其余状态退回中性描边。
          variant={ready && !active && !start.isPending ? "default" : "outline"}
          disabled={start.isPending || !!active || !ready}
          onClick={() => start.mutate()}
        >
          {start.isPending ? (
            <>
              <Spinner data-icon="inline-start" />
              触发中…
            </>
          ) : (
            "触发 pipeline"
          )}
        </Button>
        <span className="text-[13px] text-muted-foreground">
          {picked
            ? `已选 #${picked}`
            : free.trim().length >= 8
              ? `自由输入 ${free.trim().length} 字`
              : "未选题"}
          {" · "}
          单次通常运行 10–20 分钟，并产生真实 API 费用
        </span>
        {active ? (
          <Link
            to="/runs/$runId"
            params={{ runId: active }}
            className="text-[13px] text-primary underline-offset-4 hover:underline"
          >
            已有运行中 · {active}
          </Link>
        ) : null}
        {error ? (
          <span className="text-[13px] font-medium text-destructive">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  )
}
