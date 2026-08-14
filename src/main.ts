import { createDefaultApp, runtimeMode } from "./server.ts";

const port = Number(process.env.PORT || 8000);
createDefaultApp().listen(port, "127.0.0.1", () => {
  const mode = runtimeMode() === "deterministic" ? "deterministic（不花钱）" : "live（会调 Qwen）";
  process.stdout.write(`luup api http://127.0.0.1:${port} · runtime=${mode}\n`);
});
