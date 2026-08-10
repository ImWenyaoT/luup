import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "luup · 交付面",
  description: "多智能体科研假设流水线的运行仪表台：选题、触发、看 reasoning spine 推进、读工件与独立验收报告。",
};

const NAV = [
  { href: "/", label: "仪表台" },
  { href: "/runs", label: "历史" },
  { href: "/#api", label: "API" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen">
        <div className="relative z-10 mx-auto max-w-6xl px-4 pb-16">
          <header className="flex items-baseline gap-4 border-b border-line py-3">
            <Link href="/" className="text-[15px] tracking-tight">
              <span className="text-accent">luup</span>
              <span className="text-faint"> · 交付面</span>
            </Link>
            <nav className="flex gap-3 text-[12px] text-muted">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="hover:text-accent">
                  {n.label}
                </Link>
              ))}
            </nav>
            <span className="ml-auto hidden text-[11px] text-faint sm:block">
              数据源：仓库 runs/ + lib/science125.json · 工件读取只读
            </span>
          </header>
          <main className="pt-4">{children}</main>
        </div>
      </body>
    </html>
  );
}
