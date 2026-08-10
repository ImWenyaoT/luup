import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { ErrorBox, Loading } from "@/components/Common/States"
import { Pill } from "@/components/Runs/StatusBadge"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
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
      <>
        <div className="flex items-center gap-3 border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          proposal.json 未通过 10 字段契约；以下为被打回的原文。
        </div>
        <ArtifactText text={run.proposalRejected} />
      </>
    )
  return file ? (
    <Artifact id={run.id} file={file} />
  ) : (
    <Loading label={`尚未产出 ${tab} 工件`} />
  )
}

function ArtifactText({ text }: { text: string }) {
  return (
    <pre className="m-0 max-h-[900px] overflow-auto whitespace-pre-wrap border bg-muted/50 p-3 font-sans leading-relaxed">
      {text}
    </pre>
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
  if (fallback !== undefined) return <ArtifactText text={fallback} />
  if (artifact.error) return <ErrorBox error={artifact.error} />
  if (!artifact.data) return <Loading label={`读取 ${file}…`} />
  return (
    <ArtifactText
      text={file.endsWith(".json") ? prettyJson(artifact.data) : artifact.data}
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

function Verdicts({ items }: { items: RunDetail["verdicts"] }) {
  return (
    <ol className="grid gap-2">
      {items.map((item) => (
        <li key={item.file} className="border">
          <header className="flex items-center gap-2 border-b bg-muted/50 px-2 py-1">
            {item.node}-r{item.round}{" "}
            <Pill tone={item.verdict === "pass" ? "good" : "bad"}>
              {item.verdict}
            </Pill>
            <small className="ml-auto text-[11px] text-muted-foreground">
              verdicts/{item.file}
            </small>
          </header>
          {item.checks.map((check, index) => (
            <p
              key={index}
              className="m-0 grid grid-cols-[18px_1fr] gap-2 border-b px-2 py-1 text-xs md:grid-cols-[18px_176px_1fr]"
            >
              <b
                className={
                  check.pass === false ? "text-destructive" : "text-primary"
                }
              >
                {check.pass === false ? "✗" : "✓"}
              </b>
              <span className="col-start-2">{check.criterion}</span>
              <span className="col-start-2 md:col-start-3">{check.reason}</span>
            </p>
          ))}
          {item.rework ? (
            <footer className="px-2 py-1 text-xs text-destructive">
              返工指令：{item.rework}
            </footer>
          ) : null}
        </li>
      ))}
    </ol>
  )
}

function Verification({ report }: { report: VerifyReport | null }) {
  if (!report) return <Loading label="尚未独立验收" />
  const groups = [...new Set(report.checks.map((check) => check.group))]
  return (
    <div className="grid gap-2">
      <div
        className={cn(
          "border px-3 py-2",
          report.pass
            ? "bg-primary/10 text-primary"
            : "bg-destructive/10 text-destructive",
        )}
      >
        结果: {report.result}
        <span className="ml-5 text-muted-foreground">
          {report.checks.filter((check) => check.pass).length}/
          {report.checks.length} 项通过
        </span>
      </div>
      {groups.map((group) => (
        <details
          key={group}
          className="border"
          open={
            report.pass ||
            report.checks.some((check) => check.group === group && !check.pass)
          }
        >
          <summary className="cursor-pointer bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
            {group}{" "}
            <span className="float-right">
              {
                report.checks.filter(
                  (check) => check.group === group && check.pass,
                ).length
              }
              /{report.checks.filter((check) => check.group === group).length}
            </span>
          </summary>
          {report.checks
            .filter((check) => check.group === group)
            .map((check) => (
              <p
                key={check.id}
                className={cn(
                  "m-0 grid grid-cols-[18px_1fr] gap-2 border-t px-2 py-1 text-xs md:grid-cols-[18px_160px_1fr]",
                  !check.pass && "bg-destructive/10 text-destructive",
                )}
              >
                <b className={check.pass ? "text-primary" : "text-destructive"}>
                  {check.pass ? "✓" : "✗"}
                </b>
                <code className="col-start-2">{check.id}</code>
                <span className="col-start-2 md:col-start-3">
                  {check.detail}
                </span>
              </p>
            ))}
        </details>
      ))}
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
    <div className="grid gap-3">
      <Input
        aria-label="过滤论文"
        value={query}
        placeholder="过滤 arXiv id / 标题 / 摘要"
        onChange={(event) => setQuery(event.target.value)}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>arXiv id</TableHead>
            <TableHead>年份</TableHead>
            <TableHead>标题 / 一句话</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((paper) => (
            <TableRow key={paper.arxivId}>
              <TableCell className="align-top">
                <a
                  className="hover:text-primary"
                  href={`/api/runs/${runId}?artifact=${encodeURIComponent(paper.file)}`}
                >
                  {paper.arxivId}
                </a>
              </TableCell>
              <TableCell className="align-top">{paper.year}</TableCell>
              <TableCell className="max-w-xl whitespace-normal align-top font-sans leading-relaxed">
                <b>{paper.title}</b>
                <small className="block">{paper.oneline}</small>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
