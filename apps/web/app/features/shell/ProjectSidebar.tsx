import styled from "@emotion/styled";
import { useState, type ReactNode } from "react";

import { LibraryIcon, MenuIcon } from "../../Icons";
import type { RunTab } from "../../hooks/useRunWorkingSet";
import { colors, IconButton, mono } from "../../styles";

type ProjectSidebarProps = {
  activeRunId: string | null;
  runs: RunTab[];
  onSelectRun: (id: string) => void;
  questionBank: ReactNode;
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
const Header = styled.div`
  min-height: 56px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid ${colors.border};
`;
const Brand = styled.div`
  min-width: 0;
  display: grid;
  line-height: 1.15;
  h1 {
    margin: 0;
    font-size: 17px;
    letter-spacing: -0.03em;
  }
  small {
    color: ${colors.muted};
    font: 9px ${mono};
  }
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

const Tree = styled.ul`
  flex: 1;
  margin: 0;
  padding: 10px;
  overflow: auto;
  list-style: none;
`;
const Group = styled.ul`
  margin: 2px 0 0;
  padding: 0 0 0 12px;
  list-style: none;
`;
const NodeButton = styled.button<{ depth?: number; selected?: boolean }>`
  width: 100%;
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 7px;
  border: 0;
  border-radius: 8px;
  padding: 6px 8px;
  background: ${({ selected }) => (selected ? colors.accentSoft : "transparent")};
  color: ${({ selected }) => (selected ? colors.accent : colors.ink)};
  text-align: left;
  font-size: 12px;
  font-weight: ${({ depth }) => (depth === 0 ? 700 : 600)};
  &:hover {
    background: ${({ selected }) => (selected ? colors.accentSoft : "#f2f4f7")};
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
  font: 9px ${mono};
`;
const Panel = styled.div`
  height: min(52vh, 520px);
  min-height: 220px;
  margin: 4px 0 8px;
  overflow: hidden;
  border: 1px solid ${colors.border};
  border-radius: 10px;
  background: white;
`;
const RunList = styled.ul`
  display: grid;
  gap: 2px;
  margin: 3px 0 8px;
  padding: 0;
  list-style: none;
`;
const RunButton = styled(NodeButton)`
  display: grid;
  gap: 1px;
  padding-left: 18px;
  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  small {
    color: ${colors.muted};
    font: 9px ${mono};
  }
`;
const LocalNote = styled.p`
  margin: 3px 8px 8px 18px;
  color: ${colors.muted};
  font-size: 10px;
  line-height: 1.4;
`;

export function ProjectSidebar({
  activeRunId,
  runs,
  onSelectRun,
  questionBank,
  settings,
  onCollapse,
  collapseLabel,
  mobile,
}: ProjectSidebarProps) {
  const [projectExpanded, setProjectExpanded] = useState(true);
  const [questionsExpanded, setQuestionsExpanded] = useState(true);
  const [runsExpanded, setRunsExpanded] = useState(true);
  return (
    <Sidebar aria-label="项目导航" data-testid="project-sidebar">
      <Header>
        <Brand>
          <h1>Luup</h1>
          <small>Science 125</small>
        </Brand>
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
      <Tree aria-label="Science 125 项目导航层级">
        <li>
          <NodeButton depth={0} aria-expanded={projectExpanded} onClick={() => setProjectExpanded((value) => !value)}>
            <Disclosure expanded={projectExpanded}>›</Disclosure>
            <LibraryIcon width="16" height="16" />
            <span>Science 125</span>
            <ProjectMeta>PROJECT</ProjectMeta>
          </NodeButton>
          {projectExpanded && (
            <Group>
              <li>
                <NodeButton aria-expanded={questionsExpanded} onClick={() => setQuestionsExpanded((value) => !value)}>
                  <Disclosure expanded={questionsExpanded}>›</Disclosure>
                  <span>题库</span>
                </NodeButton>
                {questionsExpanded && <Panel data-testid="question-bank-tree-panel">{questionBank}</Panel>}
              </li>
              <li>
                <NodeButton aria-expanded={runsExpanded} onClick={() => setRunsExpanded((value) => !value)}>
                  <Disclosure expanded={runsExpanded}>›</Disclosure>
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
                          <small>{run.id}</small>
                        </RunButton>
                      </li>
                    ))}
                    {!runs.length && (
                      <li>
                        <LocalNote>本机尚未打开 Run</LocalNote>
                      </li>
                    )}
                    <li>
                      <LocalNote>仅记录此浏览器打开过的 Run，不是服务端历史。</LocalNote>
                    </li>
                  </RunList>
                )}
              </li>
            </Group>
          )}
        </li>
      </Tree>
    </Sidebar>
  );
}
