"use client";

import { Theme } from "@astryxdesign/core/theme";
import type { ReactNode } from "react";

import { defaultThemeSlug, themes } from "../../astryx-themes";

/** 根 Theme：Autoresearch / Mill 表面读同一套 Astryx token。 */
export function AstryxProvider({ children }: { children: ReactNode }) {
  return (
    <Theme theme={themes[defaultThemeSlug]} mode="system">
      {children}
    </Theme>
  );
}
