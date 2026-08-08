import type { ReactNode } from "react";

/**
 * 自研极小 markdown → React。只支持 pipeline 产物用到的子集。
 * 关键约束：构建 React 元素，绝不 dangerouslySetInnerHTML —— 工件内容来自 LLM，
 * 当 HTML 注入渲染就是把模型输出接到 DOM 上。不支持的语法原样落成段落文本。
 */

const INLINE_RE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]*\]\([^)\s]+\))/g;

function inline(src: string): ReactNode[] {
  return src.split(INLINE_RE).map((part, i) => {
    if (!part) return null;
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="rounded-xs border border-line bg-panel-2 px-1 py-px">
          {part.slice(1, -1)}
        </code>
      );
    }
    const link = /^\[([^\]]*)\]\(([^)\s]+)\)$/.exec(part);
    // 只放行 http(s)：javascript:/data: 一律降级成纯文本
    if (link && /^https?:\/\//i.test(link[2])) {
      return (
        <a key={i} href={link[2]} target="_blank" rel="noreferrer noopener" className="text-accent underline underline-offset-2">
          {link[1] || link[2]}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

const cells = (line: string) =>
  line
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, "|").trim());

const isRow = (l?: string) => !!l && l.trimStart().startsWith("|");
const isSep = (l?: string) => !!l && /^\s*\|?[\s:-]*-[\s|:-]*$/.test(l) && l.includes("-");

const H = ["text-[19px] font-semibold mt-6 mb-2", "text-[16px] font-semibold mt-5 mb-2", "text-[14px] font-semibold mt-4 mb-1"];

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(
        <pre key={out.length} className="my-3 overflow-x-auto border border-line bg-panel-2 p-2 text-[12px] leading-relaxed">
          <code>{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const head = /^(#{1,3})\s+(.*)$/.exec(line);
    if (head) {
      const level = head[1].length;
      const Tag = (["h2", "h3", "h4"] as const)[level - 1];
      out.push(
        <Tag key={out.length} className={H[level - 1]}>
          {inline(head[2])}
        </Tag>,
      );
      i++;
      continue;
    }

    if (isRow(line) && isSep(lines[i + 1])) {
      const header = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (isRow(lines[i])) rows.push(cells(lines[i++]));
      out.push(
        <div key={out.length} className="my-3 overflow-x-auto border border-line">
          <table className="w-full border-collapse font-mono text-[12px]">
            <thead>
              <tr className="bg-panel-2 text-muted">
                {header.map((h, c) => (
                  <th key={c} className="border-b border-line px-2 py-1 text-left font-normal whitespace-nowrap">
                    {inline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="align-top">
                  {r.map((c, ci) => (
                    <td key={ci} className="border-b border-line px-2 py-1">
                      {inline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(
        <blockquote key={out.length} className="my-3 border-l-2 border-accent/50 pl-3 text-muted">
          {inline(buf.join(" "))}
        </blockquote>,
      );
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) buf.push(lines[i++].replace(/^\s*[-*]\s+/, ""));
      out.push(
        <ul key={out.length} className="my-2 list-disc space-y-1 pl-5">
          {buf.map((b, k) => (
            <li key={k}>{inline(b)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(\s*```|#{1,3}\s|\s*>|\s*[-*]\s)/.test(lines[i]) &&
      !(isRow(lines[i]) && isSep(lines[i + 1]))
    ) {
      para.push(lines[i++]);
    }
    out.push(
      <p key={out.length} className="my-2">
        {inline(para.join("\n"))}
      </p>,
    );
  }

  return <div className="prose-body">{out}</div>;
}
