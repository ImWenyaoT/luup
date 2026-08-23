import assert from "node:assert/strict";
import { test } from "vitest";

import { searchArxiv } from "../src/agent/arxiv.ts";

const atom = (entries: string) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">${entries}</feed>`;

const entry = (id: string, title: string, extra = "") => `
  <entry>
    <id>http://arxiv.org/abs/${id}</id>
    <title>${title}</title>
    <summary>A summary of ${title}.</summary>
    <published>2024-01-01T00:00:00Z</published>
    <author><name>Ada Lovelace</name></author>
    ${extra}
  </entry>`;

function respond(body: string, init: ResponseInit = {}): typeof fetch {
  return (async () => new Response(body, { status: 200, ...init })) as unknown as typeof fetch;
}

test("maps a good Atom feed to succeeded and canonical https abs URLs", async () => {
  const result = await searchArxiv("retrieval augmented generation", {
    fetchImpl: respond(atom(entry("2301.12345v2", "Frozen Evidence Gates"))),
    minIntervalMs: 0,
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.records.length, 1);
  const record = result.records[0]!;
  assert.equal(record.arxivId, "2301.12345v2");
  // arXiv 自己返回的是 http://，我们统一成 https 的 abs 链接
  assert.equal(record.url, "https://arxiv.org/abs/2301.12345v2");
  assert.equal(record.title, "Frozen Evidence Gates");
  assert.deepEqual(record.authors, ["Ada Lovelace"]);
});

test("reports partial when some entries are unusable", async () => {
  const broken = "<entry><summary>no id and no title</summary></entry>";
  const result = await searchArxiv("q", {
    fetchImpl: respond(atom(entry("2401.00001v1", "Usable") + broken)),
    minIntervalMs: 0,
  });
  assert.equal(result.status, "partial");
  assert.equal(result.records.length, 1);
  assert.match(result.resultSummary, /1 unusable/);
});

test("reports empty for a feed with no entries", async () => {
  const result = await searchArxiv("q", { fetchImpl: respond(atom("")), minIntervalMs: 0 });
  assert.equal(result.status, "empty");
  assert.deepEqual(result.records, []);
});

test("refuses an empty query without touching the network", async () => {
  let called = false;
  const result = await searchArxiv("   ", {
    fetchImpl: (async () => {
      called = true;
      return new Response("");
    }) as unknown as typeof fetch,
    minIntervalMs: 0,
  });
  assert.equal(result.status, "refused");
  assert.equal(called, false);
});

test("maps HTTP 429 to rate_limited and other errors to source_unavailable", async () => {
  const limited = await searchArxiv("q", { fetchImpl: respond("", { status: 429 }), minIntervalMs: 0 });
  assert.equal(limited.status, "rate_limited");
  const unavailable = await searchArxiv("q", { fetchImpl: respond("", { status: 503 }), minIntervalMs: 0 });
  assert.equal(unavailable.status, "source_unavailable");
});

test("maps an aborted request to timeout and a transport error to failed", async () => {
  const timedOut = await searchArxiv("q", {
    fetchImpl: (async () => {
      const error = new Error("The operation was aborted due to timeout");
      error.name = "TimeoutError";
      throw error;
    }) as unknown as typeof fetch,
    minIntervalMs: 0,
  });
  assert.equal(timedOut.status, "timeout");

  const failed = await searchArxiv("q", {
    fetchImpl: (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch,
    minIntervalMs: 0,
  });
  assert.equal(failed.status, "failed");
});

test("never throws — every failure is encoded as a status", async () => {
  const result = await searchArxiv("q", { fetchImpl: respond("not xml at all <<<"), minIntervalMs: 0 });
  assert.ok(["failed", "empty"].includes(result.status));
  assert.deepEqual(result.records, []);
});

test("does not fetch after its Attempt signal is cancelled", async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;
  await assert.rejects(
    searchArxiv("q", {
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

test("serialises calls at least 3 seconds apart", async () => {
  const stamps: number[] = [];
  const fetchImpl = (async () => {
    stamps.push(Date.now());
    return new Response(atom(entry("2401.00002v1", "Rate limit probe")));
  }) as unknown as typeof fetch;

  await Promise.all([searchArxiv("first", { fetchImpl }), searchArxiv("second", { fetchImpl })]);

  assert.equal(stamps.length, 2);
  // 官方要求同源间隔 ≥3 秒。留 100ms 容差给定时器抖动。
  assert.ok(stamps[1]! - stamps[0]! >= 2_900, `gap was ${stamps[1]! - stamps[0]!}ms`);
  // 唯一一条真实等待墙钟的用例：限流闸是模块级的，本文件前面的调用已占用一个
  // 3 秒窗口，这两次串行下来要 ~6 秒，超过默认的 5 秒超时。
}, 20_000);
