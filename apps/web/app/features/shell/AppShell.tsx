import { useState, type ReactNode } from "react";

import { SettingsDialog, SettingsTrigger } from "../settings/SettingsDialog";

export type AppShellProps = {
  runId: string | null;
  onRunIdChange: (id: string | null) => void;
  onStartResearch: (question: string) => Promise<void>;
  sidebar: ReactNode;
  header?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
};

export function AppShell({ sidebar, header, children, footer }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="flex h-dvh flex-col bg-neutral-50" data-testid="app-shell">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-neutral-200 bg-white px-4">
        <div className="flex items-center gap-2 font-mono text-xs font-semibold text-neutral-500">
          <h1 className="text-lg font-semibold tracking-tight text-neutral-900">Luup</h1>
          <span>·</span>
          <span>Science 125</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <SettingsTrigger onOpen={() => setSettingsOpen(true)} />
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {sidebarOpen && (
          <div
            className="relative w-80 shrink-0 overflow-hidden border-r border-neutral-200 bg-white"
            data-testid="question-sidebar-panel"
          >
            <button
              type="button"
              data-testid="toggle-sidebar"
              title="收起侧边栏"
              className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
              onClick={() => setSidebarOpen(false)}
            >
              ◀
            </button>
            {sidebar}
          </div>
        )}

        {!sidebarOpen && (
          <button
            type="button"
            title="展开 Science 125 题库"
            className="absolute left-0 top-2.5 z-30 flex h-7 items-center gap-1.5 rounded-r-md border border-l-0 border-neutral-300 bg-white px-2 text-xs font-medium shadow-sm hover:border-neutral-400 hover:pl-2.5"
            onClick={() => setSidebarOpen(true)}
          >
            <span className="text-[10px]">▶</span>
            <span className="text-[11px] font-medium">题库选题</span>
          </button>
        )}

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {header}
          <div className="flex-1 overflow-auto p-4 sm:p-6">{children}</div>
          {footer}
        </main>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
