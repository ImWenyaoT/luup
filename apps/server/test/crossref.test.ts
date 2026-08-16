import assert from "node:assert/strict";
import { test } from "vitest";

import { CrossrefLookupError, resolveCrossrefDoi, searchCrossref } from "../src/agent/crossref.ts";
import { EvidenceLedger } from "../src/agent/evidence.ts";
import { createRoles } from "../src/agent/roles/index.ts";

const work = (doi: string, title: string, extra: Record<string, unknown> = {}) => ({
  DOI: doi,
  title: [title],
  author: [{ given: "Ada", family: "Lovelace" }],
  issued: { "date-parts": [[2024, 3, 1]] },
  "container-title": ["Journal of Fixtures"],
  ...extra,
});

function respond(body: unknown, init: ResponseInit = {}): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status: 200, ...init })) as unknown as typeof fetch;
}

test("maps a Crossref result to a DOI-backed citable record", async () => {
  const result = await searchCrossref("retrieval augmented generation", {
    fetchImpl: respond({ message: { items: [work("10.1234/abcd", "Frozen Evidence Gates")] } }),
    minIntervalMs: 0,
  });
  assert.equal(result.status, "succeeded");
  const record = result.records[0]!;
  assert.equal(record.doi, "10.1234/abcd");
  // DOI 是这类来源唯一稳定的标识，URL 由它派生而不是原样透传
  assert.equal(record.url, "https://doi.org/10.1234/abcd");
  assert.equal(record.published, "2024-3-1");
  assert.deepEqual(record.authors, ["Ada Lovelace"]);
});

test("resolves one DOI through the exact works path with the Crossref User-Agent", async () => {
  let requested = "";
  let userAgent = "";
  const record = await resolveCrossrefDoi("10.1234/ABC%2FDEF", {
    minIntervalMs: 0,
    fetchImpl: (async (url: URL, init?: RequestInit) => {
      requested = url.toString();
      userAgent = String((init?.headers as Record<string, string>)?.["user-agent"]);
      return new Response(JSON.stringify({ message: work("10.1234/abc/def", "Exact DOI Work") }));
    }) as unknown as typeof fetch,
  });

  assert.equal(record?.doi, "10.1234/abc/def");
  assert.match(requested, /\/works\/10\.1234%2Fabc%2Fdef$/);
  assert.equal(new URL(requested).search, "");
  assert.match(userAgent, /mailto:/);
});

test("classifies a missing DOI as absent and Crossref 429/5xx as infrastructure errors", async () => {
  const missing = await resolveCrossrefDoi("10.1234/missing", {
    minIntervalMs: 0,
    fetchImpl: (async () => new Response("", { status: 404 })) as unknown as typeof fetch,
  });
  assert.equal(missing, null);

  for (const status of [429, 503]) {
    await assert.rejects(
      resolveCrossrefDoi("10.1234/down", {
        minIntervalMs: 0,
        fetchImpl: (async () => new Response("", { status })) as unknown as typeof fetch,
      }),
      CrossrefLookupError,
    );
  }
});

test("drops works without a DOI and reports partial", async () => {
  const result = await searchCrossref("q", {
    fetchImpl: respond({
      message: { items: [work("10.1/ok", "Usable"), { title: ["No DOI here"] }] },
    }),
    minIntervalMs: 0,
  });
  // 没有 DOI 就无从核验，宁可丢掉也不放进证据
  assert.equal(result.status, "partial");
  assert.equal(result.records.length, 1);
  assert.match(result.resultSummary, /1 unusable/);
});

test("encodes every Crossref failure as a status instead of throwing", async () => {
  const empty = await searchCrossref("q", { fetchImpl: respond({ message: { items: [] } }), minIntervalMs: 0 });
  assert.equal(empty.status, "empty");

  const limited = await searchCrossref("q", { fetchImpl: respond({}, { status: 429 }), minIntervalMs: 0 });
  assert.equal(limited.status, "rate_limited");

  const down = await searchCrossref("q", { fetchImpl: respond({}, { status: 500 }), minIntervalMs: 0 });
  assert.equal(down.status, "source_unavailable");

  const refused = await searchCrossref("   ", { fetchImpl: respond({}), minIntervalMs: 0 });
  assert.equal(refused.status, "refused");

  const broken = await searchCrossref("q", {
    fetchImpl: (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch,
    minIntervalMs: 0,
  });
  assert.equal(broken.status, "failed");
});

test("does not fetch after its Attempt signal is cancelled", async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;
  await assert.rejects(
    searchCrossref("q", {
      signal: controller.signal,
      fetchImpl: (async () => {
        called = true;
        return new Response("");
      }) as unknown as typeof fetch,
      minIntervalMs: 0,
    }),
  );
  assert.equal(called, false);
});

test("Researcher and Reviewer have retrieval surfaces, and other roles remain tool-free", () => {
  const { agents } = createRoles(new EvidenceLedger());
  // 检索面两个源，外加一个上报面 —— structured_output 不是来源，是交作业的通道
  assert.deepEqual(agents.researcher.tools.map((item: any) => item.name).sort(), [
    "arxiv_search",
    "crossref_search",
    "structured_output",
  ]);
  assert.deepEqual(agents.reviewer.tools.map((item: any) => item.name).sort(), ["arxiv_search", "crossref_search"]);
  assert.match(agents.reviewer.instructions as string, /反证/);
  assert.match(agents.reviewer.instructions as string, /方法风险/);
  // 其余角色零工具 —— 这是「只有 Researcher/Reviewer 可检索」的落点，不靠提示词
  for (const role of ["hypothesis-generation", "evidence-review", "research-plan"] as const) {
    assert.equal(agents[role].tools.length, 0, `${role} must not have tools`);
  }
  // 不设具名 toolChoice：Qwen 挂两个工具时拒绝 required，具名又会锁死只能用一个源
  assert.equal(agents.researcher.modelSettings.toolChoice, undefined);
});
