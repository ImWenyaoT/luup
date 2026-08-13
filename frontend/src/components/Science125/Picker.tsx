import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { useId, useMemo, useState } from "react"
import { api } from "@/api"
import { batchEstimate, compactIds, MINUTES_PER_QUESTION } from "@/batch"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { runsQueryOptions } from "@/queries"
import type { Science125 } from "@/types"

/**
 * 选题器是「网页发起运行」的唯一入口，一次可选多题：
 * 选 0–1 题走单次运行（`POST /api/runs`），选 ≥2 题走批次（`POST /api/batch`）。
 * 批次必然串行——单写者锁保证同时最多一个可变 run——所以「全选」不是并发跑 125 个，
 * 而是发起一个会跑几十小时的串行任务，因此它必须先过确认这一关。
 */

/**
 * 选中态：底色 + 字重 + 勾选框三重编码，不靠颜色单独承载。
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
  const rowId = useId()
  const [domain, setDomain] = useState(science.domains[0]?.domain ?? "")
  const [picked, setPicked] = useState<ReadonlySet<number>>(() => new Set())
  const [free, setFree] = useState("")
  const [confirming, setConfirming] = useState(false)
  const group = science.domains.find((item) => item.domain === domain)
  const selected = useMemo(() => [...picked].sort((a, b) => a - b), [picked])
  const everyId = useMemo(
    () => science.domains.flatMap((item) => item.questions.map((q) => q.id)),
    [science],
  )

  // 选题与自由输入互斥：只要选中了题，自由输入就该被清掉，反之亦然。
  const select = (ids: Iterable<number>) => {
    const next = new Set(ids)
    setPicked(next)
    if (next.size) setFree("")
  }
  const toggle = (id: number) => {
    const next = new Set(picked)
    if (!next.delete(id)) next.add(id)
    select(next)
  }

  const invalidate = () =>
    // 触发后活跃 run 变了，回到仪表台/批次页时不能还拿旧列表。
    void queryClient.invalidateQueries({ queryKey: runsQueryOptions.queryKey })

  const trimmed = free.trim()
  const count = picked.size
  const isBatch = count >= 2
  const ready = count > 0 || trimmed.length >= 8

  const start = useMutation({
    mutationFn: () => {
      const only = selected[0]
      return api.start(
        only === undefined ? { question: trimmed } : { science125Id: only },
      )
    },
    onSuccess: (result) => {
      invalidate()
      void navigate({ to: "/runs/$runId", params: { runId: result.runId } })
    },
  })
  const launch = useMutation({
    mutationFn: () => api.startBatch(selected),
    onSuccess: () => {
      invalidate()
      // 批次没有 run id 可跳——它的进度只有 /batch 页看得见。
      void navigate({ to: "/batch" })
    },
    // 失败时也要关掉确认框：错误写在按钮下方，被遮住等于没报。
    onSettled: () => setConfirming(false),
  })

  const pending = start.isPending || launch.isPending
  const failure = start.error ?? launch.error
  const error = failure
    ? failure instanceof Error
      ? failure.message
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
              const on = picked.has(question.id)
              const id = `${rowId}-${question.id}`
              return (
                <li key={question.id}>
                  {/* 整行是 label：命中目标 36px，勾选框本身只有 16px。 */}
                  <label
                    htmlFor={id}
                    className={cn(ROW, "items-start", on && "bg-accent")}
                  >
                    <Checkbox
                      id={id}
                      data-testid="science125-question"
                      data-question-id={question.id}
                      checked={on}
                      onCheckedChange={() => toggle(question.id)}
                      className="mt-px"
                    />
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
                  </label>
                </li>
              )
            })}
          </ul>
        </ScrollArea>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span
          className="text-[13px] tabular-nums text-muted-foreground"
          data-testid="science125-selected"
        >
          已选 {count} 题
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!group}
          onClick={() =>
            select([...picked, ...(group?.questions.map((q) => q.id) ?? [])])
          }
        >
          全选（当前学科）
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => select(everyId)}
        >
          全选（{science.total} 题）
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!count}
          onClick={() => select([])}
        >
          清空
        </Button>
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
            if (event.target.value) setPicked(new Set())
          }}
        />
        <FieldDescription>与上方选题互斥，最多 2000 字。</FieldDescription>
      </Field>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button
          type="button"
          // 主动作唯一：只有真正可触发时才拿到实心主色，其余状态退回中性描边。
          variant={ready && !active && !pending ? "default" : "outline"}
          disabled={pending || !!active || !ready}
          onClick={() => (isBatch ? setConfirming(true) : start.mutate())}
        >
          {pending ? (
            <>
              <Spinner data-icon="inline-start" />
              {isBatch ? "发起中…" : "触发中…"}
            </>
          ) : isBatch ? (
            `发起批次（${count} 题）`
          ) : (
            "触发 pipeline"
          )}
        </Button>
        <span className="text-[13px] text-muted-foreground">
          {isBatch
            ? `${count} 题串行执行 · 实测样本推算 ${batchEstimate(count)}`
            : count === 1
              ? `已选 #${selected[0]} · 单题实测 ${MINUTES_PER_QUESTION.low}–${MINUTES_PER_QUESTION.high} 分钟`
              : trimmed.length >= 8
                ? `自由输入 ${trimmed.length} 字 · 实测 2–8 分钟`
                : "未选题 · 勾 1 题跑单次，勾 2 题及以上发起批次"}
          {ready ? "，并产生真实 API 费用" : null}
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

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent data-testid="batch-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>发起 {count} 题的批次？</AlertDialogTitle>
            <AlertDialogDescription>
              批次串行执行，一次一题，全程产生真实 API
              费用。按仓内已跑样本推算约 {batchEstimate(count)}（单题实测{" "}
              {MINUTES_PER_QUESTION.low}–{MINUTES_PER_QUESTION.high}{" "}
              分钟，是样本不是承诺）；已有通过 run
              的题会被跳过，实际更短。批次跑在独立进程里，关掉网页不会停。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-[13px] text-muted-foreground">
            题号 <span className="font-mono">{compactIds(selected)}</span>
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={launch.isPending}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={launch.isPending}
              onClick={(event) => {
                // 关框的时机由 mutation 定：默认行为会在请求发出前就把框关掉。
                event.preventDefault()
                launch.mutate()
              }}
            >
              {launch.isPending ? (
                <>
                  <Spinner data-icon="inline-start" />
                  发起中…
                </>
              ) : (
                "确认发起"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
