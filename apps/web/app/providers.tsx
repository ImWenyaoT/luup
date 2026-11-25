"use client";

import type { ReactNode } from "react";

import { ApiProvider } from "./providers/api";
import { AstryxProvider } from "./providers/astryx";
import { QueryProvider } from "./providers/query";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AstryxProvider>
      <QueryProvider>
        <ApiProvider>{children}</ApiProvider>
      </QueryProvider>
    </AstryxProvider>
  );
}
