"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="zh-CN">
      <body>
        <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 32 }}>
          <div>
            <h1>应用启动失败</h1>
            <p style={{ marginTop: 8, color: "#475467" }}>{error.message || "根布局发生了未预期的错误。"}</p>
            <button type="button" onClick={reset} style={{ marginTop: 16 }}>
              重试
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
