import type { VerifyCheck, VerifyReport } from "@/lib/types";
import { EmptyState } from "./ui";

const GROUP_LABEL: Record<string, string> = {
  A: "A · proposal.json 10 字段契约",
  B1: "B1 · 引用出自本次运行的 memory/papers/",
  B2: "B2 · 标题回查 arXiv API 一致",
  B3: "B3 · 引用条数",
  B4: "B4 · 作者回查 arXiv API 一致",
};

/**
 * 默认展开的规则只有一条：**把该看的那部分摊开**。
 * 报告整体挂了，该看的是挂掉的那几组，通过的组收起来让它们让路；
 * 报告 ALL PASS，该看的就是证据本身——「23 条引用逐条反查过 arXiv」这件事藏在
 * 五个折叠里等于没给，而这恰恰是这台仪表最需要被看见的一屏。
 */
function Group({ id, checks, openByDefault }: { id: string; checks: VerifyCheck[]; openByDefault: boolean }) {
  const failed = checks.filter((c) => !c.pass);
  return (
    <details className="border border-line" open={failed.length > 0 || openByDefault}>
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
        {/* 横幅已经用边框与底色表了态，里面再套一个同色 pill 只是把同一层浅底叠两遍：
            看着糊，量出来也确实掉到 4.2:1。计数直接排在结论后面。 */}
        <span className={report.pass ? "text-accent" : "text-danger"}>结果: {report.result}</span>
        <span className="text-muted">
          <span className={report.pass ? "text-accent" : "text-danger"}>{report.checks.length - failed}</span>/
          {report.checks.length} 项通过
        </span>
        {/* 「无 LLM 参与」是这张表全部可信度的来源，不是脚注——它不该是最淡的一行字 */}
        <span className="ml-auto text-[11px] text-muted">scripts/verify-proposal.ts · 无 LLM 参与</span>
      </div>
      {groups.map((g) => (
        <Group key={g} id={g} checks={report.checks.filter((c) => c.group === g)} openByDefault={report.pass} />
      ))}
    </div>
  );
}
