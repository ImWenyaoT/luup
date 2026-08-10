import { Button } from "@/components/ui/button"

export function Loading({ label = "读取中…" }: { label?: string }) {
  return (
    <div className="border border-dashed p-8 text-center text-muted-foreground">
      {label}
    </div>
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
    <div className="flex items-center justify-between gap-3 border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      <span>{text}</span>
      {retry ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-destructive text-destructive"
          onClick={retry}
        >
          重试
        </Button>
      ) : null}
    </div>
  )
}
