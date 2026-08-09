"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { STATUS_LABEL, STATUS_TONE, fmtDur, fmtTime } from "@/lib/format";
import { SUMMARY_MARKS } from "@/lib/nodes";
import type { RunStatus, RunSummary } from "@/lib/types";
import { MiniSpine } from "./Spine";
import { EmptyState, Pill } from "./ui";

type Key = "id" | "domain" | "refs" | "verify" | "durationSec";
const COLS: { key: Key | null; label: string; className?: string }[] = [
  { key: "id", label: "id" },
  { key: "domain", label: "学科" },
  { key: null, label: "问题" },
  { key: null, label: SUMMARY_MARKS.join(" ") },
  { key: "refs", label: "refs" },
  { key: "verify", label: "验收" },
  { key: "durationSec", label: "耗时" },
];

/**
 * 筛选项从 STATUS_LABEL 派生，不再手抄一份短标签：上一版的 chip 写「通过」而同一行的
 * 徽章写「通过验收」，两个词指同一件事；而且四个 chip 里没有「已完成」，
 * 计数加起来对不上总数——看着就像少了两个 run。
 * 只画有 run 的档，于是「各档之和 = 全部」这件事一眼可验。
 */
const STATUSES: RunStatus[] = ["running", "passed", "completed", "failed", "stale"];

const cmp = (a: unknown, b: unknown) => {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return a < b ? -1 : 1;
};

/** 排序与筛选都在前端：数据量是"仓库里跑过多少 run"，翻不了天。 */
export function RunsTable({ runs }: { runs: RunSummary[] }) {
  const [sort, setSort] = useState<{ key: Key; desc: boolean }>({ key: "id", desc: true });
  const [filter, setFilter] = useState<RunStatus | "all">("all");

  const chips = useMemo((): { id: RunStatus | "all"; label: string; count: number }[] => {
    const byStatus = STATUSES.map((s) => ({
      id: s,
      label: STATUS_LABEL[s],
      count: runs.filter((r) => r.status === s).length,
    })).filter((c) => c.count > 0);
    return [{ id: "all", label: "全部", count: runs.length }, ...byStatus];
  }, [runs]);

  const rows = useMemo(() => {
    return runs
      .filter((r) => filter === "all" || r.status === filter)
      .slice()
      .sort((a, b) => (sort.desc ? -1 : 1) * cmp(a[sort.key], b[sort.key]));
  }, [runs, sort, filter]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setFilter(c.id)}
            aria-pressed={filter === c.id}
            className={`rounded-xs border px-2 py-px text-[11px] whitespace-nowrap ${
              filter === c.id ? "border-accent/60 bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"
            }`}
          >
            {c.label}
            <span className="ml-1 text-faint">{c.count}</span>
          </button>
        ))}
        <span className="ml-auto text-[11px] text-faint">{rows.length} 行</span>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="没有符合筛选的 run" />
      ) : (
        <div className="overflow-x-auto border border-line">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="bg-panel-2 text-muted">
                <th className="border-b border-line px-2 py-1 text-left font-normal">状态</th>
                {COLS.map((c) => (
                  <th
                    key={c.label}
                    className="border-b border-line px-2 py-1 text-left font-normal whitespace-nowrap"
                  >
                    {c.key ? (
                      <button
                        type="button"
                        onClick={() =>
                          setSort((s) => (s.key === c.key ? { key: s.key, desc: !s.desc } : { key: c.key!, desc: true }))
                        }
                        className="hover:text-accent"
                      >
                        {c.label}
                        {sort.key === c.key ? <span className="text-accent">{sort.desc ? " ↓" : " ↑"}</span> : null}
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="align-top hover:bg-panel-2">
                  <td className="border-b border-line px-2 py-1">
                    <Pill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill>
                  </td>
                  <td className="border-b border-line px-2 py-1 whitespace-nowrap">
                    <Link href={`/runs/${r.id}`} className="text-accent underline underline-offset-2">
                      {r.id}
                    </Link>
                    <div className="text-[11px] text-faint">{fmtTime(r.startedAt)}</div>
                  </td>
                  <td className="border-b border-line px-2 py-1 whitespace-nowrap">
                    {r.domain ?? "—"}
                    {r.science125Id ? <span className="text-faint"> #{r.science125Id}</span> : null}
                  </td>
                  <td className="prose-body max-w-md border-b border-line px-2 py-1 text-[13px] leading-snug">
                    {r.question}
                  </td>
                  <td className="border-b border-line px-2 py-1">
                    <MiniSpine
                      states={[r.nodes.literature, r.nodes.hypothesis, r.nodes.critique, r.nodes.proposal]}
                      marks={SUMMARY_MARKS}
                    />
                  </td>
                  <td className="border-b border-line px-2 py-1">{r.refs ?? "—"}</td>
                  <td className="border-b border-line px-2 py-1 whitespace-nowrap">
                    {r.verify === null ? (
                      <span className="text-faint">—</span>
                    ) : (
                      <span className={r.verify === "pass" ? "text-accent" : "text-danger"}>
                        {r.verify === "pass" ? "ALL PASS" : "FAIL"}
                      </span>
                    )}
                  </td>
                  <td className="border-b border-line px-2 py-1 whitespace-nowrap">{fmtDur(r.durationSec)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
