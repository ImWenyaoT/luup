"use client";

import dynamic from "next/dynamic";

function Loading() {
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 32 }}>
      <p style={{ color: "#667085", fontSize: 14 }}>Loading…</p>
    </main>
  );
}

const ResearchWorkspace = dynamic(() => import("../research-workspace"), {
  ssr: false,
  loading: Loading,
});

/** Science-125 legacy 工作台（产品入口已切到 /autoresearch）。 */
export default function LegacyPage() {
  return <ResearchWorkspace />;
}
