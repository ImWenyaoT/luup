import styled from "@emotion/styled";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { CloseIcon, MenuIcon } from "../../Icons";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import type { RunTab } from "../../hooks/useRunWorkingSet";
import type { InspectorKind } from "../../lib/types/inspector";
import { colors, IconButton } from "../../styles";
import { SettingsDialog, SettingsTrigger } from "../settings/SettingsDialog";
import { ProjectSidebar } from "./ProjectSidebar";
import { RunTabs } from "./RunTabs";

export type AppShellProps = {
  runId: string | null;
  onRunIdChange: (id: string | null) => void;
  onStartResearch: (question: string) => Promise<void>;
  sidebar: ReactNode;
  runs?: RunTab[];
  onCloseRun?: (id: string) => void;
  header?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  inspector?: InspectorKind;
  onInspectorChange?: (value: InspectorKind) => void;
  inspectorContent?: ReactNode;
};

const Shell = styled.div`
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: ${colors.canvas};
`;
const Body = styled.div`
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1;
`;
const NavigationReserve = styled.div`
  position: relative;
  width: 288px;
  min-width: 288px;
  flex: none;
  background: ${colors.canvas};
  @media (max-width: 900px) {
    width: 0;
    min-width: 0;
  }
`;
const Navigation = styled.aside<{ expanded: boolean }>`
  position: absolute;
  inset: 0 auto 0 0;
  z-index: 35;
  width: ${({ expanded }) => (expanded ? "288px" : "48px")};
  overflow: hidden;
  border-right: 1px solid ${colors.border};
  background: ${colors.surface};
  transition: width 140ms ease;
  @media (max-width: 900px) {
    position: fixed;
    top: 0;
    bottom: 0;
    display: ${({ expanded }) => (expanded ? "block" : "none")};
    width: min(92vw, 360px);
    box-shadow: 18px 0 40px rgba(16, 24, 40, 0.16);
  }
  @media (max-width: 420px) {
    width: 100%;
  }
`;
const Rail = styled.div`
  height: 100%;
  display: grid;
  align-content: start;
  justify-content: center;
  padding-top: 10px;
`;
const MobileTrigger = styled(IconButton)`
  display: none;
  @media (max-width: 900px) {
    position: absolute;
    top: 5px;
    left: 6px;
    z-index: 33;
    display: grid;
  }
  &[hidden] {
    display: none;
  }
`;
const Main = styled.main`
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
`;
const Scroll = styled.div`
  flex: 1;
  overflow: auto;
  padding: 24px;
  @media (max-width: 700px) {
    padding: 16px 12px 108px;
  }
`;
const Inspector = styled.aside`
  position: absolute;
  inset: 0 0 0 auto;
  z-index: 30;
  width: 420px;
  overflow: hidden;
  border-left: 1px solid ${colors.border};
  background: ${colors.surface};
  box-shadow: -18px 0 40px rgba(16, 24, 40, 0.1);
  @media (max-width: 900px) {
    z-index: 40;
    width: min(92vw, 420px);
    box-shadow: -18px 0 40px rgba(16, 24, 40, 0.14);
  }
  @media (max-width: 700px) {
    width: 100%;
  }
`;
const Scrim = styled.button`
  display: none;
  @media (max-width: 900px) {
    display: block;
    position: absolute;
    inset: 0;
    z-index: 34;
    border: 0;
    background: rgba(16, 24, 40, 0.28);
  }
`;
const InspectorScrim = styled(Scrim)`
  z-index: 39;
`;
const InspectorTop = styled.div`
  height: 52px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  border-bottom: 1px solid ${colors.border};
  h2 {
    margin: 0;
    font-size: 13px;
  }
`;
const InspectorBody = styled.div`
  height: calc(100% - 52px);
  overflow: auto;
`;
const inspectorMeta = { artifacts: "证据与冻结产物", process: "轨迹、审计与反馈" };

export function AppShell({
  runId,
  onRunIdChange,
  sidebar,
  runs = [],
  onCloseRun,
  header,
  children,
  footer,
  inspector,
  onInspectorChange,
  inspectorContent,
}: AppShellProps) {
  const controlled = inspector !== undefined;
  const [localInspector, setLocalInspector] = useState<InspectorKind>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [navigationExpanded, setNavigationExpanded] = useState(true);
  const responsiveInitialized = useRef(false);
  const previousRunIdRef = useRef(runId);
  const navigationRef = useRef<HTMLElement>(null);
  const navigationTriggerRef = useRef<HTMLElement | null>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const inspectorReturnFocusRef = useRef<HTMLElement | null>(null);
  const activeInspector = controlled ? inspector : localInspector;
  const setInspector = useCallback(
    (value: InspectorKind) => (controlled ? onInspectorChange?.(value) : setLocalInspector(value)),
    [controlled, onInspectorChange],
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 900px)");
    const update = () => {
      setMobile(query.matches);
      if (!responsiveInitialized.current) {
        setNavigationExpanded(!query.matches);
        responsiveInitialized.current = true;
      } else if (!query.matches) setNavigationExpanded(true);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (mobile && previousRunIdRef.current !== runId) setNavigationExpanded(false);
    previousRunIdRef.current = runId;
  }, [mobile, runId]);

  useFocusTrap({
    active: mobile && navigationExpanded,
    containerRef: navigationRef,
    onEscape: () => setNavigationExpanded(false),
    suspended: settingsOpen,
    returnFocusRef: navigationTriggerRef,
  });
  useFocusTrap({
    active: Boolean(activeInspector),
    containerRef: inspectorRef,
    onEscape: () => setInspector(null),
    autoFocus: mobile,
    trapFocus: mobile,
    suspended: settingsOpen,
    returnFocusRef: inspectorReturnFocusRef,
  });

  const toggleNavigation = (trigger: HTMLElement) => {
    if (!navigationExpanded) navigationTriggerRef.current = trigger;
    setNavigationExpanded((value) => !value);
  };
  const meta = activeInspector ? inspectorMeta[activeInspector] : null;
  const mainInert = mobile && (navigationExpanded || Boolean(activeInspector));
  return (
    <Shell data-testid="app-shell">
      <Body>
        {mobile && (
          <MobileTrigger
            hidden={navigationExpanded}
            compact
            data-testid="toggle-sidebar"
            title="展开项目导航"
            aria-label="展开项目导航"
            aria-expanded="false"
            onClick={(event) => toggleNavigation(event.currentTarget)}
          >
            <MenuIcon />
          </MobileTrigger>
        )}
        {mobile && navigationExpanded && (
          <Scrim aria-label="关闭项目导航" onClick={() => setNavigationExpanded(false)} />
        )}
        <NavigationReserve data-testid="sidebar-layout-reserve" data-layout-strategy="fixed-reserve">
          {(!mobile || navigationExpanded) && (
            <Navigation
              ref={navigationRef}
              expanded={navigationExpanded}
              role={mobile ? "dialog" : undefined}
              aria-modal={mobile ? "true" : undefined}
              aria-label="Science 125 项目导航"
              data-testid="question-sidebar-panel"
              data-collapsed={!navigationExpanded}
            >
              {navigationExpanded ? (
                <ProjectSidebar
                  activeRunId={runId}
                  runs={runs}
                  onSelectRun={(id) => {
                    onRunIdChange(id);
                    if (mobile) setNavigationExpanded(false);
                  }}
                  questionBank={sidebar}
                  settings={<SettingsTrigger onOpen={() => setSettingsOpen(true)} />}
                  onCollapse={toggleNavigation}
                  collapseLabel={mobile ? "关闭项目导航" : "收起侧边栏"}
                  mobile={mobile}
                />
              ) : (
                <Rail>
                  <IconButton
                    compact
                    data-testid="toggle-sidebar"
                    title="展开项目导航"
                    aria-label="展开项目导航"
                    onClick={(event) => toggleNavigation(event.currentTarget)}
                  >
                    <MenuIcon />
                  </IconButton>
                </Rail>
              )}
            </Navigation>
          )}
        </NavigationReserve>
        <Main inert={mainInert} data-testid="app-main" data-inspector-layout="overlay">
          <RunTabs activeRunId={runId} tabs={runs} onSelect={onRunIdChange} onClose={(id) => onCloseRun?.(id)} />
          {header}
          <Scroll>{children}</Scroll>
          {footer}
        </Main>
        {activeInspector && meta && (
          <>
            <InspectorScrim aria-label="关闭 Inspector" onClick={() => setInspector(null)} />
            <Inspector
              ref={inspectorRef}
              role={mobile ? "dialog" : undefined}
              aria-modal={mobile ? "true" : undefined}
              aria-labelledby="inspector-title"
              data-testid="workspace-inspector"
            >
              <InspectorTop>
                <h2 id="inspector-title">{meta}</h2>
                <IconButton
                  compact
                  aria-label={`关闭${meta}`}
                  onClick={() => setInspector(null)}
                  style={{ marginLeft: "auto" }}
                >
                  <CloseIcon />
                </IconButton>
              </InspectorTop>
              <InspectorBody>{inspectorContent}</InspectorBody>
            </Inspector>
          </>
        )}
      </Body>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </Shell>
  );
}
