import {
  createColumnHelper,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type FilterFn,
} from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Science125Data, Science125Question } from "./types";

const DOMAIN_TRANSLATIONS: Record<string, string> = {
  "Mathematical Sciences": "数学科学",
  Chemistry: "化学",
  "Medicine & Health": "医学与健康",
  "Physics & Astronomy": "物理与天文",
  "Earth Sciences": "地球科学",
  "Ecology & Evolution": "生态与演化",
  "Computer Science & Information": "计算机与信息",
  "Cognitive Science & Psychology": "认知与心理",
  "Environmental Science": "环境科学",
  "Energy Science": "能源科学",
  "Materials Science": "材料科学",
  "Genetics & Molecular Biology": "遗传与分子生物",
};

const columnHelper = createColumnHelper<Science125Question>();

const columns = [
  columnHelper.accessor("id", {
    header: "ID",
  }),
  columnHelper.accessor("domain", {
    header: "Domain",
  }),
  columnHelper.accessor("question", {
    header: "Question",
  }),
];

const science125GlobalFilter: FilterFn<Science125Question> = (row, _columnId, filterValue: string) => {
  const q = filterValue.trim().toLowerCase();
  if (!q) return true;
  const item = row.original;
  const idMatch = `#${item.id}` === q || `${item.id}` === q;
  const textMatch = item.question.toLowerCase().includes(q);
  const domainMatch = item.domain.toLowerCase().includes(q) || (DOMAIN_TRANSLATIONS[item.domain] ?? "").includes(q);
  return idMatch || textMatch || domainMatch;
};

export function Sidebar({
  scienceData,
  selectedQuestion,
  onSelectQuestion,
  onDirectRun,
  onNewResearch,
  onToggleCollapse,
  disabled,
}: {
  scienceData: Science125Data | null;
  selectedQuestion: Science125Question | null;
  onSelectQuestion: (question: Science125Question | null) => void;
  onDirectRun: (questionText: string) => void;
  onNewResearch: () => void;
  onToggleCollapse?: () => void;
  disabled?: boolean;
}) {
  const [activeDomain, setActiveDomain] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const allQuestions = useMemo<Science125Question[]>(() => {
    if (!scienceData) return [];
    return scienceData.domains.flatMap((d) => d.questions).sort((a, b) => a.id - b.id);
  }, [scienceData]);

  const columnFilters = useMemo(() => {
    if (activeDomain === "all") return [];
    return [{ id: "domain", value: activeDomain }];
  }, [activeDomain]);

  const table = useReactTable({
    data: allQuestions,
    columns,
    state: {
      globalFilter: searchQuery,
      columnFilters,
    },
    onGlobalFilterChange: setSearchQuery,
    globalFilterFn: science125GlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rows = table.getRowModel().rows;

  const handleRandomPick = () => {
    if (allQuestions.length === 0) return;
    const random = allQuestions[Math.floor(Math.random() * allQuestions.length)];
    if (random) onSelectQuestion(random);
  };

  return (
    <aside className="flex h-full w-80 flex-shrink-0 flex-col border-r border-border/60 bg-card/50 backdrop-blur-md transition-all duration-200 overflow-hidden">
      {/* 顶部品牌与操作栏 */}
      <div className="space-y-3 p-3.5 pb-2 border-b border-border/40 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary font-mono text-xs font-bold text-primary-foreground shadow-xs">
              L
            </div>
            <div>
              <h1 className="font-mono text-sm font-bold tracking-tight">Luup</h1>
              <p className="text-[10px] text-muted-foreground">AI Scientist</p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Badge variant="outline" className="font-mono text-[9px] px-1 py-0">
              Science 125
            </Badge>
            {onToggleCollapse && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={onToggleCollapse}
                title="收起侧边栏"
                className="h-6 w-6 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                ◀
              </Button>
            )}
          </div>
        </div>

        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={onNewResearch}
          className="w-full justify-center gap-1.5 h-8 text-xs font-medium shadow-xs cursor-pointer"
        >
          <span>+</span> 新建研究课题
        </Button>
      </div>

      {/* 题库选题标题与控制栏 */}
      <div className="p-3 pb-2 space-y-2 border-b border-border/40 shrink-0">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Science 125 题库选题
          </span>
          <Badge variant="outline" className="font-mono text-[10px] px-1.5 py-0">
            {allQuestions.length > 0 ? `${allQuestions.length} 题已冻结` : "载入中…"}
          </Badge>
        </div>

        {/* 搜索框 */}
        <div className="relative w-full">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索题号 (如 #61) 或中英文关键词…"
            className="h-7 w-full rounded-md border border-border/60 bg-background/80 px-2.5 text-xs outline-none focus:border-primary placeholder:text-muted-foreground/70"
          />
        </div>

        {/* 领域过滤与抽题（防止横向溢出） */}
        <div className="flex items-center gap-1.5 w-full pt-0.5">
          <select
            value={activeDomain}
            onChange={(e) => setActiveDomain(e.target.value)}
            aria-label="选择学科领域"
            className="h-7 min-w-0 flex-1 truncate rounded-md border border-border/60 bg-background/80 px-2 font-mono text-xs text-foreground outline-none focus:border-primary"
          >
            <option value="all">全学科领域 ({allQuestions.length})</option>
            {scienceData?.domains.map((d) => (
              <option key={d.domain} value={d.domain}>
                {DOMAIN_TRANSLATIONS[d.domain] ?? d.domain} ({d.count})
              </option>
            ))}
          </select>

          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={handleRandomPick}
            disabled={disabled || allQuestions.length === 0}
            className="h-7 shrink-0 px-2 text-xs font-mono gap-1 cursor-pointer"
            title="随机抽一题"
          >
            <span className="text-xs">🎲</span>
            <span>抽题</span>
          </Button>
        </div>
      </div>

      {/* 125 题题目列表 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 text-xs">
        {rows.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">未找到匹配的问题</div>
        ) : (
          rows.map((row) => {
            const q = row.original;
            const isSelected = selectedQuestion?.id === q.id;
            return (
              <div
                key={q.id}
                onClick={() => onSelectQuestion(q)}
                className={`group flex flex-col gap-1 rounded-lg border p-2 text-left cursor-pointer transition-all ${
                  isSelected
                    ? "border-primary bg-primary/10 shadow-xs"
                    : "border-border/40 bg-card/60 hover:border-border/90 hover:bg-card"
                }`}
              >
                <div className="flex items-center justify-between gap-1 text-[10px]">
                  <span className="font-mono font-semibold text-muted-foreground">#{q.id}</span>
                  <span className="truncate rounded bg-muted/60 px-1 py-0.2 text-[9px] text-muted-foreground">
                    {DOMAIN_TRANSLATIONS[q.domain] ?? q.domain}
                  </span>
                </div>
                <p className="line-clamp-2 text-[11px] font-medium leading-snug text-foreground/90">{q.question}</p>
                <div className="mt-1 flex items-center justify-end gap-1 opacity-80 group-hover:opacity-100">
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectQuestion(q);
                      onDirectRun(q.question);
                    }}
                    disabled={disabled}
                    className="h-5 px-1.5 text-[10px] text-primary hover:bg-primary/10"
                  >
                    开跑 →
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 底部协议与发现外链 */}
      <div className="p-2.5 border-t border-border/40 bg-background/40 shrink-0">
        <div className="flex items-center justify-between font-mono text-[10px] text-muted-foreground px-1">
          <a href="/openapi.json" target="_blank" className="hover:text-primary underline-offset-4 hover:underline">
            OpenAPI
          </a>
          <span>·</span>
          <a href="/mcp" target="_blank" className="hover:text-primary underline-offset-4 hover:underline">
            MCP Server
          </a>
          <span>·</span>
          <a href="/llms.txt" target="_blank" className="hover:text-primary underline-offset-4 hover:underline">
            llms.txt
          </a>
        </div>
      </div>
    </aside>
  );
}
