"use client";

import type { ReactNode } from "react";

import { ApiProvider } from "./providers/api";
import { QueryProvider } from "./providers/query";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <ApiProvider>{children}</ApiProvider>
    </QueryProvider>
  );
}
