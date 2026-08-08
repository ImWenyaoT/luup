import type { Verdict } from "@/lib/types";
import { EmptyState, Pill } from "./ui";

/**
 * 每个 verdict 是 master 对一个节点产物的认证。reject 走 danger 左边框——
 * 这是 danger 色被允许出现的三处之一，别在别处滥用。
 */
export function Verdicts({ verdicts }: { verdicts: Verdict[] }) {
  if (verdicts.length === 0) return <EmptyState title="尚无认证结论" hint="verdicts/ 为空" />;
  return (
    <ol className="space-y-2">
      {verdicts.map((v) => {
        const pass = v.verdict === "pass";
        return (
          <li key={v.file} className={`border border-line ${pass ? "" : "border-l-2 border-l-danger"}`}>
            <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel-2 px-2 py-1">
              <span className="text-[12px]">
                {v.node}
                <span className="text-faint">-r{v.round}</span>
              </span>
              <Pill tone={pass ? "accent" : "danger"}>{v.verdict}</Pill>
              <span className="ml-auto text-[11px] text-faint">verdicts/{v.file}</span>
            </div>
            <ul className="divide-y divide-line">
              {v.checks.map((c, i) => (
                <li key={i} className="flex gap-2 px-2 py-1 text-[12px]">
                  <span className={c.pass === false ? "text-danger" : c.pass ? "text-accent" : "text-faint"}>
                    {c.pass === false ? "✗" : c.pass ? "✓" : "·"}
                  </span>
                  <span className="w-56 shrink-0 text-muted">{c.criterion}</span>
                  <span className="prose-body min-w-0 text-[12.5px] leading-snug">{c.reason}</span>
                </li>
              ))}
            </ul>
            {v.rework ? (
              <div className="border-t border-line px-2 py-1 text-[12px] text-danger">返工指令：{v.rework}</div>
            ) : null}
            {v.rejectedRaw ? (
              <details className="border-t border-line">
                <summary className="cursor-pointer px-2 py-1 text-[11px] text-muted">
                  schema 打回：verdicts/{v.file}.rejected.json
                </summary>
                <pre className="max-h-72 overflow-auto bg-panel-2 p-2 text-[11.5px] leading-relaxed">
                  <code>{v.rejectedRaw}</code>
                </pre>
              </details>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
