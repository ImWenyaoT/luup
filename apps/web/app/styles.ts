import { css } from "@emotion/react";
import styled from "@emotion/styled";

export const colors = {
  ink: "#101828",
  muted: "#667085",
  faint: "#98a2b3",
  border: "#e4e7ec",
  canvas: "#f8fafc",
  surface: "#ffffff",
  accent: "#155eef",
  accentSoft: "#eff4ff",
  success: "#067647",
  successSoft: "#ecfdf3",
  danger: "#b42318",
  dangerSoft: "#fef3f2",
} as const;

export const globalStyles = css`
  :root {
    color-scheme: light;
    font-family:
      Inter,
      ui-sans-serif,
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      sans-serif;
  }
  * {
    box-sizing: border-box;
  }
  html,
  body {
    width: 100%;
    height: 100%;
    margin: 0;
    overflow: hidden;
    background: ${colors.canvas};
    color: ${colors.ink};
  }
  body {
    font-size: 14px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  button,
  input,
  textarea,
  select {
    font: inherit;
  }
  button {
    cursor: pointer;
  }
  button:disabled {
    cursor: not-allowed;
  }
  a {
    color: inherit;
  }
  :focus-visible {
    outline: 3px solid rgba(21, 94, 239, 0.22);
    outline-offset: 2px;
  }
`;

export const mono = `"SFMono-Regular", Consolas, "Liberation Mono", monospace`;

export const Button = styled.button<{ tone?: "primary" | "quiet" | "danger"; compact?: boolean }>`
  min-height: ${({ compact }) => (compact ? "32px" : "40px")};
  border: 1px solid
    ${({ tone }) => (tone === "primary" ? colors.accent : tone === "danger" ? "#fda29b" : colors.border)};
  border-radius: 9px;
  padding: ${({ compact }) => (compact ? "5px 10px" : "8px 14px")};
  background: ${({ tone }) => (tone === "primary" ? colors.accent : tone === "danger" ? colors.dangerSoft : colors.surface)};
  color: ${({ tone }) => (tone === "primary" ? "white" : tone === "danger" ? colors.danger : colors.ink)};
  font-size: 13px;
  font-weight: 600;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    transform 0.15s ease;
  &:hover:not(:disabled) {
    filter: brightness(0.98);
    border-color: ${({ tone }) => (tone === "primary" ? "#004eeb" : "#b8c0cc")};
  }
  &:active:not(:disabled) {
    transform: translateY(1px);
  }
  &:disabled {
    opacity: 0.48;
  }
`;

export const IconButton = styled(Button)`
  width: 36px;
  min-width: 36px;
  padding: 0;
  display: inline-grid;
  place-items: center;
`;

export const Input = styled.input`
  width: 100%;
  height: 40px;
  border: 1px solid ${colors.border};
  border-radius: 9px;
  background: ${colors.surface};
  color: ${colors.ink};
  padding: 0 12px;
  font-size: 13px;
  &::placeholder {
    color: ${colors.faint};
  }
  &:focus {
    border-color: ${colors.accent};
    outline: 3px solid rgba(21, 94, 239, 0.1);
  }
  &:disabled {
    background: #f2f4f7;
  }
`;

export const Textarea = styled.textarea`
  width: 100%;
  border: 1px solid ${colors.border};
  border-radius: 10px;
  background: ${colors.surface};
  color: ${colors.ink};
  padding: 11px 12px;
  resize: none;
  font-size: 13px;
  line-height: 1.5;
  &::placeholder {
    color: ${colors.faint};
  }
  &:focus {
    border-color: ${colors.accent};
    outline: 3px solid rgba(21, 94, 239, 0.1);
  }
  &:disabled {
    background: #f2f4f7;
  }
`;

export const Label = styled.label`
  display: grid;
  gap: 6px;
  color: ${colors.ink};
  font-size: 12px;
  font-weight: 600;
`;

export const SectionTitle = styled.h2`
  margin: 0;
  color: ${colors.muted};
  font-family: ${mono};
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

export const Surface = styled.div`
  border: 1px solid ${colors.border};
  border-radius: 12px;
  background: ${colors.surface};
`;

export const Status = styled.span<{ tone?: "success" | "danger" | "neutral" }>`
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  border-radius: 999px;
  padding: 2px 9px;
  background: ${({ tone }) => (tone === "success" ? colors.successSoft : tone === "danger" ? colors.dangerSoft : "#f2f4f7")};
  color: ${({ tone }) => (tone === "success" ? colors.success : tone === "danger" ? colors.danger : colors.muted)};
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
`;

export const visuallyHidden = css`
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
`;
