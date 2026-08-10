import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * 分节靠间距与字重分组，不包 Card——只有真正需要选中/交互/警示的地方才挣一个 surface。
 * 因此这里没有边框、没有阴影，只有标题行与内容之间的固定节奏。
 */
export function Section({
  title,
  meta,
  children,
  id,
  className,
}: {
  title: ReactNode
  meta?: ReactNode
  children: ReactNode
  id?: string
  className?: string
}) {
  return (
    <section
      id={id}
      className={cn("flex flex-col gap-3", id && "scroll-mt-20", className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="text-[15px] font-medium tracking-tight">{title}</h2>
        {meta ? (
          <div className="text-xs text-muted-foreground">{meta}</div>
        ) : null}
      </div>
      {children}
    </section>
  )
}
