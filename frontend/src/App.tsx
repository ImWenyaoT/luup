import { type ReactNode, useEffect, useMemo, useState } from "react";
import { api, ApiFailure } from "./api";
import { displayNodes, fmtDur, fmtTime, stateLabel, statusLabel, tabForNode } from "./format";
import type { NodeState, Paper, RunDetail, RunNodes, RunStatus, RunStatusView, RunSummary, Science125, VerifyReport } from "./types";

function useRoute() {
  return { path: window.location.pathname, go: (to: string) => window.location.assign(to) };
}

/** 普通链接保持浏览器原生导航；触发 run 后才由 go 跳到新详情页。 */
function NavLink({ to, children, go, className }: { to: string; children: ReactNode; go: (to: string) => void; className?: string }) {
  return <a className={className} href={to}>{children}</a>;
}

export function App() {
  const { path, go } = useRoute();
  const detailId = /^\/runs\/([\w-]+)$/.exec(path)?.[1];
  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/" go={go} className="brand"><b>luup</b><span> · 交付面</span></NavLink>
        <nav><NavLink to="/" go={go}>仪表台</NavLink><NavLink to="/runs" go={go}>历史</NavLink><a href="/#api">API</a></nav>
        <span className="topbar-note">数据源：runs/ + Science-125 · 工件读取只读</span>
      </header>
      <main>
        {detailId ? <RunDetailPage id={detailId} go={go} /> : path === "/runs" ? <RunsPage go={go} /> : <Dashboard go={go} />}
      </main>
    </div>
  );
}

function Loading({ label = "读取中…" }: { label?: string }) { return <div className="empty">{label}</div>; }
function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  const text = error instanceof Error ? error.message : "请求失败";
  return <div className="error"><span>{text}</span>{retry ? <button onClick={retry}>重试</button> : null}</div>;
}
function Pill({ children, tone = "muted" }: { children: ReactNode; tone?: "good" | "bad" | "muted" }) { return <span className={`pill ${tone}`}>{children}</span>; }
function tone(status: RunStatus) { return status === "passed" || status === "working" ? "good" : "bad"; }
function MiniSpine({ nodes }: { nodes: RunNodes }) {
  const visible = displayNodes(nodes);
  return <span className="mini-spine" title={visible.map((node) => node.label).join(" → ")}>{visible.map((node) => <i key={node.key} className={`dot ${node.state}`} title={`${node.label}: ${stateLabel[node.state]}`} />)}</span>;
}

function Dashboard({ go }: { go: (to: string) => void }) {
  const [science, setScience] = useState<Science125 | null>(null);
  const [runData, setRunData] = useState<{ active: string | null; runs: RunSummary[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = () => {
    setError(null);
    void Promise.all([api.science125(), api.runs()]).then(([s, r]) => { setScience(s); setRunData(r); }).catch(setError);
  };
  useEffect(load, []);
  if (error) return <ErrorBox error={error} retry={load} />;
  if (!science || !runData) return <Loading />;
  const passed = runData.runs.filter((run) => run.verify === "pass").length;
  return <div className="stack">
    <section className="summary-strip">
      <div><label>runs</label><strong>{runData.runs.length}</strong></div>
      <div className="meter"><span>通过独立验收 <b>{passed}/{runData.runs.length}</b></span><i><em style={{ width: `${runData.runs.length ? passed / runData.runs.length * 100 : 0}%` }} /></i></div>
      <div className="summary-active">{runData.active ? <NavLink to={`/runs/${runData.active}`} go={go}>活跃 run <b>{runData.active}</b> · 点击查看实时 spine</NavLink> : "无活跃 run · pipeline 串行，一次只跑一个"}</div>
    </section>
    <Panel title="选题 · Science-125" right={`${science.total} 题 / ${science.domains.length} 学科`}><Picker science={science} active={runData.active} go={go} /></Panel>
    <Panel title="最近的 run" right={<NavLink to="/runs" go={go}>全部历史 →</NavLink>}>
      {runData.runs.length === 0 ? <Loading label="尚无运行" /> : <ul className="recent-runs">{runData.runs.slice(0, 8).map((run) => <li key={run.id}><NavLink to={`/runs/${run.id}`} go={go}><Pill tone={tone(run.status)}>{statusLabel[run.status]}</Pill><code>{run.id}</code><MiniSpine nodes={run.nodes} /><span className="question">{run.question}</span><small>refs {run.refs ?? "—"}</small><small className={run.verify === "pass" ? "accent" : run.verify === "fail" ? "danger" : "faint"}>{run.verify === "pass" ? "ALL PASS" : run.verify === "fail" ? "FAIL" : "未验收"}</small><small>{fmtDur(run.durationSec)}</small></NavLink></li>)}</ul>}
    </Panel>
    <Panel title="可调用测试 API" right={window.location.origin}><ApiExamples sample={runData.runs.find((run) => run.status === "passed")?.id ?? runData.runs[0]?.id ?? "20260808-062829"} /></Panel>
  </div>;
}

function Panel({ title, right, children }: { title: ReactNode; right?: ReactNode; children: ReactNode }) { return <section className="panel"><header><span>{title}</span><span>{right}</span></header><div className="panel-body">{children}</div></section>; }

function Picker({ science, active, go }: { science: Science125; active: string | null; go: (to: string) => void }) {
  const [domain, setDomain] = useState(science.domains[0]?.domain ?? ""); const [picked, setPicked] = useState<number | null>(null); const [free, setFree] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const group = science.domains.find((item) => item.domain === domain);
  const submit = async () => { setBusy(true); setError(null); try { const result = await api.start(picked ? { science125Id: picked } : { question: free.trim() }); go(`/runs/${result.runId}`); } catch (e) { setError(e instanceof Error ? e.message : "网络错误"); } finally { setBusy(false); } };
  const ready = picked !== null || free.trim().length >= 8;
  return <div className="stack compact"><div className="picker"><nav aria-label="学科">{science.domains.map((item) => <button key={item.domain} aria-pressed={item.domain === domain} onClick={() => setDomain(item.domain)}><span>{item.domain}</span><small>{item.count}</small></button>)}</nav><ul aria-label="题目">{group?.questions.map((question) => <li key={question.id}><button aria-pressed={picked === question.id} onClick={() => { setPicked(picked === question.id ? null : question.id); setFree(""); }}><small>#{question.id}</small><span>{question.question}</span></button></li>)}</ul></div><label className="field">自由输入（与选题互斥 · ≤2000 字）<textarea value={free} maxLength={2000} rows={3} placeholder="直接写一个科学问题，服务端会套用与 Science-125 相同的提问模板" onChange={(event) => { setFree(event.target.value); if (event.target.value) setPicked(null); }} /></label><div className="actions"><button className="primary" disabled={busy || !!active || !ready} onClick={submit}>{busy ? "触发中…" : "触发 pipeline"}</button><small>{picked ? `已选 #${picked}` : free.trim().length >= 8 ? `自由输入 ${free.trim().length} 字` : "未选题"}</small><small>单次通常运行 10–20 分钟，并产生真实 API 费用</small>{active ? <NavLink to={`/runs/${active}`} go={go}>已有运行中 · {active}</NavLink> : null}{error ? <b className="danger">{error}</b> : null}</div></div>;
}

function ApiExamples({ sample }: { sample: string }) { const base = window.location.origin; const [copied, setCopied] = useState<number | null>(null); const commands = [`curl -s ${base}/api/science125 | head`, `curl -s -X POST ${base}/api/runs -H 'content-type: application/json' -d '{"science125Id":61}'`, `curl -s '${base}/api/runs/${sample}?view=status'`, `curl -s '${base}/api/runs/${sample}?artifact=proposal.md'`]; return <ul className="commands">{commands.map((command, index) => <li key={command}><button onClick={() => { void navigator.clipboard?.writeText(command); setCopied(index); window.setTimeout(() => setCopied(null), 1200); }}>{copied === index ? "已复制" : "复制"}</button><code>{command}</code></li>)}</ul>; }

function RunsPage({ go }: { go: (to: string) => void }) { const [data, setData] = useState<{ active: string | null; runs: RunSummary[] } | null>(null); const [error, setError] = useState<unknown>(null); const load = () => { setError(null); void api.runs().then(setData).catch(setError); }; useEffect(load, []); if (error) return <ErrorBox error={error} retry={load} />; if (!data) return <Loading />; return <Panel title="运行历史" right={data.active ? <NavLink to={`/runs/${data.active}`} go={go}>活跃 {data.active} →</NavLink> : "无活跃 run"}>{data.runs.length ? <RunsTable runs={data.runs} go={go} /> : <Loading label="尚无运行" />}</Panel>; }

function RunsTable({ runs, go }: { runs: RunSummary[]; go: (to: string) => void }) { const [filter, setFilter] = useState<RunStatus | "all">("all"); const [sort, setSort] = useState<keyof RunSummary>("id"); const [desc, setDesc] = useState(true); const statuses: RunStatus[] = ["working", "passed", "failed"]; const shown = useMemo(() => runs.filter((run) => filter === "all" || run.status === filter).sort((a, b) => { const av = a[sort] ?? ""; const bv = b[sort] ?? ""; return (av < bv ? -1 : av > bv ? 1 : 0) * (desc ? -1 : 1); }), [runs, filter, sort, desc]); const order = (key: keyof RunSummary) => { if (sort === key) setDesc(!desc); else { setSort(key); setDesc(true); } }; const topology = displayNodes(shown[0]?.nodes ?? runs[0].nodes).map((node) => node.mark).join(" "); return <div className="stack compact"><div className="filters"><button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>全部 {runs.length}</button>{statuses.filter((status) => runs.some((run) => run.status === status)).map((status) => <button key={status} aria-pressed={filter === status} onClick={() => setFilter(status)}>{statusLabel[status]} {runs.filter((run) => run.status === status).length}</button>)}<small>{shown.length} 行</small></div><div className="table-wrap"><table><thead><tr><th>状态</th><th><button onClick={() => order("id")}>id {sort === "id" ? desc ? "↓" : "↑" : ""}</button></th><th><button onClick={() => order("domain")}>学科</button></th><th>问题</th><th>{topology}</th><th><button onClick={() => order("refs")}>refs</button></th><th><button onClick={() => order("verify")}>验收</button></th><th><button onClick={() => order("durationSec")}>耗时</button></th></tr></thead><tbody>{shown.map((run) => <tr key={run.id}><td><Pill tone={tone(run.status)}>{statusLabel[run.status]}</Pill></td><td><NavLink to={`/runs/${run.id}`} go={go}>{run.id}</NavLink><small>{fmtTime(run.startedAt)}</small></td><td>{run.domain ?? "—"}</td><td className="prose">{run.question}</td><td><MiniSpine nodes={run.nodes} /></td><td>{run.refs ?? "—"}</td><td className={run.verify === "pass" ? "accent" : run.verify === "fail" ? "danger" : "faint"}>{run.verify === "pass" ? "ALL PASS" : run.verify === "fail" ? "FAIL" : "—"}</td><td>{fmtDur(run.durationSec)}</td></tr>)}</tbody></table></div></div>; }

type TabId = string;
const TAB_ARTIFACTS: Record<string, string[]> = {
  evidence: ["evidence.md"],
  hypotheses: ["hypotheses.md"],
  critique: ["critique.json", "critique.md"],
  proposal: ["proposal.md", "proposal.json"],
  review: ["review.json"],
  verification: ["verification-report.md", "verification.json"],
};
const artifactForTab = (tab: string, artifacts: Set<string>) => TAB_ARTIFACTS[tab]?.find((file) => artifacts.has(file));
function RunDetailPage({ id, go }: { id: string; go: (to: string) => void }) { const [run, setRun] = useState<RunDetail | null>(null); const [error, setError] = useState<unknown>(null); const load = () => { setError(null); void api.detail(id).then(setRun).catch(setError); }; useEffect(load, [id]); if (error) return <ErrorBox error={error} retry={load} />; if (!run) return <Loading />; return <RunDetail run={run} reload={load} go={go} />; }

function RunDetail({ run, reload, go }: { run: RunDetail; reload: () => void; go: (to: string) => void }) {
  const artifacts = new Set(run.artifactNames); const nodes = displayNodes(run.nodes); const [active, setActive] = useState<TabId>(run.failedText ? "failed" : artifactForTab("proposal", artifacts) ? "proposal" : "evidence"); const entries: { id: TabId; label: string; disabled?: boolean }[] = [ ...(run.failedText ? [{ id: "failed", label: "FAILED" }] : []), { id: "evidence", label: "evidence", disabled: !artifactForTab("evidence", artifacts) }, { id: "proposal", label: "proposal", disabled: !artifactForTab("proposal", artifacts) && !run.proposalRejected }, { id: "review", label: "review", disabled: !artifactForTab("review", artifacts) }, { id: "verification", label: "verification", disabled: !run.verify && !artifactForTab("verification", artifacts) }, { id: "verdicts", label: `verdicts (${run.verdicts.length})`, disabled: !run.verdicts.length }, { id: "papers", label: `papers (${run.papers.length})`, disabled: !run.papers.length }, ...(["hypotheses", "critique"] as const).map((id) => ({ id, label: id, disabled: !artifactForTab(id, artifacts) })) ]; return <div className="stack compact"><header className="run-head"><div><NavLink to="/runs" go={go}>← 历史</NavLink><h1>{run.id}</h1><Pill tone={tone(run.status)}>{statusLabel[run.status]}</Pill>{run.domain ? <Pill>{run.domain}</Pill> : null}{run.science125Id ? <Pill>#{run.science125Id}</Pill> : null}{run.verify ? <Pill tone={run.verify.pass ? "good" : "bad"}>验收 {run.verify.result}</Pill> : null}</div><p>开始 {fmtTime(run.startedAt)}　结束 {fmtTime(run.finishedAt)}　耗时 {fmtDur(run.durationSec)}　引用 {run.proposal?.references.length ?? "—"}</p>{run.proposal ? <h2>{run.proposal.paperTitle}</h2> : null}<details><summary>问题原文 · 本 run 的 curl</summary><pre className="question-source">{run.questionText || "（无 question.md）"}</pre><ApiExamples sample={run.id} /><small>可取工件（{run.artifactNames.length}）：{run.artifactNames.join(" · ")}</small></details>{run.status === "failed" ? <div className="notice">该 run 未走到终点。已有工件照常展示，缺的标签灰显。</div> : null}{run.failedText ? <div className="error">pipeline 判定失败并写下 FAILED.md —— 如实报失败是设计的一部分。</div> : null}</header><div className={`run-layout ${run.status === "working" ? "is-running" : ""}`}>{run.status === "working" ? <Monitor id={run.id} initial={run} done={reload} /> : <Spine nodes={nodes} select={(node) => { const tab = tabForNode(node); if (tab) setActive(tab); }} />}<div className="tabs-wrap"><div role="tablist" className="tabs">{entries.map((tab) => <button key={tab.id} role="tab" aria-selected={active === tab.id} disabled={tab.disabled} onClick={() => setActive(tab.id)}>{tab.label}</button>)}</div><section role="tabpanel" className="tab-panel"><TabContent tab={active} run={run} artifacts={artifacts} /></section></div></div></div>;
}

function Spine({ nodes, select }: { nodes: RunStatusView["nodes"]; select: (node: RunStatusView["nodes"][number]) => void }) { return <aside className="spine"><label>reasoning spine</label><ol>{nodes.map((node) => <li key={node.key}><i className={`dot ${node.state}`} /><button onClick={() => select(node)}><b>{node.mark}</b> {node.label} <small>{stateLabel[node.state]}{node.rejects ? ` · 打回 ${node.rejects} 次` : ""}</small><small>{node.artifact} · {fmtTime(node.at)}{node.elapsedSec ? ` · +${fmtDur(node.elapsedSec)}` : ""}</small></button></li>)}</ol></aside>; }

function Monitor({ id, initial, done }: { id: string; initial: RunStatusView; done: () => void }) { const [view, setView] = useState<RunStatusView>(initial); const [degraded, setDegraded] = useState(false); useEffect(() => { let stopped = false; let failures = 0; const timer = window.setInterval(() => { if (document.hidden || stopped) return; void api.status(id).then((next) => { failures = 0; setDegraded(false); setView(next); if (next.status !== "working") { stopped = true; window.clearInterval(timer); done(); } }).catch(() => { failures += 1; if (failures >= 3) setDegraded(true); }); }, 2000); return () => { stopped = true; window.clearInterval(timer); }; }, [id, done]); return <div className="monitor"><div className="live">实时推进 {degraded ? "· 与本地服务失联，已继续重试" : ""}</div><Spine nodes={view.nodes} select={() => undefined} /><label>console.log · 末 {view.logTail.length} 行</label><pre className="log">{view.logTail.join("\n") || "（等待子进程输出…）"}</pre></div>; }

function TabContent({ tab, run, artifacts }: { tab: TabId; run: RunDetail; artifacts: Set<string> }) { if (tab === "failed") return <Artifact id={run.id} file="FAILED.md" fallback={run.failedText ?? ""} />; if (tab === "verdicts") return <Verdicts items={run.verdicts} />; if (tab === "verification" && run.verify) return <Verification report={run.verify} />; if (tab === "papers") return <Papers items={run.papers} runId={run.id} />; const file = artifactForTab(tab, artifacts); if (tab === "proposal" && run.proposalRejected) return <><div className="error">proposal.json 未通过 10 字段契约；以下为被打回的原文。</div><pre className="artifact">{run.proposalRejected}</pre></>; return file ? <Artifact id={run.id} file={file} /> : <Loading label={`尚未产出 ${tab} 工件`} />; }

function Artifact({ id, file, fallback }: { id: string; file: string; fallback?: string }) { const [text, setText] = useState(fallback ?? ""); const [error, setError] = useState<unknown>(null); useEffect(() => { if (fallback !== undefined) return; setText(""); setError(null); void api.artifact(id, file).then(setText).catch(setError); }, [id, file, fallback]); if (error) return <ErrorBox error={error} />; if (!text) return <Loading label={`读取 ${file}…`} />; return <pre className="artifact">{file.endsWith(".json") ? prettyJson(text) : text}</pre>; }
function prettyJson(value: string) { try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; } }
function Verdicts({ items }: { items: RunDetail["verdicts"] }) { return <ol className="verdicts">{items.map((item) => <li key={item.file}><header>{item.node}-r{item.round} <Pill tone={item.verdict === "pass" ? "good" : "bad"}>{item.verdict}</Pill><small>verdicts/{item.file}</small></header>{item.checks.map((check, index) => <p key={index}><b className={check.pass === false ? "danger" : "accent"}>{check.pass === false ? "✗" : "✓"}</b><span>{check.criterion}</span>{check.reason}</p>)}{item.rework ? <footer>返工指令：{item.rework}</footer> : null}</li>)}</ol>; }
function Verification({ report }: { report: VerifyReport | null }) { if (!report) return <Loading label="尚未独立验收" />; const groups = [...new Set(report.checks.map((check) => check.group))]; return <div className="verification"><div className={report.pass ? "verify-good" : "verify-bad"}>结果: {report.result}<span>{report.checks.filter((check) => check.pass).length}/{report.checks.length} 项通过</span></div>{groups.map((group) => <details key={group} open={report.pass || report.checks.some((check) => check.group === group && !check.pass)}><summary>{group} <span>{report.checks.filter((check) => check.group === group && check.pass).length}/{report.checks.filter((check) => check.group === group).length}</span></summary>{report.checks.filter((check) => check.group === group).map((check) => <p className={check.pass ? "" : "check-failed"} key={check.id}><b>{check.pass ? "✓" : "✗"}</b><code>{check.id}</code>{check.detail}</p>)}</details>)}</div>; }
function Papers({ items, runId }: { items: Paper[]; runId: string }) { const [query, setQuery] = useState(""); const rows = items.filter((item) => `${item.arxivId} ${item.title} ${item.oneline}`.toLowerCase().includes(query.toLowerCase())); return <div className="stack compact"><input aria-label="过滤论文" value={query} placeholder="过滤 arXiv id / 标题 / 摘要" onChange={(event) => setQuery(event.target.value)} /><div className="table-wrap"><table><thead><tr><th>arXiv id</th><th>年份</th><th>标题 / 一句话</th></tr></thead><tbody>{rows.map((paper) => <tr key={paper.arxivId}><td><a href={`/api/runs/${runId}?artifact=${encodeURIComponent(paper.file)}`}>{paper.arxivId}</a></td><td>{paper.year}</td><td className="prose"><b>{paper.title}</b><small>{paper.oneline}</small></td></tr>)}</tbody></table></div></div>; }
