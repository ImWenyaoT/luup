import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { Global } from "@emotion/react";

import type { Route } from "./+types/root";
import { ApiProvider } from "./providers/api";
import { QueryProvider } from "./providers/query";
import { globalStyles } from "./styles";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <Global styles={globalStyles} />
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function HydrateFallback() {
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 32 }}>
      <p style={{ color: "#667085", fontSize: 14 }}>Loading…</p>
    </main>
  );
}

export default function App() {
  return (
    <QueryProvider>
      <ApiProvider>
        <Outlet />
      </ApiProvider>
    </QueryProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details = error.status === 404 ? "The requested page could not be found." : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 32 }}>
      <div>
        <h1>{message}</h1>
        <p style={{ marginTop: 8, color: "#475467" }}>{details}</p>
        {stack && (
          <pre
            style={{
              marginTop: 16,
              maxWidth: 768,
              overflowX: "auto",
              borderRadius: 8,
              background: "#f2f4f7",
              padding: 16,
              fontSize: 12,
            }}
          >
            <code>{stack}</code>
          </pre>
        )}
      </div>
    </main>
  );
}
