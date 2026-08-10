import { Link } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { MiniSpine } from "@/components/Runs/Spine"
import { StatusPill, verifyClass } from "@/components/Runs/StatusBadge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { displayNodes, fmtDur, fmtTime, statusLabel } from "@/format"
import { cn } from "@/lib/utils"
import type { RunStatus, RunSummary } from "@/types"

const STATUSES: RunStatus[] = ["working", "passed", "failed"]

export function RunsTable({ runs }: { runs: RunSummary[] }) {
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
  // 表头的拓扑列名跟着当前 run 的节点走，加节点不用改前端。
  const topology = displayNodes(shown[0]?.nodes ?? runs[0].nodes)
    .map((node) => node.mark)
    .join(" ")

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-1">
        <FilterButton
          active={filter === "all"}
          onClick={() => setFilter("all")}
        >
          全部 {runs.length}
        </FilterButton>
        {STATUSES.filter((status) =>
          runs.some((run) => run.status === status),
        ).map((status) => (
          <FilterButton
            key={status}
            active={filter === status}
            onClick={() => setFilter(status)}
          >
            {statusLabel[status]}{" "}
            {runs.filter((run) => run.status === status).length}
          </FilterButton>
        ))}
        <small className="ml-auto text-[11px] text-muted-foreground">
          {shown.length} 行
        </small>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>状态</TableHead>
            <TableHead>
              <button type="button" onClick={() => order("id")}>
                id {sort === "id" ? (desc ? "↓" : "↑") : ""}
              </button>
            </TableHead>
            <TableHead>
              <button type="button" onClick={() => order("domain")}>
                学科
              </button>
            </TableHead>
            <TableHead>问题</TableHead>
            <TableHead>{topology}</TableHead>
            <TableHead>
              <button type="button" onClick={() => order("refs")}>
                refs
              </button>
            </TableHead>
            <TableHead>
              <button type="button" onClick={() => order("verify")}>
                验收
              </button>
            </TableHead>
            <TableHead>
              <button type="button" onClick={() => order("durationSec")}>
                耗时
              </button>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((run) => (
            <TableRow key={run.id}>
              <TableCell className="align-top">
                <StatusPill status={run.status} />
              </TableCell>
              <TableCell className="align-top">
                <Link
                  to="/runs/$runId"
                  params={{ runId: run.id }}
                  className="hover:text-primary"
                >
                  {run.id}
                </Link>
                <small className="block text-[11px] text-muted-foreground">
                  {fmtTime(run.startedAt)}
                </small>
              </TableCell>
              <TableCell className="align-top">{run.domain ?? "—"}</TableCell>
              <TableCell className="max-w-md whitespace-normal align-top font-sans leading-relaxed">
                {run.question}
              </TableCell>
              <TableCell className="align-top">
                <MiniSpine nodes={run.nodes} />
              </TableCell>
              <TableCell className="align-top">{run.refs ?? "—"}</TableCell>
              <TableCell className={cn("align-top", verifyClass(run.verify))}>
                {run.verify === "pass"
                  ? "ALL PASS"
                  : run.verify === "fail"
                    ? "FAIL"
                    : "—"}
              </TableCell>
              <TableCell className="align-top">
                {fmtDur(run.durationSec)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "border px-2 py-px text-[11px] text-muted-foreground",
        active && "bg-primary/10 text-primary",
      )}
    >
      {children}
    </button>
  )
}
