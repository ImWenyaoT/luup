import type { RunStatus } from "./types";

/**
 * 时间一律按 UTC 定死格式。用 toLocaleString 会让服务端与浏览器渲染出不同字符串，
 * 换来的是一次水合警告和一次无谓的 debug——run id 本身就是 UTC 戳，跟着它走。
 */
const p2 = (n: number) => String(n).padStart(2, "0");

export function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getTime() === 0) return "—";
  return `${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}Z`;
}

export function fmtDur(sec: number | null): string {
  if (sec === null || sec < 0) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${p2(sec % 60)}s`;
  return `${Math.floor(m / 60)}h ${p2(m % 60)}m`;
}

export const STATUS_LABEL: Record<RunStatus, string> = {
  running: "运行中",
  passed: "通过验收",
  completed: "已完成",
  failed: "失败",
  stale: "中断",
};

/** 状态色只有三档：teal（好）/ danger（坏）/ 中性（其余）。不做彩虹。 */
export const STATUS_TONE: Record<RunStatus, "accent" | "danger" | "muted"> = {
  running: "accent",
  passed: "accent",
  completed: "muted",
  failed: "danger",
  stale: "muted",
};

export const truncate = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
