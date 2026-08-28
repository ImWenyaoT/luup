import styled from "@emotion/styled";
import { useRef, type KeyboardEvent } from "react";

import { CloseIcon } from "../../Icons";
import type { RunTab } from "../../hooks/useRunWorkingSet";
import { colors, mono } from "../../styles";

type RunTabsProps = {
  activeRunId: string | null;
  tabs: RunTab[];
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
};

const Bar = styled.div`
  min-height: 52px;
  flex: none;
  display: flex;
  align-items: stretch;
  gap: 0;
  overflow-x: auto;
  border-bottom: 1px solid ${colors.border};
  background: ${colors.surface};
  scrollbar-width: thin;
  @media (max-width: 900px) {
    padding-left: 48px;
  }
`;
const Empty = styled.span`
  align-self: center;
  padding: 0 14px;
  color: ${colors.muted};
  font-size: 11px;
`;
const Item = styled.div<{ selected: boolean }>`
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  border-bottom: 1px solid ${({ selected }) => (selected ? colors.ink : "transparent")};
  background: transparent;
`;
const Tab = styled.button`
  max-width: 220px;
  min-height: 51px;
  border: 0;
  background: transparent;
  padding: 6px 5px 6px 12px;
  color: ${colors.ink};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 400;
`;
const Close = styled.button`
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: ${colors.muted};
  svg {
    width: 14px;
    height: 14px;
  }
  &:hover {
    background: rgba(16, 24, 40, 0.08);
    color: ${colors.ink};
  }
`;
const Local = styled.span`
  flex: none;
  align-self: center;
  margin-left: auto;
  padding: 0 12px;
  color: ${colors.muted};
  font: 11px ${mono};
  white-space: nowrap;
`;

export function RunTabs({ activeRunId, tabs, onSelect, onClose }: RunTabsProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const selectedIndex = tabs.findIndex((tab) => tab.id === activeRunId);
  const rovingIndex = selectedIndex >= 0 ? selectedIndex : tabs.length ? 0 : -1;
  const closeTab = (tab: RunTab, index: number) => {
    const adjacent = tabs[index + 1] ?? tabs[index - 1] ?? null;
    const targetId =
      tab.id === activeRunId
        ? (adjacent?.id ?? null)
        : tabs.some((item) => item.id === activeRunId)
          ? activeRunId
          : (adjacent?.id ?? null);
    onClose(tab.id);
    requestAnimationFrame(() => {
      if (targetId) tabRefs.current.get(targetId)?.focus();
      else barRef.current?.focus();
    });
  };
  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLButtonElement>) => {
    if (!tabs.length) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      closeTab(tabs[index], index);
      return;
    }
    let targetIndex: number | null = null;
    if (event.key === "ArrowLeft") targetIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "ArrowRight") targetIndex = (index + 1) % tabs.length;
    else if (event.key === "Home") targetIndex = 0;
    else if (event.key === "End") targetIndex = tabs.length - 1;
    if (targetIndex === null) return;
    event.preventDefault();
    const target = tabs[targetIndex];
    onSelect(target.id);
    tabRefs.current.get(target.id)?.focus();
  };
  return (
    <Bar
      ref={barRef}
      role="tablist"
      aria-label="本机已打开的 Runs"
      data-testid="run-tabs"
      tabIndex={tabs.length ? undefined : 0}
    >
      {!tabs.length && <Empty>尚未打开 Run</Empty>}
      {tabs.map((tab, index) => {
        const selected = tab.id === activeRunId;
        return (
          <Item key={tab.id} selected={selected} role="presentation">
            <Tab
              ref={(element) => {
                if (element) tabRefs.current.set(tab.id, element);
                else tabRefs.current.delete(tab.id);
              }}
              id={`run-tab-${tab.id}`}
              role="tab"
              aria-selected={selected}
              aria-keyshortcuts="Delete Backspace"
              tabIndex={index === rovingIndex ? 0 : -1}
              title={tab.label}
              onClick={() => onSelect(tab.id)}
              onKeyDown={(event) => handleKeyDown(index, event)}
            >
              {tab.label}
            </Tab>
            <Close
              aria-hidden="true"
              tabIndex={-1}
              title={`关闭 Run ${tab.label}`}
              data-testid={`close-run-${tab.id}`}
              onClick={() => closeTab(tab, index)}
            >
              <CloseIcon />
            </Close>
          </Item>
        );
      })}
      <Local>本机 working set</Local>
    </Bar>
  );
}
