import { CheckIcon, CopyIcon } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"

export function ApiExamples({ sample }: { sample: string }) {
  const base = window.location.origin
  const [copied, setCopied] = useState<number | null>(null)
  const commands = [
    `curl -s ${base}/api/science125 | head`,
    `curl -s -X POST ${base}/api/runs -H 'content-type: application/json' -d '{"science125Id":61}'`,
    `curl -s '${base}/api/runs/${sample}?view=status'`,
    `curl -s '${base}/api/runs/${sample}?artifact=proposal.md'`,
  ]
  return (
    <ul data-testid="api-examples" className="flex max-w-[880px] flex-col">
      {commands.map((command, index) => (
        <li
          key={command}
          className="group flex items-start gap-3 border-b py-2 last:border-b-0"
        >
          <span
            aria-hidden
            className="mt-px shrink-0 select-none font-mono text-xs text-muted-foreground"
          >
            $
          </span>
          <code className="min-w-0 flex-1 font-mono text-xs leading-5 break-all">
            {command}
          </code>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground"
            onClick={() => {
              void navigator.clipboard?.writeText(command)
              setCopied(index)
              window.setTimeout(() => setCopied(null), 1200)
            }}
          >
            {copied === index ? <CheckIcon /> : <CopyIcon />}
            <span className="sr-only">
              {copied === index ? "已复制" : "复制命令"}
            </span>
          </Button>
        </li>
      ))}
    </ul>
  )
}
