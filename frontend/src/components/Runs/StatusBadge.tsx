import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { statusLabel } from "@/format"
import { cn } from "@/lib/utils"
import type { RunStatus } from "@/types"

export type Tone = "good" | "bad" | "muted"

/** 单信号色：teal 表示在跑或已通过，红只留给失败。 */
export function tone(status: RunStatus): Tone {
  return status === "passed" || status === "working" ? "good" : "bad"
}

const TONE_CLASS: Record<Tone, string> = {
  good: "border-primary/35 text-primary",
  bad: "border-destructive/35 text-destructive",
  muted: "border-border text-muted-foreground",
}

export function Pill({
  children,
  tone = "muted",
  testId,
  className,
}: {
  children: ReactNode
  tone?: Tone
  testId?: string
  className?: string
}) {
  return (
    <Badge
      variant="outline"
      data-testid={testId}
      className={cn(
        "h-5 rounded-sm px-1.5 text-xs font-normal",
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </Badge>
  )
}

/**
 * 状态灯与状态词永远成对出现：灯用 bg-current 跟随文字色，
 * 所以颜色只是冗余强化，文字才是判据。
 */
export function StatusPill({
  status,
  testId,
}: {
  status: RunStatus
  testId?: string
}) {
  return (
    <Pill tone={tone(status)} testId={testId}>
      <i
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-[1px] bg-current",
          status === "working" && "animate-pulse motion-reduce:animate-none",
        )}
      />
      {statusLabel[status]}
    </Pill>
  )
}

/** 三态验收标记与旧表格一致：pass / fail / 未验收各有固定字面量。 */
export function verifyClass(verify: "pass" | "fail" | null) {
  if (verify === "pass") return "text-primary"
  if (verify === "fail") return "text-destructive"
  return "text-muted-foreground"
}
