/**
 * Markdown 表格的转义 / 反解 —— **成对**定义在同一个文件里。
 *
 * 项目里有四张机器写、机器读的表（run 文献索引、全局文献索引、验收报告、批量报告），
 * 单元格里装的是 LLM 写的标题、作者、判据说明，`|` 随时可能出现。写出端与解析端
 * 一旦分家，转义规则漂一次就会把整行读串位，而串位的表还长得像正常的表。
 * 所以 `escapeCell` 与 `parseTableRow` 必须互逆，且只有这一份。
 */

/** 写出端：`|` 转义 + 空白压平（表格行不能含换行）。 */
export function escapeCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

/** 分隔行 `| --- | :--: |`：是表格的一部分，但不是数据。 */
const SEPARATOR = /^:?-{2,}:?$/;

/**
 * 解析端：`| a | b |` → `["a","b"]`。
 * 非表格行与分隔行返回 null。`\|` 在切分后还原成 `|`（与 escapeCell 互逆）。
 */
export function parseTableRow(line: string): string[] | null {
  const t = line.trim();
  if (!t.startsWith("|") || !t.endsWith("|")) return null;
  const cells = t
    .slice(1, -1)
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));
  if (cells.every((c) => c === "" || SEPARATOR.test(c))) return null;
  return cells;
}

/**
 * 整段 Markdown 里的表格数据行。
 * `columns` 给定时只保留列数**恰好**相符的行 —— 列数是这些表唯一的格式凭据，
 * 对不上就说明这行不是我们要的那张表（或者已经被写坏了），宁可丢掉也不猜。
 */
export function parseTableRows(markdown: string, columns?: number): string[][] {
  const rows: string[][] = [];
  for (const line of markdown.split("\n")) {
    const cells = parseTableRow(line);
    if (!cells) continue;
    if (columns !== undefined && cells.length !== columns) continue;
    rows.push(cells);
  }
  return rows;
}
