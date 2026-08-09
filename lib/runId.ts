/**
 * run id 的三件事：**生成、校验、解析**。
 *
 * run id 就是 UTC 时间戳 `YYYYMMDD-HHMMSS`，同时是 `runs/<id>/` 的目录名。三件事必须
 * 同址，因为它们互为逆运算：`utcStamp()` 造出来的串必须过 `RUN_ID_RE`，且必须能被
 * `stampToMs()` 解回同一时刻。分开写就会漂 —— 收编前 `stampToMs` 在 lib/phase.ts 与
 * lib/retention.ts 里逐字重复了两遍，格式正则又在第三处。
 *
 * 一个正则同时承担校验与解析：能解析出六段就是合法 id，不需要第二份格式知识。
 */

/** UTC `YYYYMMDD-HHMMSS`。捕获组按 年 月 日 时 分 秒 排列。 */
export const RUN_ID_RE = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/;

export function isRunId(value: unknown): value is string {
  return typeof value === "string" && RUN_ID_RE.test(value);
}

/** 生成：`scripts/run.ts` 建目录、paperStore 造回退目录用的必须是这一份。 */
export function utcStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

/**
 * 解析：run id → epoch ms（UTC）。不是 run id 返回 null。
 *
 * 这是 meta.json 缺失/写坏时的时间退路 —— 目录名本身就是一条不会丢的时间证据。
 */
export function stampToMs(id: string): number | null {
  const m = RUN_ID_RE.exec(id);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}
