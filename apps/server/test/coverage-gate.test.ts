import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const record = (functions: number, lines: number) =>
  `SF:src/example.ts\nFNF:10\nFNH:${functions}\nLF:10\nLH:${lines}\nend_of_record\n`;

for (const relativePath of ["./coverage-gate.ts", "../../web/test/coverage-gate.ts"]) {
  test(`coverage gate validates the actual report: ${relativePath}`, () => {
    const directory = mkdtempSync(join(tmpdir(), "luup-coverage-gate-"));
    const script = fileURLToPath(new URL(relativePath, import.meta.url));
    const cases: [string, string | undefined, boolean][] = [
      ["missing report", undefined, false],
      ["empty report", "", false],
      ["missing counts", "SF:src/example.ts\nend_of_record\n", false],
      ["negative count", record(-1, 10), false],
      ["invalid count", record(10, 10).replace("FNF:10", "FNF:bad"), false],
      ["inconsistent count", record(11, 10), false],
      ["truncated report", record(10, 10).replace("end_of_record", ""), false],
      ["zero totals", record(0, 0).replaceAll(":10", ":0"), false],
      ["low functions", record(7, 10), false],
      ["low lines", record(10, 7), false],
      ["exact threshold", record(8, 8), true],
      ["weighted totals", record(6, 6) + record(10, 10), true],
    ];
    try {
      mkdirSync(join(directory, "coverage"));
      for (const [label, report, passes] of cases) {
        if (report !== undefined) writeFileSync(join(directory, "coverage/lcov.info"), report);
        const result = spawnSync(process.execPath, [script], {
          cwd: directory,
          encoding: "utf8",
        });
        assert.equal(result.error, undefined);
        assert.equal(result.status === 0, passes, `${label}: ${result.stdout}${result.stderr}`);
        if (passes) assert.match(result.stdout, /functions 80\.00% \/ lines 80\.00%/);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
