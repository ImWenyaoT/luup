"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Science125 } from "@/lib/types";
import { EmptyState, Field } from "./ui";

type Posted = { runId?: string; error?: string; code?: string; activeRunId?: string | null };

/**
 * 选题与自由输入互斥：一次 run 只有一个问题，UI 上让两者互相清空，
 * 比提交后回一句"只能给一个"要诚实。
 */
export function Picker({ data, activeRunId }: { data: Science125 | null; activeRunId: string | null }) {
  const router = useRouter();
  const [domain, setDomain] = useState(data?.domains[0]?.domain ?? "");
  const [picked, setPicked] = useState<number | null>(null);
  const [free, setFree] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Posted | null>(null);

  const group = data?.domains.find((d) => d.domain === domain) ?? null;
  const ready = picked !== null || free.trim().length >= 8;
  const blocked = activeRunId !== null;

  async function trigger() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(picked !== null ? { science125Id: picked } : { question: free.trim() }),
      });
      const body = (await res.json()) as Posted;
      if (res.status === 202 && body.runId) {
        router.push(`/runs/${body.runId}`);
        return;
      }
      setErr(body);
    } catch (e) {
      setErr({ error: e instanceof Error ? e.message : "网络错误", code: "network" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {data ? (
        <div className="grid grid-cols-[minmax(9rem,14rem)_1fr] gap-px border border-line bg-line">
          <nav className="max-h-72 overflow-y-auto bg-panel" aria-label="学科">
            {data.domains.map((d) => (
              <button
                key={d.domain}
                type="button"
                onClick={() => setDomain(d.domain)}
                aria-pressed={d.domain === domain}
                className={`flex w-full items-center justify-between gap-2 px-2 py-1 text-left text-[12px] ${
                  d.domain === domain ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"
                }`}
              >
                <span className="truncate">{d.domain}</span>
                <span className="text-[11px] text-faint">{d.count}</span>
              </button>
            ))}
          </nav>
          <ul className="max-h-72 overflow-y-auto bg-panel" aria-label="题目">
            {group?.questions.map((q) => (
              <li key={q.id}>
                <button
                  type="button"
                  onClick={() => {
                    setPicked(q.id === picked ? null : q.id);
                    setFree("");
                  }}
                  aria-pressed={picked === q.id}
                  className={`flex w-full gap-2 px-2 py-1 text-left text-[12px] ${
                    picked === q.id ? "bg-accent-soft text-accent" : "hover:bg-panel-2"
                  }`}
                >
                  <span className="w-9 shrink-0 text-faint">#{q.id}</span>
                  <span className="prose-body text-[13px] leading-normal">{q.question}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <EmptyState title="题库不可读" hint="Science-125 题库解析失败 · 自由输入仍可用" />
      )}

      <Field label="自由输入（与选题互斥 · ≤2000 字）">
        <textarea
          value={free}
          maxLength={2000}
          rows={3}
          onChange={(e) => {
            setFree(e.target.value);
            if (e.target.value) setPicked(null);
          }}
          placeholder="直接写一个科学问题，服务端会套用与 Science-125 相同的提问模板"
          className="prose-body w-full resize-y border border-line bg-panel p-2 text-[13px] outline-none focus:border-accent"
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={trigger}
          disabled={busy || blocked || !ready}
          className="border border-accent bg-accent-soft px-3 py-1 text-accent disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:text-faint"
        >
          {busy ? "触发中…" : "触发 pipeline"}
        </button>
        <span className="text-[11px] text-faint">
          {picked !== null
            ? `已选 #${picked}`
            : free.trim().length >= 8
              ? `自由输入 ${free.trim().length} 字`
              : "未选题"}
        </span>
        <span className="text-[11px] text-faint">单次通常运行 10–20 分钟，并产生真实 API 费用</span>
        {blocked ? (
          <span className="text-[11px] text-muted">
            已有运行中 ·{" "}
            <Link href={`/runs/${activeRunId}`} className="text-accent underline">
              {activeRunId}
            </Link>
          </span>
        ) : null}
        {err ? (
          <span className="text-[11px] text-danger">
            {err.error}
            {err.code === "run_in_progress" && err.activeRunId ? (
              <>
                {" · "}
                <Link href={`/runs/${err.activeRunId}`} className="underline">
                  {err.activeRunId}
                </Link>
              </>
            ) : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}
