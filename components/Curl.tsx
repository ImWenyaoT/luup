"use client";

import { useState } from "react";

export type Cmd = { label: string; cmd: string };

/**
 * G1 自证：可调用的测试 API 不该只写在文档里，示例就摆在页面上，复制即可跑。
 * base 由服务端从 Host 头渲染，避免 localhost / 局域网 IP 两套说辞。
 */
export function Curl({ cmds, className = "" }: { cmds: Cmd[]; className?: string }) {
  const [copied, setCopied] = useState<number | null>(null);

  const copy = async (i: number, cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
    } catch {
      /* 无剪贴板权限时静默：命令本身可见可手选 */
    }
    setCopied(i);
    setTimeout(() => setCopied((c) => (c === i ? null : c)), 1200);
  };

  return (
    <ul className={`space-y-1 ${className}`}>
      {cmds.map((c, i) => (
        <li key={c.label} className="group border border-line bg-panel-2">
          <div className="flex items-center justify-between gap-2 px-2 pt-1 text-[11px] text-faint">
            <span>{c.label}</span>
            <button
              type="button"
              onClick={() => copy(i, c.cmd)}
              className="border border-line px-1.5 text-[11px] text-muted hover:border-accent hover:text-accent"
            >
              {copied === i ? "已复制" : "复制"}
            </button>
          </div>
          <pre className="overflow-x-auto px-2 pt-0.5 pb-1.5 text-[11.5px] leading-relaxed">
            <code>{c.cmd}</code>
          </pre>
        </li>
      ))}
    </ul>
  );
}
