import { TriangleAlertIcon } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

/** 页面级骨架：占位块的形状对应它将要替换的内容，不做装饰。 */
export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-4 py-10" aria-busy="true">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-4 w-72" />
      <div className="flex flex-col gap-2 pt-6">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <Skeleton key={row} className="h-9 w-full" />
        ))}
      </div>
    </div>
  )
}

/** 局部读取：只在等待真实请求时出现，静止无脉冲。 */
export function Loading({
  label = "读取中…",
  className,
}: {
  label?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground",
        className,
      )}
    >
      <Spinner className="motion-reduce:animate-none" />
      {label}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  className,
}: {
  title: string
  description?: string
  className?: string
}) {
  return (
    <Empty className={cn("border py-12", className)}>
      <EmptyHeader>
        <EmptyTitle className="text-base">{title}</EmptyTitle>
        {description ? (
          <EmptyDescription>{description}</EmptyDescription>
        ) : null}
      </EmptyHeader>
    </Empty>
  )
}

export function ErrorBox({
  error,
  retry,
}: {
  error: unknown
  retry?: () => void
}) {
  const text = error instanceof Error ? error.message : "请求失败"
  return (
    <Alert variant="destructive" data-testid="error-box">
      <TriangleAlertIcon />
      <AlertTitle>请求失败</AlertTitle>
      <AlertDescription>
        <p className="max-w-[68ch]">{text}</p>
        {retry ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={retry}
          >
            重试
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}
