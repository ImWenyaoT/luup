import { CheckIcon, CopyIcon } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * 网页与命令行之间的桥：把一串题号变成能直接粘回终端的续跑命令。
 * 命令本身用 mono 显示——它是要被逐字符复制的东西，等宽是可读性不是装饰。
 */
export function CopyCommand({
  command,
  label,
  testId,
  className,
}: {
  command: string
  label: string
  testId?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <div
      className={cn("flex items-start gap-3 py-1", className)}
      data-testid={testId}
    >
      <span
        aria-hidden
        className="mt-1.5 shrink-0 select-none font-mono text-xs text-muted-foreground"
      >
        $
      </span>
      <code className="min-w-0 flex-1 self-center font-mono text-xs leading-5 break-all">
        {command}
      </code>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        data-testid={testId ? `${testId}-button` : undefined}
        onClick={() => {
          void navigator.clipboard?.writeText(command)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1200)
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        {copied ? "已复制" : label}
      </Button>
    </div>
  )
}
