"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 32 }}>
      <div>
        <h1>页面出错</h1>
        <p style={{ marginTop: 8, color: "#475467" }}>{error.message || "发生了未预期的错误。"}</p>
        <button type="button" onClick={reset} style={{ marginTop: 16 }}>
          重试
        </button>
      </div>
    </main>
  );
}
