import styled from "@emotion/styled";
import { useMemo, useState } from "react";
import { useScience125 } from "../../hooks/useScience125";
import type { Science125Question } from "../../lib/types/wire";
import { Button, colors, Input, mono } from "../../styles";

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
const Aside = styled.aside`
  height: 100%;
  display: flex;
  flex-direction: column;
`;
const Controls = styled.div`
  display: grid;
  gap: 10px;
  padding: 14px;
  border-bottom: 1px solid ${colors.border};
`;
const Meta = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-family: ${mono};
  font-size: 10px;
  color: ${colors.muted};
`;
const Select = styled.select`
  min-width: 0;
  height: 36px;
  border: 1px solid ${colors.border};
  border-radius: 9px;
  background: white;
  padding: 0 9px;
  color: ${colors.ink};
  font-size: 12px;
`;
const FilterRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
`;
const List = styled.div`
  flex: 1;
  overflow: auto;
  padding: 8px;
  display: grid;
  align-content: start;
  gap: 5px;
`;
const Row = styled.div<{ selected: boolean }>`
  display: grid;
  gap: 7px;
  padding: 11px;
  border: 1px solid ${({ selected }) => (selected ? colors.accent : colors.border)};
  border-radius: 10px;
  background: ${({ selected }) => (selected ? colors.accentSoft : colors.surface)};
  cursor: pointer;
  &:hover {
    border-color: ${colors.accent};
  }
  p {
    margin: 0;
    font-size: 12px;
    line-height: 1.45;
  }
  small {
    font-family: ${mono};
    color: ${colors.muted};
  }
`;
const RowTop = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 10px;
  color: ${colors.muted};
`;
const Empty = styled.p`
  padding: 24px 10px;
  text-align: center;
  color: ${colors.muted};
  font-size: 12px;
`;
function matchesSearch(item: Science125Question, needle: string) {
  const q = needle.trim().toLowerCase();
  return (
    !q ||
    `#${item.id}` === q ||
    `${item.id}` === q ||
    item.question.toLowerCase().includes(q) ||
    item.domain.toLowerCase().includes(q) ||
    (DOMAIN_TRANSLATIONS[item.domain] ?? "").includes(q)
  );
}

export function QuestionSidebar({
  onSelect,
  onStartRun,
  onNewResearch,
  selectedQuestion,
  disabled,
}: QuestionSidebarProps) {
  const { data, loading, error, pickRandom } = useScience125();
  const [domainFilter, setDomainFilter] = useState("all");
  const [search, setSearch] = useState("");
  const allQuestions = useMemo(
    () => (data ? data.domains.flatMap((d) => d.questions).sort((a, b) => a.id - b.id) : []),
    [data],
  );
  const filteredQuestions = useMemo(
    () =>
      allQuestions
        .filter((q) => domainFilter === "all" || q.domain === domainFilter)
        .filter((q) => matchesSearch(q, search)),
    [allQuestions, domainFilter, search],
  );
  return (
    <Aside role="complementary" data-testid="question-sidebar">
      <Controls>
        {onNewResearch && (
          <Button tone="primary" data-testid="new-research" onClick={onNewResearch} disabled={disabled}>
            + 新建研究课题
          </Button>
        )}
        <Meta>
          <strong>Science 125 题库选题</strong>
          <span>{allQuestions.length ? `${allQuestions.length} 题已冻结` : "载入中…"}</span>
        </Meta>
        <Input
          type="search"
          data-testid="question-search"
          placeholder="搜索题号 (如 #61) 或中英文关键词…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <FilterRow>
          <Select
            data-testid="domain-filter"
            aria-label="选择学科领域"
            value={domainFilter}
            onChange={(e) => setDomainFilter(e.target.value)}
          >
            <option value="all">全学科领域 ({allQuestions.length})</option>
            {data?.domains.map((d) => (
              <option key={d.domain} value={d.domain}>
                {DOMAIN_TRANSLATIONS[d.domain] ?? d.domain} ({d.count})
              </option>
            ))}
          </Select>
          <Button
            compact
            data-testid="pick-random"
            onClick={() => {
              const q = pickRandom();
              if (q) onSelect(q);
            }}
            disabled={disabled || loading || !allQuestions.length}
            title="随机抽一题"
          >
            随机抽题
          </Button>
        </FilterRow>
      </Controls>
      <List>
        {loading && <Empty>加载中…</Empty>}
        {error && <Empty style={{ color: colors.danger }}>{error.message}</Empty>}
        {!loading && !filteredQuestions.length && <Empty>未找到匹配的问题</Empty>}
        {filteredQuestions.map((q) => (
          <Row
            key={q.id}
            data-testid={`question-row-${q.id}`}
            selected={selectedQuestion?.id === q.id}
            onClick={() => onSelect(q)}
          >
            <RowTop>
              <strong>#{q.id}</strong>
              <span>{DOMAIN_TRANSLATIONS[q.domain] ?? q.domain}</span>
            </RowTop>
            <p>{q.question}</p>
            <Button
              compact
              onClick={(e) => {
                e.stopPropagation();
                onSelect(q);
                onStartRun?.(q);
              }}
              disabled={disabled}
              style={{ justifySelf: "end" }}
            >
              开跑 →
            </Button>
          </Row>
        ))}
      </List>
    </Aside>
  );
}
