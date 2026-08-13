import { Link, useNavigate } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { MiniSpine } from "@/components/Runs/Spine"
import { StatusPill, verifyClass } from "@/components/Runs/StatusBadge"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { fmtDur, fmtTime, statusLabel } from "@/format"
import { cn } from "@/lib/utils"
import type { RunStatus, RunSummary } from "@/types"

const STATUSES: RunStatus[] = ["working", "passed", "failed"]

/** 表头本身不撑高：排序按钮填满 h-10 的整格，命中区域与视觉格子一致。 */
const HEAD = "h-10 p-0 text-xs font-medium normal-case tracking-normal"
const PLAIN_HEAD = "flex h-10 items-center px-3"
const CELL = "px-3 py-3 align-top"
const TOGGLE_ITEM =
  "text-xs font-normal data-[state=on]:border-foreground/30 data-[state=on]:bg-accent data-[state=on]:font-medium"

export function RunsTable({ runs }: { runs: RunSummary[] }) {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<RunStatus | "all">("all")
  const [sort, setSort] = useState<keyof RunSummary>("id")
  const [desc, setDesc] = useState(true)
  const shown = useMemo(
    () =>
      runs
        .filter((run) => filter === "all" || run.status === filter)
        .sort((a, b) => {
          const av = a[sort] ?? ""
          const bv = b[sort] ?? ""
          return (av < bv ? -1 : av > bv ? 1 : 0) * (desc ? -1 : 1)
        }),
    [runs, filter, sort, desc],
  )
  const order = (key: keyof RunSummary) => {
    if (sort === key) setDesc(!desc)
    else {
      setSort(key)
      setDesc(true)
    }
  }
  const arrow = (key: keyof RunSummary) =>
    sort === key ? (desc ? "↓" : "↑") : ""
  // 表头的拓扑列名跟着当前 run 的节点走，加节点不用改前端。
  const topology = (shown[0]?.nodes ?? runs[0].nodes)
    .map((node) => node.mark)
    .join(" ")

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={2}
          value={filter}
          onValueChange={(value) =>
            value && setFilter(value as RunStatus | "all")
          }
          aria-label="按状态过滤"
        >
          <ToggleGroupItem
            value="all"
            data-testid="runs-filter"
            className={TOGGLE_ITEM}
          >
            全部 {runs.length}
          </ToggleGroupItem>
          {STATUSES.filter((status) =>
            runs.some((run) => run.status === status),
          ).map((status) => (
            <ToggleGroupItem
              key={status}
              value={status}
              data-testid="runs-filter"
              className={TOGGLE_ITEM}
            >
              {statusLabel[status]}{" "}
              {runs.filter((run) => run.status === status).length}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span
          className="text-xs tabular-nums text-muted-foreground"
          data-testid="runs-shown-count"
        >
          {shown.length} 行
        </span>
      </div>
      <Table data-testid="runs-table">
        <TableCaption className="sr-only">
          运行历史：每行一次 pipeline 运行，按 {String(sort)} 排序。
        </TableCaption>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={cn(HEAD, "w-[104px]")}>
              <span className={PLAIN_HEAD}>状态</span>
            </TableHead>
            <TableHead className={cn(HEAD, "w-[184px]")}>
              <SortButton
                testId="runs-sort-id"
                onClick={() => order("id")}
                arrow={arrow("id")}
              >
                id
              </SortButton>
            </TableHead>
            <TableHead className={cn(HEAD, "w-[152px]")}>
              <SortButton
                onClick={() => order("domain")}
                arrow={arrow("domain")}
              >
                学科
              </SortButton>
            </TableHead>
            <TableHead className={HEAD}>
              <span className={PLAIN_HEAD}>问题</span>
            </TableHead>
            <TableHead className={cn(HEAD, "w-[72px]")}>
              <span className={cn(PLAIN_HEAD, "font-mono")} title="节点拓扑">
                {topology}
              </span>
            </TableHead>
            <TableHead className={cn(HEAD, "w-[80px]")}>
              <SortButton
                onClick={() => order("refs")}
                arrow={arrow("refs")}
                className="justify-end"
              >
                refs
              </SortButton>
            </TableHead>
            <TableHead className={cn(HEAD, "w-[104px]")}>
              <SortButton
                onClick={() => order("verify")}
                arrow={arrow("verify")}
              >
                验收
              </SortButton>
            </TableHead>
            <TableHead className={cn(HEAD, "w-[104px]")}>
              <SortButton
                onClick={() => order("durationSec")}
                arrow={arrow("durationSec")}
                className="justify-end"
              >
                耗时
              </SortButton>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((run) => (
            <TableRow
              key={run.id}
              data-testid="run-row"
              data-run-id={run.id}
              className="cursor-pointer"
              onClick={(event) => {
                // 整行可点；行内的链接自己导航，不重复触发。
                if ((event.target as HTMLElement).closest("a")) return
                void navigate({
                  to: "/runs/$runId",
                  params: { runId: run.id },
                })
              }}
            >
              <TableCell className={CELL}>
                <StatusPill status={run.status} testId="run-row-status" />
              </TableCell>
              <TableCell className={CELL}>
                <Link
                  to="/runs/$runId"
                  params={{ runId: run.id }}
                  className="font-mono text-[13px] underline-offset-4 hover:underline"
                  data-testid="run-row-id"
                >
                  {run.id}
                </Link>
                <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                  {fmtTime(run.startedAt)}
                </div>
              </TableCell>
              <TableCell className={cn(CELL, "text-muted-foreground")}>
                {run.domain ?? "—"}
              </TableCell>
              <TableCell className={cn(CELL, "whitespace-normal")}>
                <span className="line-clamp-2" title={run.question}>
                  {run.question}
                </span>
              </TableCell>
              <TableCell className={cn(CELL, "pt-3")}>
                <MiniSpine nodes={run.nodes} />
              </TableCell>
              <TableCell className={cn(CELL, "text-right tabular-nums")}>
                {run.refs ?? "—"}
              </TableCell>
              <TableCell
                className={cn(CELL, verifyClass(run.verify))}
                data-testid="run-row-verify"
              >
                {run.verify === "pass"
                  ? "ALL PASS"
                  : run.verify === "fail"
                    ? "FAIL"
                    : "—"}
              </TableCell>
              <TableCell
                className={cn(
                  CELL,
                  "text-right tabular-nums text-muted-foreground",
                )}
              >
                {fmtDur(run.durationSec)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function SortButton({
  children,
  onClick,
  arrow,
  testId,
  className,
}: {
  children: React.ReactNode
  onClick: () => void
  arrow: string
  testId?: string
  className?: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={cn(
        "flex h-10 w-full items-center gap-1 px-3 transition-colors hover:bg-accent/60 hover:text-foreground active:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
        className,
      )}
    >
      {children}
      <span aria-hidden className="text-foreground">
        {arrow}
      </span>
    </button>
  )
}
