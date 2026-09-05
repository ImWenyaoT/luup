import { readFileSync } from "node:fs";

const minimum = 0.8;
const reportPath = "coverage/lcov.info";
const report = readFileSync(reportPath, "utf8");

let functionTotal = 0;
let functionHit = 0;
let lineTotal = 0;
let lineHit = 0;

const records = report.trim().split("end_of_record");
if (records.pop()?.trim() || records.length === 0) {
  throw new Error(`Coverage gate: empty or incomplete report at ${reportPath}.`);
}

for (const record of records) {
  const counts = new Map<string, number>();
  if (!/^SF:.+/m.test(record)) {
    throw new Error(`Coverage gate: missing source file in ${reportPath}.`);
  }
  for (const line of record.split("\n")) {
    const [key, rawValue] = line.trim().split(":", 2);
    if (!key || !["FNF", "FNH", "LF", "LH"].includes(key)) continue;
    const value = Number(rawValue);
    if (!rawValue || !Number.isSafeInteger(value) || value < 0 || counts.has(key)) {
      throw new Error(`Coverage gate: invalid ${key} count in ${reportPath}.`);
    }
    counts.set(key, value);
  }
  const totalFunctions = counts.get("FNF");
  const hitFunctions = counts.get("FNH");
  const totalLines = counts.get("LF");
  const hitLines = counts.get("LH");
  if (
    totalFunctions === undefined ||
    hitFunctions === undefined ||
    totalLines === undefined ||
    hitLines === undefined ||
    hitFunctions > totalFunctions ||
    hitLines > totalLines
  ) {
    throw new Error(`Coverage gate: missing or inconsistent counts in ${reportPath}.`);
  }
  functionTotal += totalFunctions;
  functionHit += hitFunctions;
  lineTotal += totalLines;
  lineHit += hitLines;
}

if (functionTotal === 0 || lineTotal === 0) {
  throw new Error(`Coverage gate: no measured functions or lines in ${reportPath}.`);
}

const functions = functionHit / functionTotal;
const lines = lineHit / lineTotal;
console.log(
  `Coverage gate: functions ${(functions * 100).toFixed(2)}% / lines ${(lines * 100).toFixed(2)}% ` +
    `(minimum ${(minimum * 100).toFixed(0)}%)`,
);

if (functions < minimum || lines < minimum) {
  throw new Error(`Coverage gate failed; see ${reportPath}.`);
}
