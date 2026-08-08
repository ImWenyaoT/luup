import type { VerifyCheck, VerifyReport } from "@/lib/types";
import { EmptyState, Pill } from "./ui";

const GROUP_LABEL: Record<string, string> = {
  A: "A · proposal.json 10 字段契约",
  B1: "B1 · 引用出自本次运行的 memory/papers/",
  B2: "B2 · 标题回查 arXiv API 一致",
  B3: "B3 · 引用条数",
  B4: "B4 · 作者回查 arXiv API 一致",
};

function Group({ id, checks }: { id: string; checks: VerifyCheck[] }) {
  const failed = checks.filter((c) => !c.pass);
  return (
    <details className="border border-line" open={failed.length > 0}>
      <summary className="flex cursor-pointer items-center gap-2 bg-panel-2 px-2 py-1 text-[12px]">
        <span className="text-muted">{GROUP_LABEL[id] ?? id}</span>
        <span className="ml-auto text-[11px]">
          <span className={failed.length ? "text-danger" : "text-accent"}>
            {checks.length - failed.length}/{checks.length}
          </span>
        </span>
      </summary>
      <ul>
        {checks.map((c) => (
          <li
            key={c.id}
            className={`flex gap-2 border-t border-line px-2 py-1 text-[12px] ${c.pass ? "" : "bg-danger-soft"}`}
          >
            <span className={c.pass ? "text-accent" : "text-danger"}>{c.pass ? "✓" : "✗"}</span>
            <span className="w-44 shrink-0 text-muted">{c.id}</span>
            <span className={`min-w-0 break-words ${c.pass ? "text-fg" : "text-danger"}`}>{c.detail}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * 验收报告解析成结构再渲染，而不是把 markdown 原样丢给渲染器：
 * 评审要看的是「哪一组挂了、挂在哪一条」，那需要分组和折叠。
 */
export function VerifyTable({ report, runId }: { report: VerifyReport | null; runId: string }) {
  if (!report) {
    return (
      <EmptyState
        title="尚未独立验收"
        hint={
          <>
            本地跑一次确定性验收：<code className="text-accent">pnpm verify runs/{runId}</code>
          </>
        }
      />
    );
  }
  const groups = [...new Set(report.checks.map((c) => c.group))];
  const failed = report.checks.filter((c) => !c.pass).length;
  return (
    <div className="space-y-2">
      <div
        className={`flex items-center gap-3 border px-3 py-2 ${
          report.pass ? "border-accent/50 bg-accent-soft" : "border-danger/50 bg-danger-soft"
        }`}
      >
        <span className={report.pass ? "text-accent" : "text-danger"}>结果: {report.result}</span>
        <Pill tone={report.pass ? "accent" : "danger"}>
          {report.checks.length - failed}/{report.checks.length} 通过
        </Pill>
        <span className="ml-auto text-[11px] text-faint">scripts/verify-proposal.ts · 无 LLM 参与</span>
      </div>
      {groups.map((g) => (
        <Group key={g} id={g} checks={report.checks.filter((c) => c.group === g)} />
      ))}
    </div>
  );
}
