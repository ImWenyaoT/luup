"use client";

import { useMemo, useState } from "react";
import type { Paper } from "@/lib/types";
import { EmptyState } from "./ui";

/**
 * memory/index.md 由 paperStore 从 memory/papers/ 重建，是"本次运行真的读过哪些论文"的账本。
 * 过滤纯前端做——十几到几十条，拉一次接口不如少写一个接口。
 */
export function PapersIndex({ papers, runId }: { papers: Paper[]; runId: string }) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return papers;
    return papers.filter((p) =>
      `${p.arxivId} ${p.year} ${p.title} ${p.oneline}`.toLowerCase().includes(needle),
    );
  }, [papers, q]);

  if (papers.length === 0) return <EmptyState title="本次运行没有落盘论文" hint="memory/index.md 不存在或为空" />;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="过滤 arXiv id / 标题 / 摘要"
          className="w-full border border-line bg-panel px-2 py-1 text-[12px] outline-none focus:border-accent"
        />
        <span className="shrink-0 text-[11px] text-faint">
          {rows.length}/{papers.length}
        </span>
      </div>
      <div className="overflow-x-auto border border-line">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-panel-2 text-muted">
              <th className="border-b border-line px-2 py-1 text-left font-normal">arXiv id</th>
              <th className="border-b border-line px-2 py-1 text-left font-normal">年份</th>
              <th className="border-b border-line px-2 py-1 text-left font-normal">标题 / 一句话</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.arxivId} className="align-top">
                <td className="border-b border-line px-2 py-1 whitespace-nowrap">
                  <a
                    href={`/api/runs/${runId}?artifact=${encodeURIComponent(p.file)}`}
                    className="text-accent underline underline-offset-2"
                  >
                    {p.arxivId}
                  </a>
                </td>
                <td className="border-b border-line px-2 py-1">{p.year}</td>
                <td className="border-b border-line px-2 py-1">
                  <div className="prose-body text-[13px] leading-snug">{p.title}</div>
                  <div className="prose-body text-[12px] leading-snug text-muted">{p.oneline}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
