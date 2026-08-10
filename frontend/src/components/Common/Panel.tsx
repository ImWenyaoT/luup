import type { ReactNode } from "react"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export function Panel({
  title,
  right,
  children,
  id,
  className,
}: {
  title: ReactNode
  right?: ReactNode
  children: ReactNode
  id?: string
  className?: string
}) {
  return (
    <Card id={id} className={cn("gap-0 overflow-hidden py-0", className)}>
      <div className="flex min-h-9 items-center justify-between gap-3 border-b px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground">
        <span>{title}</span>
        <span>{right}</span>
      </div>
      <div className="p-3">{children}</div>
    </Card>
  )
}
