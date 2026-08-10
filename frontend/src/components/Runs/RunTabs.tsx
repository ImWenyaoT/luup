import { useQuery } from "@tanstack/react-query"
import { CheckIcon, ExternalLinkIcon, XIcon } from "lucide-react"
import { useState } from "react"
import { EmptyState, ErrorBox, Loading } from "@/components/Common/States"
import { Pill } from "@/components/Runs/StatusBadge"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { artifactQueryOptions } from "@/queries"
import type { Paper, RunDetail, VerifyReport } from "@/types"

/** tab → 候选工件文件名，取第一个真实存在的；顺序即优先级。 */
const TAB_ARTIFACTS: Record<string, string[]> = {
  evidence: ["evidence.md"],
  hypotheses: ["hypotheses.md"],
  critique: ["critique.json", "critique.md"],
  proposal: ["proposal.md", "proposal.json"],
  review: ["review.json"],
  verification: ["verification-report.md", "verification.json"],
}

export const artifactForTab = (tab: string, artifacts: Set<string>) =>
  TAB_ARTIFACTS[tab]?.find((file) => artifacts.has(file))

export function TabContent({
  tab,
  run,
  artifacts,
}: {
  tab: string
  run: RunDetail
  artifacts: Set<string>
}) {
  if (tab === "failed")
    return (
      <Artifact id={run.id} file="FAILED.md" fallback={run.failedText ?? ""} />
    )
  if (tab === "verdicts") return <Verdicts items={run.verdicts} />
  if (tab === "verification" && run.verify)
    return <Verification report={run.verify} />
  if (tab === "papers") return <Papers items={run.papers} runId={run.id} />
  const file = artifactForTab(tab, artifacts)
  if (tab === "proposal" && run.proposalRejected)
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-destructive">
          proposal.json 未通过 10 字段契约；以下为被打回的原文。
        </p>
        <ArtifactText text={run.proposalRejected} file="proposal.json" />
      </div>
    )
  return file ? (
    <Artifact id={run.id} file={file} />
  ) : (
    <EmptyState
      title={`尚未产出 ${tab} 工件`}
      description="该节点在这次运行里没有落盘对应文件。"
    />
  )
}

/**
 * 工件正文按内容分工排版：markdown 是给人读的散文，走 sans 并把行长压在 68 字符内；
 * JSON 是代码，走 mono 且不限行长。
 */
function ArtifactText({ text, file }: { text: string; file?: string }) {
  const code = !!file?.endsWith(".json")
  return (
    <div className="flex flex-col gap-2">
      {file ? (
        <div className="font-mono text-xs text-muted-foreground">{file}</div>
      ) : null}
      <pre
        className={cn(
          "m-0 max-h-[820px] overflow-auto whitespace-pre-wrap",
          code
            ? "font-mono text-xs leading-relaxed"
            : "max-w-[68ch] font-sans text-sm leading-[1.75]",
        )}
      >
        {text}
      </pre>
    </div>
  )
}

function Artifact({
  id,
  file,
  fallback,
}: {
  id: string
  file: string
  fallback?: string
}) {
  const artifact = useQuery({
    ...artifactQueryOptions(id, file),
    enabled: fallback === undefined,
  })
  if (fallback !== undefined)
    return <ArtifactText text={fallback} file={file} />
  if (artifact.error) return <ErrorBox error={artifact.error} />
  if (!artifact.data) return <Loading label={`读取 ${file}…`} />
  return (
    <ArtifactText
      text={file.endsWith(".json") ? prettyJson(artifact.data) : artifact.data}
      file={file}
    />
  )
}

function prettyJson(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

/** 判定图标与文字同时出现：✓/✗ 是形状线索，颜色只是强化。 */
function Mark({ pass }: { pass: boolean }) {
  return pass ? (
    <CheckIcon
      className="mt-0.5 size-3.5 shrink-0 text-primary"
      aria-label="通过"
    />
  ) : (
    <XIcon
      className="mt-0.5 size-3.5 shrink-0 text-destructive"
      aria-label="未通过"
    />
  )
}

function Verdicts({ items }: { items: RunDetail["verdicts"] }) {
  return (
    <ol className="flex flex-col gap-6">
      {items.map((item) => (
        <li key={item.file} className="flex flex-col gap-2">
          <div className="flex items-center gap-2 border-b pb-2">
            <span className="font-mono text-[13px] font-medium">
              {item.node}-r{item.round}
            </span>
            <Pill tone={item.verdict === "pass" ? "good" : "bad"}>
              {item.verdict}
            </Pill>
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              verdicts/{item.file}
            </span>
          </div>
          <dl className="flex flex-col gap-2">
            {item.checks.map((check, index) => (
              <div
                key={index}
                className="grid grid-cols-[16px_200px_minmax(0,1fr)] gap-x-3 text-[13px]"
              >
                <Mark pass={check.pass !== false} />
                <dt className="font-medium">{check.criterion}</dt>
                <dd className="text-muted-foreground">{check.reason}</dd>
              </div>
            ))}
          </dl>
          {item.rework ? (
            <p className="text-[13px] text-destructive">
              返工指令：{item.rework}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  )
}

function Verification({ report }: { report: VerifyReport | null }) {
  if (!report) return <EmptyState title="尚未独立验收" />
  const groups = [...new Set(report.checks.map((check) => check.group))]
  const passed = report.checks.filter((check) => check.pass).length
  return (
    <div className="flex flex-col gap-6">
      <p className="flex items-baseline gap-3 text-[15px]">
        <span
          className={cn(
            "font-medium",
            report.pass ? "text-primary" : "text-destructive",
          )}
        >
          结果: {report.result}
        </span>
        <span className="text-sm tabular-nums text-muted-foreground">
          {passed}/{report.checks.length} 项通过
        </span>
      </p>
      {groups.map((group) => {
        const checks = report.checks.filter((check) => check.group === group)
        return (
          <section key={group} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3 border-b pb-2">
              <h4 className="text-[13px] font-medium">{group}</h4>
              <span className="text-xs tabular-nums text-muted-foreground">
                {checks.filter((check) => check.pass).length}/{checks.length}
              </span>
            </div>
            <dl className="flex flex-col gap-2">
              {checks.map((check) => (
                <div
                  key={check.id}
                  className="grid grid-cols-[16px_180px_minmax(0,1fr)] gap-x-3 text-[13px]"
                >
                  <Mark pass={check.pass} />
                  <dt className="font-mono text-xs leading-5">{check.id}</dt>
                  <dd
                    className={cn(
                      !check.pass
                        ? "text-destructive"
                        : "text-muted-foreground",
                    )}
                  >
                    {check.detail}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )
      })}
    </div>
  )
}

function Papers({ items, runId }: { items: Paper[]; runId: string }) {
  const [query, setQuery] = useState("")
  const rows = items.filter((item) =>
    `${item.arxivId} ${item.title} ${item.oneline}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  )
  return (
    <div className="flex flex-col gap-3">
      <Input
        aria-label="过滤论文"
        value={query}
        placeholder="过滤 arXiv id / 标题 / 摘要"
        className="max-w-96"
        onChange={(event) => setQuery(event.target.value)}
      />
      <Table>
        <TableCaption className="sr-only">本次运行读取的论文</TableCaption>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-9 px-3 w-[132px] text-xs font-medium normal-case tracking-normal">
              arXiv id
            </TableHead>
            <TableHead className="h-9 w-[72px] px-3 text-right text-xs font-medium normal-case tracking-normal">
              年份
            </TableHead>
            <TableHead className="h-9 px-3 text-xs font-medium normal-case tracking-normal">
              标题 / 一句话
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((paper) => (
            <TableRow key={paper.arxivId}>
              <TableCell className="px-3 py-2.5 align-top">
                <a
                  className="inline-flex items-center gap-1 font-mono text-[13px] underline-offset-4 hover:underline"
                  href={`/api/runs/${runId}?artifact=${encodeURIComponent(paper.file)}`}
                >
                  {paper.arxivId}
                  <ExternalLinkIcon className="size-3 text-muted-foreground" />
                </a>
              </TableCell>
              <TableCell className="px-3 py-2.5 text-right align-top tabular-nums text-muted-foreground">
                {paper.year}
              </TableCell>
              <TableCell className="max-w-[68ch] whitespace-normal px-3 py-2.5 align-top">
                <div className="font-medium">{paper.title}</div>
                <div className="mt-0.5 text-[13px] text-muted-foreground">
                  {paper.oneline}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
