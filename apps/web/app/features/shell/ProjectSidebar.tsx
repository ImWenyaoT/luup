import styled from "@emotion/styled";
import { useEffect, useState, type ReactNode } from "react";

import { CloseIcon, LibraryIcon, MenuIcon } from "../../Icons";
import type { RunTab } from "../../hooks/useRunWorkingSet";
import { colors, IconButton } from "../../styles";

type ProjectSidebarProps = {
  activeRunId: string | null;
  runs: RunTab[];
  onSelectRun: (id: string) => void;
  questionBank: ReactNode;
  onNewResearch?: () => void;
  settings: ReactNode;
  onCollapse: (trigger: HTMLElement) => void;
  collapseLabel: string;
  mobile: boolean;
};

const Sidebar = styled.nav`
  height: 100%;
  display: flex;
  flex-direction: column;
`;
const Inner = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px 16px 16px;
`;
const Header = styled.div`
  min-height: 40px;
  display: flex;
  align-items: center;
  gap: 8px;
`;
const Brand = styled.h1`
  margin: 0;
  font-size: 20px;
  line-height: 1.2;
  letter-spacing: -0.03em;
`;
const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  > button:not([data-testid="toggle-sidebar"]) {
    width: 36px;
    overflow: hidden;
    padding: 0;
  }
  > button:not([data-testid="toggle-sidebar"]) span {
    display: none;
  }
`;
const SearchTrigger = styled.button`
  width: 100%;
  height: 40px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid ${colors.border};
  border-radius: 999px;
  padding: 0 14px;
  background: ${colors.surface};
  color: ${colors.muted};
  font-size: 14px;
  text-align: left;
  &:hover {
    border-color: ${colors.faint};
  }
`;
const SectionLabel = styled.div`
  padding: 2px 8px;
  color: ${colors.muted};
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
`;
const Tree = styled.ul`
  flex: 1;
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
`;
const Group = styled.ul`
  margin: 2px 0 0;
  padding: 0 0 0 16px;
  list-style: none;
`;
const NodeButton = styled.button<{ depth?: number; selected?: boolean }>`
  width: 100%;
  min-height: 40px;
  display: flex;
  align-items: center;
  gap: 7px;
  border: 0;
  border-radius: 8px;
  padding: 7px 8px;
  background: ${({ selected }) => (selected ? colors.accentSoft : "transparent")};
  color: ${colors.ink};
  text-align: left;
  font-size: 14px;
  font-weight: ${({ depth }) => (depth === 0 ? 600 : 400)};
  &:hover {
    background: ${colors.accentSoft};
  }
`;
const Disclosure = styled.span<{ expanded: boolean }>`
  width: 12px;
  color: ${colors.muted};
  transform: rotate(${({ expanded }) => (expanded ? "90deg" : "0deg")});
  transition: transform 120ms ease;
`;
const ProjectMeta = styled.span`
  margin-left: auto;
  color: ${colors.muted};
  font-size: 11px;
`;
const RunList = styled.ul`
  display: grid;
  gap: 2px;
  margin: 3px 0 8px;
  padding: 0;
  list-style: none;
`;
const RunButton = styled(NodeButton)`
  padding-left: 18px;
  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;
const LocalNote = styled.p`
  margin: 4px 8px 8px 18px;
  color: ${colors.muted};
  font-size: 12px;
`;
const NewButton = styled.button`
  width: 100%;
  min-height: 40px;
  border: 1px solid ${colors.border};
  border-radius: 8px;
  background: ${colors.surface};
  color: ${colors.ink};
  font-size: 14px;
  font-weight: 600;
  &:hover {
    background: ${colors.accentSoft};
  }
`;
const Info = styled.div`
  padding: 16px 8px 0;
  border-top: 1px solid ${colors.border};
  color: ${colors.muted};
  font-size: 12px;
  line-height: 1.5;
`;
const Panel = styled.div`
  position: absolute;
  inset: 0 auto 0 288px;
  z-index: 36;
  width: min(420px, calc(100vw - 288px));
  overflow: hidden;
  border-right: 1px solid ${colors.border};
  background: ${colors.surface};
  box-shadow: 18px 0 40px rgba(30, 30, 30, 0.1);
  @media (max-width: 900px) {
    inset: 0;
    width: 100%;
  }
`;
const PanelHead = styled.div`
  height: 56px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  border-bottom: 1px solid ${colors.border};
  h2 {
    margin: 0;
    font-size: 16px;
  }
`;

export function ProjectSidebar({
  activeRunId,
  runs,
  onSelectRun,
  questionBank,
  onNewResearch,
  settings,
  onCollapse,
  collapseLabel,
  mobile,
}: ProjectSidebarProps) {
  const [projectExpanded, setProjectExpanded] = useState(true);
  const [questionsExpanded, setQuestionsExpanded] = useState(false);
  const [runsExpanded, setRunsExpanded] = useState(true);

  useEffect(() => {
    if (activeRunId) setQuestionsExpanded(false);
  }, [activeRunId]);

  return (
    <Sidebar aria-label="项目导航" data-testid="project-sidebar">
      <Inner>
        <Header>
          <Brand>Luup</Brand>
          <HeaderActions>
            {settings}
            <IconButton
              compact
              data-testid={mobile ? undefined : "toggle-sidebar"}
              title={collapseLabel}
              aria-label={collapseLabel}
              aria-expanded="true"
              onClick={(event) => onCollapse(event.currentTarget)}
            >
              <MenuIcon />
            </IconButton>
          </HeaderActions>
        </Header>
        <SearchTrigger type="button" onClick={() => setQuestionsExpanded(true)} aria-haspopup="dialog">
          <span aria-hidden="true">⌕</span>
          <span>搜索题库…</span>
        </SearchTrigger>
        <SectionLabel>PROJECTS</SectionLabel>
        <Tree aria-label="Science 125 项目导航层级">
          <li>
            <NodeButton depth={0} aria-expanded={projectExpanded} onClick={() => setProjectExpanded((value) => !value)}>
              <Disclosure aria-hidden="true" expanded={projectExpanded}>
                ›
              </Disclosure>
              <LibraryIcon width="16" height="16" />
              <span>Science 125</span>
            </NodeButton>
            {projectExpanded && (
              <Group>
                <li>
                  <NodeButton aria-expanded={questionsExpanded} onClick={() => setQuestionsExpanded(true)}>
                    <Disclosure aria-hidden="true" expanded={questionsExpanded}>
                      ›
                    </Disclosure>
                    <span>Science 125 题库</span>
                    <ProjectMeta>125</ProjectMeta>
                  </NodeButton>
                </li>
                <li>
                  <NodeButton aria-expanded={runsExpanded} onClick={() => setRunsExpanded((value) => !value)}>
                    <Disclosure aria-hidden="true" expanded={runsExpanded}>
                      ›
                    </Disclosure>
                    <span>Runs</span>
                    <ProjectMeta>{runs.length}</ProjectMeta>
                  </NodeButton>
                  {runsExpanded && (
                    <RunList aria-label="本机已打开的 Runs">
                      {runs.map((run) => (
                        <li key={run.id}>
                          <RunButton
                            selected={run.id === activeRunId}
                            onClick={() => onSelectRun(run.id)}
                            title={run.label}
                          >
                            <span>{run.label}</span>
                          </RunButton>
                        </li>
                      ))}
                      {!runs.length && (
                        <li>
                          <LocalNote>本机尚未打开 Run</LocalNote>
                        </li>
                      )}
                    </RunList>
                  )}
                </li>
              </Group>
            )}
          </li>
        </Tree>
        <NewButton type="button" onClick={onNewResearch}>
          ＋ 新研究
        </NewButton>
        <Info>
          <strong>本机工作集</strong>
          <br />
          项目树保存组织上下文；上方标签只显示当前打开的 Run。
        </Info>
      </Inner>
      {questionsExpanded && (
        <Panel
          role="dialog"
          aria-modal={mobile ? "true" : undefined}
          aria-label="Science 125 题库"
          data-testid="question-bank-tree-panel"
        >
          <PanelHead>
            <h2>Science 125 题库</h2>
            <IconButton
              compact
              aria-label="关闭题库"
              onClick={() => setQuestionsExpanded(false)}
              style={{ marginLeft: "auto" }}
            >
              <CloseIcon />
            </IconButton>
          </PanelHead>
          <div style={{ height: "calc(100% - 56px)" }}>{questionBank}</div>
        </Panel>
      )}
    </Sidebar>
  );
}
