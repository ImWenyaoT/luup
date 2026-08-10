import { existsSync } from "node:fs";
import { join } from "node:path";

// 拓扑 = 薄 master + scientist + reviewer（product-contract.md）。
// 布局 = lib/agents/<name>.ts + 同址 <name>.md（Next「应用代码在根」策略 + Vercel lib 域惯例）。
const agentsDir = join(process.cwd(), "lib", "agents");
const expected = ["master", "scientist", "reviewer"];
const missing = expected.flatMap((name) =>
  [`${name}.ts`, `${name}.md`].filter((f) => !existsSync(join(agentsDir, f))),
);
if (missing.length > 0) {
  console.error(`FAIL agent topology: lib/agents/ 缺 ${missing.join(", ")}`);
  process.exit(1);
}

console.log("PASS agent topology: thin master + scientist + reviewer");
