import { readdirSync } from "node:fs";
import { join } from "node:path";

const dirs = readdirSync(join(process.cwd(), "agent", "subagents"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const expected = ["reviewer", "scientist"];
if (JSON.stringify(dirs) !== JSON.stringify(expected)) {
  console.error(`FAIL agent topology: expected ${expected.join(", ")}; got ${dirs.join(", ")}`);
  process.exit(1);
}

console.log("PASS agent topology: thin master + scientist + reviewer");
