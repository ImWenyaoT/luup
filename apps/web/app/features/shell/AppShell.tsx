import styled from "@emotion/styled";
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { ActivityIcon, CloseIcon, InspectIcon, LibraryIcon } from "../../Icons";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import type { InspectorKind } from "../../lib/types/inspector";
import { Button, colors, IconButton, mono } from "../../styles";
import { SettingsDialog, SettingsTrigger } from "../settings/SettingsDialog";

export type AppShellProps = {
  runId: string | null;
  onRunIdChange: (id: string | null) => void;
  onStartResearch: (question: string) => Promise<void>;
  sidebar: ReactNode;
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
  background: ${colors.canvas};
  overflow: hidden;
`;
const Topbar = styled.header`
  height: 56px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 18px;
  border-bottom: 1px solid ${colors.border};
  background: ${colors.surface};
  z-index: 40;
  @media (max-width: 700px) {
    height: 52px;
    padding: 0 10px;
    gap: 8px;
  }
`;
const Brand = styled.div`
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
  h1 {
    font-size: 20px;
    margin: 0;
    letter-spacing: -0.03em;
  }
  span {
    font-family: ${mono};
    font-size: 11px;
    color: ${colors.muted};
  }
`;
const Nav = styled.nav`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
`;
const DesktopOnly = styled.span`
  @media (max-width: 700px) {
    display: none;
  }
`;
const Body = styled.div`
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1;
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
const Inspector = styled.aside<{ side: "left" | "right" }>`
  order:${({ side }) => (side === "left" ? -1 : 1)};width:${({ side }) => (side === "left" ? "320px" : "420px")};flex:none;
  border-${({ side }) => (side === "left" ? "right" : "left")}:1px solid ${colors.border};background:${colors.surface};overflow:hidden;
  @media(max-width:900px){position:absolute;inset:0 0 0 auto;z-index:30;width:min(92vw,420px);box-shadow:-18px 0 40px rgba(16,24,40,.14)}
  @media(max-width:700px){width:100%}
`;
const Scrim = styled.button`
  display: none;
  @media (max-width: 900px) {
    display: block;
    position: absolute;
    inset: 0;
    z-index: 29;
    border: 0;
    background: rgba(16, 24, 40, 0.28);
  }
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
const inspectorMeta = {
  questions: { label: "Science 125 题库", side: "left" as const },
  artifacts: { label: "证据与冻结产物", side: "right" as const },
  process: { label: "轨迹、审计与反馈", side: "right" as const },
};

export function AppShell({
  sidebar,
  header,
  children,
  footer,
  inspector,
  onInspectorChange,
  inspectorContent,
}: AppShellProps) {
  const controlled = inspector !== undefined;
  const [localInspector, setLocalInspector] = useState<InspectorKind>("questions");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileInspector, setMobileInspector] = useState(false);
  const inspectorRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const previousActiveRef = useRef<InspectorKind>(null);
  const active = controlled ? inspector : localInspector;
  const setActive = useCallback(
    (value: InspectorKind) => (controlled ? onInspectorChange?.(value) : setLocalInspector(value)),
    [controlled, onInspectorChange],
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 900px)");
    const update = () => setMobileInspector(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useFocusTrap({
    active: Boolean(active),
    containerRef: inspectorRef,
    onEscape: () => setActive(null),
    autoFocus: mobileInspector,
    trapFocus: mobileInspector,
    suspended: settingsOpen,
    returnFocusRef,
  });

  useEffect(() => {
    const previousActive = previousActiveRef.current;
    const focused = document.activeElement;
    if (
      active &&
      previousActive !== active &&
      focused instanceof HTMLElement &&
      focused !== document.body &&
      !inspectorRef.current?.contains(focused)
    ) {
      returnFocusRef.current = focused;
    }
    previousActiveRef.current = active;
  }, [active]);

  const toggleInspector = (kind: Exclude<InspectorKind, null>, event: MouseEvent<HTMLButtonElement>) => {
    returnFocusRef.current = event.currentTarget;
    setActive(active === kind ? null : kind);
  };
  const meta = active ? inspectorMeta[active] : null;
  return (
    <Shell data-testid="app-shell">
      <Topbar>
        <Button
          compact
          data-testid="toggle-sidebar"
          title={active === "questions" ? "收起侧边栏" : "展开 Science 125 题库"}
          onClick={(event) => toggleInspector("questions", event)}
          aria-pressed={active === "questions"}
        >
          <LibraryIcon />
          <DesktopOnly>题库</DesktopOnly>
        </Button>
        <Brand>
          <h1>Luup</h1>
          <span>Science 125</span>
        </Brand>
        <Nav>
          <Button compact onClick={(event) => toggleInspector("process", event)} aria-pressed={active === "process"}>
            <ActivityIcon />
            <DesktopOnly>过程</DesktopOnly>
          </Button>
          <Button
            compact
            onClick={(event) => toggleInspector("artifacts", event)}
            aria-pressed={active === "artifacts"}
          >
            <InspectIcon />
            <DesktopOnly>产物</DesktopOnly>
          </Button>
          <SettingsTrigger onOpen={() => setSettingsOpen(true)} />
        </Nav>
      </Topbar>
      <Body>
        {active && meta && (
          <>
            <Scrim aria-label="关闭 Inspector" onClick={() => setActive(null)} />
            <Inspector
              ref={inspectorRef}
              side={meta.side}
              role={mobileInspector ? "dialog" : undefined}
              aria-modal={mobileInspector ? "true" : undefined}
              aria-labelledby="inspector-title"
              data-testid={active === "questions" ? "question-sidebar-panel" : "workspace-inspector"}
            >
              <InspectorTop>
                <h2 id="inspector-title">{meta.label}</h2>
                <IconButton
                  compact
                  aria-label={`关闭${meta.label}`}
                  onClick={() => setActive(null)}
                  style={{ marginLeft: "auto" }}
                >
                  <CloseIcon />
                </IconButton>
              </InspectorTop>
              <InspectorBody>{active === "questions" ? sidebar : inspectorContent}</InspectorBody>
            </Inspector>
          </>
        )}
        <Main inert={Boolean(active && mobileInspector)}>
          {header}
          <Scroll>{children}</Scroll>
          {footer}
        </Main>
      </Body>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </Shell>
  );
}
