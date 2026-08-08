"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { RunStatusView } from "@/lib/types";
import { Spine } from "./Spine";
import { ErrorNote } from "./ui";

const FAST_MS = 2000;
/** pipeline 实测单 run 10~20 分钟，5 分钟后没必要还 2s 一探。 */
const SLOW_AFTER_MS = 5 * 60_000;
const SLOW_MS = 5000;
const DEGRADED_MS = 10_000;

/**
 * 轮询而非 SSE/WebSocket：状态本来就全在文件系统上（file-first 设计），
 * 推送要多一层连接生命周期与失败面，换不来任何新信息。
 */
export function Monitor({ runId, initial }: { runId: string; initial: RunStatusView }) {
  const router = useRouter();
  const [view, setView] = useState<RunStatusView>(initial);
  const [degraded, setDegraded] = useState(false);
  const [gone, setGone] = useState(false);
  const [nonce, setNonce] = useState(0);
  const logRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** visibilitychange 会在 fetch 未落地时再踢一次 tick，不挡就会分裂出第二条轮询循环。 */
    let inFlight = false;
    let fails = 0;
    const ac = new AbortController();
    const startedAt = Date.now();

    const delay = () => {
      if (fails >= 3) return DEGRADED_MS;
      return Date.now() - startedAt > SLOW_AFTER_MS ? SLOW_MS : FAST_MS;
    };
    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(tick, delay());
    };

    async function tick() {
      if (stopped || inFlight) return;
      if (document.hidden) {
        schedule();
        return;
      }
      inFlight = true;
      try {
        const res = await fetch(`/api/runs/${runId}?view=status`, { cache: "no-store", signal: ac.signal });
        if (res.status === 404) {
          stopped = true;
          setGone(true);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as RunStatusView;
        fails = 0;
        setDegraded(false);
        setView(data);
        if (data.status !== "running") {
          stopped = true;
          router.refresh(); // 拉服务端渲染的完整详情，客户端不重复解析工件
          return;
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        fails += 1;
        if (fails >= 3) setDegraded(true);
      } finally {
        inFlight = false;
      }
      schedule();
    }

    const onVisible = () => {
      if (document.hidden || stopped) return;
      clearTimeout(timer);
      void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    schedule();

    return () => {
      stopped = true;
      clearTimeout(timer);
      ac.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [runId, router, nonce]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [view.logTail]);

  if (gone) {
    return (
      <ErrorNote>
        run 目录已不存在（可能被删除）。<Link href="/runs" className="underline">返回历史</Link>
      </ErrorNote>
    );
  }

  return (
    <div className="space-y-2">
      {degraded ? <ErrorNote onRetry={() => setNonce((n) => n + 1)}>与本地服务失联，已降到 10s 重试</ErrorNote> : null}
      <div className="border border-line bg-panel p-3">
        <div className="mb-2 flex items-center gap-2 text-[11px] tracking-wide text-muted uppercase">
          <span className="spine-dot" data-state="active" aria-hidden />
          实时推进
        </div>
        <Spine nodes={view.nodes} />
      </div>
      <div>
        <div className="mb-1 text-[11px] tracking-wide text-muted uppercase">console.log · 末 {view.logTail.length} 行</div>
        <pre
          ref={logRef}
          className="max-h-64 overflow-auto bg-log-bg p-2 text-[11.5px] leading-relaxed text-log-fg"
          aria-live="polite"
        >
          <code>{view.logTail.join("\n") || "（等待子进程输出…）"}</code>
        </pre>
      </div>
    </div>
  );
}
