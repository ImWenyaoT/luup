import { createDefaultApp, runtimeMode } from "./server.ts";

const port = Number(process.env.PORT || 8000);
const hostname = process.env.LUUP_HOSTNAME?.trim() || "127.0.0.1";
const server = createDefaultApp({ port, hostname });
const mode = runtimeMode() === "deterministic" ? "deterministic（不花钱）" : "live（会调 Qwen）";
process.stdout.write(`luup api ${server.url.origin} · runtime=${mode}\n`);
