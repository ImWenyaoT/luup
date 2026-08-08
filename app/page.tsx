import { headers } from "next/headers";
import Link from "next/link";
import { Curl } from "@/components/Curl";
import { Picker } from "@/components/Picker";
import { MiniSpine, SUMMARY_MARKS } from "@/components/Spine";
import { EmptyState, Meter, Panel, Pill } from "@/components/ui";
import { STATUS_LABEL, STATUS_TONE, fmtDur, fmtTime } from "@/lib/format";
import { activeRun, listRuns, readStatusView } from "@/lib/runs";
import { readRunsIndex } from "@/lib/runsIndex";
import { readScience125 } from "@/lib/science125";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  // 与 GET /api/runs 同一条路径：派生缓存优先，缺失/损坏/过期时退回全量扫盘
  const runs = readRunsIndex(500) ?? listRuns(500);
  const active = activeRun();
  const activeView = active ? readStatusView(active) : null;
  const s125 = readScience125();

  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const base = `${proto}://${host}`;
  const sample = runs.find((r) => r.status === "passed")?.id ?? runs[0]?.id ?? "20260808-062829";
  const passed = runs.filter((r) => r.verify === "pass").length;

  return (
    <div className="space-y-6">
      {/* 状态条 */}
      <section className="flex flex-wrap items-center gap-6 border border-line bg-panel px-3 py-2">
        <div>
          <div className="text-[11px] tracking-wide text-muted uppercase">runs</div>
          <div className="text-[20px] leading-6">{runs.length}</div>
        </div>
        <Meter value={passed} total={runs.length} label="通过独立验收" />
        <div className="min-w-56 flex-1">
          {activeView ? (
            <Link href={`/runs/${active}`} className="block hover:text-accent">
              <div className="flex items-center gap-2 text-[11px] tracking-wide text-muted uppercase">
                活跃 run
                <span className="text-accent">{active}</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <MiniSpine states={activeView.nodes.map((n) => n.state)} marks={activeView.nodes.map((n) => n.mark)} />
                <span className="text-[11px] text-muted">
                  {activeView.nodes.find((n) => n.state === "active")?.label ?? "收尾"} · 点击查看实时 spine
                </span>
              </div>
            </Link>
          ) : (
            <div className="text-[11px] text-faint">无活跃 run · pipeline 串行，一次只跑一个</div>
          )}
        </div>
      </section>

      {/* 选题器 */}
      <Panel title="选题 · Science-125" right={<span>{s125 ? `${s125.total} 题 / ${s125.domains.length} 学科` : "不可读"}</span>}>
        <Picker data={s125} activeRunId={active} />
      </Panel>

      {/* 最近的 run */}
      <Panel
        title="最近的 run"
        right={
          <Link href="/runs" className="text-accent hover:underline">
            全部历史 →
          </Link>
        }
      >
        {runs.length === 0 ? (
          <EmptyState title="尚无运行" hint="从上方选一道 Science-125 题目开始" />
        ) : (
          <ul className="divide-y divide-line">
            {runs.slice(0, 8).map((r) => (
              <li key={r.id}>
                <Link href={`/runs/${r.id}`} className="flex flex-wrap items-center gap-3 py-1.5 hover:text-accent">
                  <Pill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill>
                  <span className="w-36 shrink-0 text-[12px]">{r.id}</span>
                  <MiniSpine
                    states={[r.nodes.literature, r.nodes.hypothesis, r.nodes.critique, r.nodes.proposal]}
                    marks={SUMMARY_MARKS}
                  />
                  <span className="prose-body min-w-0 flex-1 truncate text-[13px] text-fg">{r.question}</span>
                  <span className="text-[11px] text-faint">refs {r.refs ?? "—"}</span>
                  <span className={`text-[11px] ${r.verify === "pass" ? "text-accent" : r.verify === "fail" ? "text-danger" : "text-faint"}`}>
                    {r.verify === "pass" ? "ALL PASS" : r.verify === "fail" ? "FAIL" : "未验收"}
                  </span>
                  <span className="w-16 text-right text-[11px] text-faint">{fmtDur(r.durationSec)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* G1 自证：API 就摆在这里，复制即可跑 */}
      <Panel
        title={<span id="api">可调用测试 API</span>}
        right={<span className="text-faint">base {base}</span>}
      >
        <Curl
          cmds={[
            { label: "题库（125 题 / 12 学科分组）", cmd: `curl -s ${base}/api/science125 | head` },
            {
              label: "触发一次 run（202 + runId，pipeline 后台跑）",
              cmd: `curl -s -X POST ${base}/api/runs -H 'content-type: application/json' -d '{"science125Id":61}'`,
            },
            { label: "轮询状态（轻量：spine + 日志尾）", cmd: `curl -s '${base}/api/runs/${sample}?view=status'` },
            { label: "取工件原文（text/plain）", cmd: `curl -s '${base}/api/runs/${sample}?artifact=proposal.md'` },
          ]}
        />
        <div className="mt-2 text-[11px] text-faint">
          全部 no-store · 只读，唯一写操作是 POST /api/runs 触发子进程 · 无鉴权（本地评审工具）
        </div>
      </Panel>

      {runs.length > 0 ? (
        <div className="text-[11px] text-faint">
          最近一次运行 {fmtTime(runs[0].startedAt)} · 交付面读的是仓库里的真实工件，不是快照
        </div>
      ) : null}
    </div>
  );
}
