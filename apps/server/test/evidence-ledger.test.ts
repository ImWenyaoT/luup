import assert from "node:assert/strict";
import { test } from "vitest";

import { EvidenceLedger } from "../src/agent/evidence.ts";

const input = {
  tool: "arxiv_search",
  sourceType: "arxiv" as const,
  query: "q",
  status: "succeeded" as const,
  resultSummary: "one result",
  citations: [],
};

test("a persistence failure cannot leave ghost evidence in the in-memory ledger", () => {
  let fail = true;
  const ledger = new EvidenceLedger({
    onRecord: () => {
      if (fail) throw new Error("sqlite unavailable");
    },
  });
  ledger.beginScope("attempt-1");

  assert.throws(() => ledger.record(input), /sqlite unavailable/);
  assert.deepEqual(ledger.values(), []);
  assert.deepEqual(ledger.scopedRecords(), []);

  fail = false;
  const persisted = ledger.record(input);
  assert.equal(persisted.evidenceId, "ev_02_arxiv");
  assert.deepEqual(ledger.values(), [persisted]);
  assert.deepEqual(ledger.scopedRecords(), [persisted]);
});

test("adapter execution diagnostics survive the ledger commit", () => {
  const persisted: unknown[] = [];
  const ledger = new EvidenceLedger({ onRecord: (record) => persisted.push(record) });
  const record = ledger.record({
    ...input,
    status: "source_unavailable",
    execution: {
      request_url: "https://export.arxiv.org/api/query",
      exception_type: "TimeoutError",
      message: "request timed out",
    },
  });

  assert.deepEqual(record.execution, {
    request_url: "https://export.arxiv.org/api/query",
    exception_type: "TimeoutError",
    message: "request timed out",
  });
  assert.deepEqual(persisted, [record]);
});
