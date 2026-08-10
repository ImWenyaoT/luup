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
  good: "border-primary/60 bg-primary/10 text-primary",
  bad: "border-destructive/60 bg-destructive/10 text-destructive",
  muted: "text-muted-foreground",
}

export function Pill({
  children,
  tone = "muted",
  testId,
}: {
  children: ReactNode
  tone?: Tone
  testId?: string
}) {
  return (
    <Badge
      variant="outline"
      data-testid={testId}
      className={cn(
        "rounded-sm px-1.5 py-0 text-[11px] font-normal",
        TONE_CLASS[tone],
      )}
    >
      {children}
    </Badge>
  )
}

export function StatusPill({
  status,
  testId,
}: {
  status: RunStatus
  testId?: string
}) {
  return (
    <Pill tone={tone(status)} testId={testId}>
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
