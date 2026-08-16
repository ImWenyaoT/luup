import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./index.css";

// dark 默认跟随系统（设计身份的常任要求）。tailwind 的 dark variant 是 class 制
// （index.css 的 @custom-variant），没有这几行，.dark 令牌永远不会生效。
const media = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => document.documentElement.classList.toggle("dark", media.matches);
applyTheme();
media.addEventListener("change", applyTheme);

const container = document.getElementById("root");
if (container === null) throw new Error("Missing #root mount point.");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
