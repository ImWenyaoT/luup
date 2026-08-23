import { readFileSync } from "node:fs";

const minimum = 0.8;
const reportPath = "coverage/lcov.info";
const report = readFileSync(reportPath, "utf8");

let functionTotal = 0;
let functionHit = 0;
let lineTotal = 0;
let lineHit = 0;

for (const record of report.split("end_of_record")) {
  for (const line of record.split("\n")) {
    const [key, rawValue] = line.split(":", 2);
    const value = Number(rawValue);
    if (!Number.isFinite(value)) continue;
    if (key === "FNF") functionTotal += value;
    if (key === "FNH") functionHit += value;
    if (key === "LF") lineTotal += value;
    if (key === "LH") lineHit += value;
  }
}

const functions = functionTotal === 0 ? 1 : functionHit / functionTotal;
const lines = lineTotal === 0 ? 1 : lineHit / lineTotal;
console.log(
  `Coverage gate: functions ${(functions * 100).toFixed(2)}% / lines ${(lines * 100).toFixed(2)}% ` +
    `(minimum ${(minimum * 100).toFixed(0)}%)`,
);

if (functions < minimum || lines < minimum) {
  throw new Error(`Coverage gate failed; see ${reportPath}.`);
}
