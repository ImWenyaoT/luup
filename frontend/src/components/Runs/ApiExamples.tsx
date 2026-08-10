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
    <ul>
      {commands.map((command, index) => (
        <li
          key={command}
          className="relative my-1 overflow-auto border bg-muted/50 px-2 pb-2 pt-6"
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="absolute right-1.5 top-1 h-5 px-1.5 text-[11px] font-normal text-muted-foreground"
            onClick={() => {
              void navigator.clipboard?.writeText(command)
              setCopied(index)
              window.setTimeout(() => setCopied(null), 1200)
            }}
          >
            {copied === index ? "已复制" : "复制"}
          </Button>
          <code className="text-[11.5px] max-md:whitespace-pre-wrap">
            {command}
          </code>
        </li>
      ))}
    </ul>
  )
}
