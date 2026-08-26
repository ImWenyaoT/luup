import { useMemo, useState } from "react";

import { useScience125 } from "../../hooks/useScience125";
import type { Science125Question } from "../../lib/types/wire";

export const DOMAIN_TRANSLATIONS: Record<string, string> = {
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

export type QuestionSidebarProps = {
  onSelect: (question: Science125Question) => void;
  onStartRun?: (question: Science125Question) => void;
  onNewResearch?: () => void;
  selectedQuestion?: Science125Question | null;
  disabled?: boolean;
};

function matchesSearch(item: Science125Question, needle: string): boolean {
  const q = needle.trim().toLowerCase();
  if (!q) return true;
  const idMatch = `#${item.id}` === q || `${item.id}` === q;
  const textMatch = item.question.toLowerCase().includes(q);
  const domainMatch = item.domain.toLowerCase().includes(q) || (DOMAIN_TRANSLATIONS[item.domain] ?? "").includes(q);
  return idMatch || textMatch || domainMatch;
}

export function QuestionSidebar({
  onSelect,
  onStartRun,
  onNewResearch,
  selectedQuestion,
  disabled,
}: QuestionSidebarProps) {
  const { data, loading, error, pickRandom } = useScience125();
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const allQuestions = useMemo(() => {
    if (!data) return [];
    return data.domains.flatMap((d) => d.questions).sort((a, b) => a.id - b.id);
  }, [data]);

  const filteredQuestions = useMemo(() => {
    return allQuestions
      .filter((q) => domainFilter === "all" || q.domain === domainFilter)
      .filter((q) => matchesSearch(q, search));
  }, [allQuestions, domainFilter, search]);

  const handleRandom = () => {
    const picked = pickRandom();
    if (!picked) return;
    onSelect(picked);
  };

  return (
    <aside role="complementary" className="flex h-full w-full flex-col" data-testid="question-sidebar">
      <div className="space-y-3 border-b border-neutral-200 p-3.5 pb-2 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-neutral-900 font-mono text-xs font-bold text-white">
              L
            </div>
            <div>
              <div className="font-mono text-sm font-bold tracking-tight">Luup</div>
              <p className="text-[10px] text-neutral-500">AI Scientist</p>
            </div>
          </div>
        </div>

        {onNewResearch && (
          <button
            type="button"
            data-testid="new-research"
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded bg-neutral-900 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            onClick={onNewResearch}
            disabled={disabled}
          >
            <span>+</span> 新建研究课题
          </button>
        )}
      </div>

      <div className="space-y-2 border-b border-neutral-200 p-3 pb-2 shrink-0">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
            Science 125 题库选题
          </span>
          <span className="rounded border border-neutral-300 px-1.5 py-0 font-mono text-[10px] text-neutral-600">
            {allQuestions.length > 0 ? `${allQuestions.length} 题已冻结` : "载入中…"}
          </span>
        </div>

        <input
          type="search"
          data-testid="question-search"
          className="h-7 w-full rounded-md border border-neutral-300 bg-white px-2.5 text-xs outline-none focus:border-neutral-500"
          placeholder="搜索题号 (如 #61) 或中英文关键词…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="flex items-center gap-1.5 pt-0.5">
          <select
            data-testid="domain-filter"
            aria-label="选择学科领域"
            className="h-7 min-w-0 flex-1 truncate rounded-md border border-neutral-300 bg-white px-2 font-mono text-xs outline-none focus:border-neutral-500"
            value={domainFilter}
            onChange={(e) => setDomainFilter(e.target.value)}
          >
            <option value="all">全学科领域 ({allQuestions.length})</option>
            {data?.domains.map((d) => (
              <option key={d.domain} value={d.domain}>
                {DOMAIN_TRANSLATIONS[d.domain] ?? d.domain} ({d.count})
              </option>
            ))}
          </select>

          <button
            type="button"
            data-testid="pick-random"
            className="h-7 shrink-0 rounded border border-neutral-300 px-2 text-xs hover:bg-neutral-50 disabled:opacity-50"
            onClick={handleRandom}
            disabled={disabled || loading || allQuestions.length === 0}
            title="随机抽一题"
          >
            🎲 抽题
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 text-xs">
        {loading && <p className="p-3 text-sm text-neutral-500">加载中…</p>}
        {error && <p className="p-3 text-sm text-red-600">{error.message}</p>}
        {filteredQuestions.length === 0 && !loading && (
          <div className="py-8 text-center text-xs text-neutral-500">未找到匹配的问题</div>
        )}
        {filteredQuestions.map((q) => {
          const isSelected = selectedQuestion?.id === q.id;
          return (
            <div
              key={q.id}
              data-testid={`question-row-${q.id}`}
              className={`group flex flex-col gap-1 rounded-lg border p-2 cursor-pointer transition-all ${
                isSelected
                  ? "border-neutral-900 bg-neutral-900/5"
                  : "border-neutral-200 hover:border-neutral-400 hover:bg-neutral-50"
              }`}
              onClick={() => onSelect(q)}
            >
              <div className="flex items-center justify-between gap-1 text-[10px]">
                <span className="font-mono font-semibold text-neutral-500">#{q.id}</span>
                <span className="truncate rounded bg-neutral-100 px-1 text-[9px] text-neutral-500">
                  {DOMAIN_TRANSLATIONS[q.domain] ?? q.domain}
                </span>
              </div>
              <p className="line-clamp-2 text-[11px] font-medium leading-snug">{q.question}</p>
              <div className="mt-1 flex items-center justify-end gap-1">
                <button
                  type="button"
                  className="h-5 rounded px-1.5 text-[10px] text-neutral-900 hover:bg-neutral-100 disabled:opacity-50"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(q);
                    onStartRun?.(q);
                  }}
                  disabled={disabled}
                >
                  开跑 →
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
