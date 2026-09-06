import assert from "node:assert/strict";
import { test } from "vitest";

import { ArxivLookupError, fetchArxivByIds, publishedYear } from "../src/agent/arxiv.ts";
import type { Research, ResearchPlan } from "../src/agent/contracts.ts";
import {
  checkFrozenMembership,
  checkReferenceCount,
  checkResolvedMetadata,
  checkResolvedTitles,
  collectFrozenCards,
  extractDoi,
  extractArxivId,
  normalizeArxivId,
  resolveTargets,
  surnameOf,
  titleOverlap,
  TITLE_OVERLAP_THRESHOLD,
  type FrozenCitation,
  type ResolvedRecord,
} from "../src/verify/references.ts";
import { createReferenceVerifier, verificationFailureCode, type ArxivLookup } from "../src/verify/verifier.ts";

const card: FrozenCitation = {
  source_type: "arxiv",
  title: "Frozen Evidence Gates for Research Agents",
  locator: "arxiv:2301.12345v2",
  url: "https://arxiv.org/abs/2301.12345v2",
  authors: ["Ada Lovelace", "Grace Hopper"],
  year: 2023,
};

const doiCard: FrozenCitation = {
  source_type: "web",
  title: "A Journal Article",
  locator: "doi:10.1000/xyz123",
  url: "https://doi.org/10.1000/xyz123",
};

const doiCards: FrozenCitation[] = Array.from({ length: 5 }, (_, index) => {
  const doi = `10.1000/xyz${index + 1}`;
  return {
    source_type: "web",
    title: `Frozen DOI Article ${index + 1}`,
    locator: `doi:${doi.toUpperCase()}`,
    url: `https://doi.org/${doi}`,
    authors: ["Ada Lovelace"],
    year: 2024,
  };
});

const doiRecords = doiCards.map((item) => ({
  doi: item.locator.slice("doi:".length).toLowerCase(),
  title: item.title,
  authors: item.authors!,
  year: item.year!,
}));

const doiPlan = () => plan(doiCards.map((item) => item.url!));

const remote: ResolvedRecord = {
  arxivId: "2301.12345v2",
  title: "Frozen Evidence Gates for Research Agents",
  authors: ["Ada Lovelace", "Grace Hopper"],
  year: 2023,
};

const resolved = (...records: ResolvedRecord[]) =>
  new Map(records.map((record) => [normalizeArxivId(record.arxivId), record]));

const plan = (references: string[]) => ({ references }) as unknown as ResearchPlan;
const research = (citations: FrozenCitation[]) => [{ citations } as unknown as Research];

const passing = (checks: { id: string; pass: boolean }[], prefix: string) =>
  checks.filter((check) => check.id.startsWith(prefix)).map((check) => check.pass);

// --- URL → arXiv id -----------------------------------------------------

test("extracts arXiv ids from every writing the pipeline actually produces", () => {
  assert.equal(extractArxivId("https://arxiv.org/abs/2301.12345v2"), "2301.12345v2");
  assert.equal(extractArxivId("http://arxiv.org/abs/2301.12345"), "2301.12345");
  assert.equal(extractArxivId("https://www.arxiv.org/pdf/2301.12345v1"), "2301.12345v1");
  assert.equal(extractArxivId("https://export.arxiv.org/pdf/2301.12345v1.pdf"), "2301.12345v1");
  assert.equal(extractArxivId("https://arxiv.org/abs/2301.12345/"), "2301.12345");
  // 旧式 id 自带一个斜杠，按最后一段取会把它切坏
  assert.equal(extractArxivId("https://arxiv.org/abs/hep-th/9901001v1"), "hep-th/9901001v1");
  // 检索台账的 locator 写法
  assert.equal(extractArxivId("arxiv:2301.12345v2"), "2301.12345v2");
});

test("refuses to invent an arXiv id for anything that is not one", () => {
  // Crossref/DOI 与普通网页没有反查通路，必须提不出 id，才会被如实分到只走 B1 的那层
  assert.equal(extractArxivId("https://doi.org/10.1000/xyz123"), null);
  assert.equal(extractArxivId("https://example.com/abs/2301.12345"), null);
  // 冒充 arXiv 域名的主机不算
  assert.equal(extractArxivId("https://arxiv.org.evil.com/abs/2301.12345"), null);
  // 路径对但 id 不合规范
  assert.equal(extractArxivId("https://arxiv.org/abs/not-an-id"), null);
  assert.equal(extractArxivId("arxiv:not-an-id"), null);
  assert.equal(extractArxivId("2301.12345"), null);
  assert.equal(extractArxivId(""), null);
});

test("extracts and normalizes DOI URLs and locators", () => {
  assert.equal(extractDoi("https://doi.org/10.1000/XYZ%2FABC"), "10.1000/xyz/abc");
  assert.equal(extractDoi("doi:10.1000/XYZ%2FABC"), "10.1000/xyz/abc");
  assert.equal(extractDoi("https://example.com/10.1000/xyz"), null);
});

test("treats versions of one paper as the same paper", () => {
  assert.equal(normalizeArxivId("2301.12345v2"), "2301.12345");
  assert.equal(normalizeArxivId("HEP-TH/9901001V3"), "hep-th/9901001");
  assert.equal(normalizeArxivId("2301.12345"), "2301.12345");
});

// --- 标题与姓氏归一化 ---------------------------------------------------

test("scores title overlap on the longer title and ignores punctuation and case", () => {
  assert.equal(titleOverlap("Frozen Evidence Gates", "frozen, evidence gates!"), 1);
  // 覆盖率按较长的一方算：子集不等于同一篇论文，2/5 而不是 2/2
  assert.equal(titleOverlap("Frozen Evidence", "Frozen Evidence Gates For Agents"), 0.4);
  assert.equal(titleOverlap("", "Frozen Evidence"), 0);
  assert.equal(titleOverlap("...", "Frozen Evidence"), 0);
});

test("extracts a comparable surname from the common author writings", () => {
  assert.equal(surnameOf("Yann LeCun"), "lecun");
  assert.equal(surnameOf("LeCun, Yann"), "lecun");
  assert.equal(surnameOf("Roberto Dessì"), "dessi");
  assert.equal(surnameOf("  "), "");
  assert.equal(surnameOf("张三"), "张三");
});

// --- B3 -----------------------------------------------------------------

test("B3 requires at least five references", () => {
  assert.equal(checkReferenceCount(Array(5).fill("https://arxiv.org/abs/2301.12345")).pass, true);
  const short = checkReferenceCount(["https://arxiv.org/abs/2301.12345"]);
  assert.equal(short.pass, false);
  assert.match(short.detail, /references = 1/);
});

// --- B1 -----------------------------------------------------------------

test("B1 accepts only references frozen in this run's evidence", () => {
  const cards = collectFrozenCards([card, doiCard]);
  const targets = resolveTargets(
    // 第三条从未被检索到，第四条根本不是 http(s) 地址
    [card.url!, doiCard.url!, "https://arxiv.org/abs/2999.99999", "见参考文献 3"],
    cards,
  );
  assert.deepEqual(
    checkFrozenMembership(targets, cards.size).map((check) => check.pass),
    [true, true, false, false],
  );
});

test("B1 compares normalized URLs so a trailing slash is not fabrication", () => {
  const cards = collectFrozenCards([card]);
  const targets = resolveTargets([`${card.url!}/`], cards);
  assert.equal(checkFrozenMembership(targets, cards.size)[0]!.pass, true);
});

// --- B2 -----------------------------------------------------------------

test("B2 passes when the frozen title still matches an independent arXiv lookup", () => {
  const targets = resolveTargets([card.url!], collectFrozenCards([card]));
  const checks = checkResolvedTitles(targets, resolved(remote));
  assert.deepEqual(
    checks.map((check) => check.id),
    ["B2.2301.12345"],
  );
  assert.equal(checks[0]!.pass, true);
  assert.match(checks[0]!.detail, /标题重合度 1\.00/);
});

test("B2 fails a frozen title that drifted away from the real paper", () => {
  const targets = resolveTargets([card.url!], collectFrozenCards([card]));
  const drifted = { ...remote, title: "An Entirely Different Paper About Something Else" };
  const checks = checkResolvedTitles(targets, resolved(drifted));
  assert.equal(checks[0]!.pass, false);
  // 阈值就在判据里，不是隐含常数
  assert.match(checks[0]!.detail, new RegExp(`阈值 ${TITLE_OVERLAP_THRESHOLD}`));
});

test("B2 fails when the id does not exist on arXiv at all", () => {
  const targets = resolveTargets([card.url!], collectFrozenCards([card]));
  const checks = checkResolvedTitles(targets, resolved());
  assert.equal(checks[0]!.pass, false);
  assert.match(checks[0]!.detail, /反查无结果/);
});

// --- B4 -----------------------------------------------------------------

test("B4 passes when authors and year still agree with arXiv", () => {
  const targets = resolveTargets([card.url!], collectFrozenCards([card]));
  const checks = checkResolvedMetadata(targets, resolved(remote));
  assert.deepEqual(
    checks.map((check) => check.id),
    ["B4.2301.12345"],
  );
  assert.equal(checks[0]!.pass, true);
});

test("B4 reports a year mismatch, a bogus author and a wrong first author", () => {
  const targets = resolveTargets(
    [card.url!],
    collectFrozenCards([
      {
        ...card,
        year: 1999,
        authors: ["Grace Hopper", "Someone Invented"],
      },
    ]),
  );
  const checks = checkResolvedMetadata(targets, resolved(remote));
  assert.equal(checks[0]!.pass, false);
  assert.match(checks[0]!.detail, /年份不符（冻结证据 1999，arXiv 2023）/);
  assert.match(checks[0]!.detail, /作者不符：invented/);
  assert.match(checks[0]!.detail, /第一作者不符/);
});

test("B4 refuses to pass a card that never recorded its authors", () => {
  const cardless: FrozenCitation = { ...card, authors: [] };
  const targets = resolveTargets([card.url!], collectFrozenCards([cardless]));
  const checks = checkResolvedMetadata(targets, resolved(remote));
  assert.equal(checks[0]!.pass, false);
  assert.match(checks[0]!.detail, /未登记作者/);
});

test("B4 stays silent when the lookup returned nothing — B2 already said so", () => {
  const targets = resolveTargets([card.url!], collectFrozenCards([card]));
  assert.deepEqual(checkResolvedMetadata(targets, resolved()), []);
});

// --- 组合验收 -----------------------------------------------------------

const lookupOf =
  (...records: ResolvedRecord[]): ArxivLookup =>
  async (ids) => {
    const wanted = new Set(ids.map(normalizeArxivId));
    return records.filter((record) => wanted.has(normalizeArxivId(record.arxivId)));
  };

test("accepts a plan whose five arXiv references all survive independent lookup", async () => {
  const cards = [0, 1, 2, 3, 4].map((n) => ({
    ...card,
    locator: `arxiv:2301.1234${n}v1`,
    url: `https://arxiv.org/abs/2301.1234${n}v1`,
  }));
  const records = cards.map((item) => ({ ...remote, arxivId: item.locator.slice("arxiv:".length) }));
  const verify = createReferenceVerifier({ lookup: lookupOf(...records) });

  const verification = await verify({
    plan: plan(cards.map((item) => item.url!)),
    research: research(cards),
  });
  assert.equal(verification.ok, true);
  assert.equal(verification.arxivChecked, 5);
  assert.equal(verification.membershipOnly, 0);
  assert.equal(verification.infraError, false);
  assert.deepEqual(verification.failed, []);
});

test("layers web references as membership-only instead of pretending they were looked up", async () => {
  const webCard: FrozenCitation = {
    source_type: "web",
    title: "A Web Article",
    locator: "web:fixture",
    url: "https://example.com/article",
  };
  const verify = createReferenceVerifier({ lookup: lookupOf(remote), doiLookup: async () => [] });
  const verification = await verify({
    plan: plan([card.url!, webCard.url!]),
    research: research([card, webCard]),
  });

  assert.equal(verification.arxivChecked, 1);
  assert.equal(verification.membershipOnly, 1);
  // 普通网页只有 B1；没有独立反查通路才算 membership-only。
  assert.deepEqual(passing(verification.checks, "B1."), [true, true]);
  assert.deepEqual(passing(verification.checks, "B2."), [true]);
  assert.deepEqual(passing(verification.checks, "B4."), [true]);
  // 条数不够，整体仍然不通过
  assert.equal(verification.ok, false);
  assert.deepEqual(verification.failed, ["B3.count"]);
});

test("five DOI references cannot pass without exact Crossref records", async () => {
  let asked: readonly string[] = [];
  const verify = createReferenceVerifier({
    doiLookup: async (dois) => {
      asked = dois;
      return [];
    },
  });
  const verification = await verify({ plan: doiPlan(), research: research(doiCards) });

  assert.deepEqual(
    asked,
    doiRecords.map((record) => record.doi),
  );
  assert.equal(verification.ok, false);
  assert.equal(verification.doiChecked, 5);
  assert.equal(verification.membershipOnly, 0);
  assert.equal(verificationFailureCode(verification), "verifier_refs");
  assert.equal(verification.failed.filter((id) => id.startsWith("B2.doi.")).length, 5);
});

test("five DOI references pass only after exact Crossref resolve", async () => {
  let asked: readonly string[] = [];
  const verify = createReferenceVerifier({
    doiLookup: async (dois) => {
      asked = dois;
      return doiRecords;
    },
  });
  const verification = await verify({ plan: doiPlan(), research: research(doiCards) });

  assert.deepEqual(
    asked,
    doiRecords.map((record) => record.doi),
  );
  assert.equal(verification.ok, true);
  assert.equal(verification.doiChecked, 5);
  assert.equal(verification.membershipOnly, 0);
  assert.deepEqual(verification.failed, []);
});

test("a missing DOI record or mismatched DOI metadata is verifier_refs", async () => {
  const missing = createReferenceVerifier({ doiLookup: async () => doiRecords.slice(0, 4) });
  const missingVerification = await missing({ plan: doiPlan(), research: research(doiCards) });
  assert.equal(missingVerification.ok, false);
  assert.equal(missingVerification.infraError, false);
  assert.equal(verificationFailureCode(missingVerification), "verifier_refs");
  assert.equal(missingVerification.failed.filter((id) => id.startsWith("B2.doi.")).length, 1);

  const drifted = doiRecords.map((record, index) =>
    index === 0 ? { ...record, title: "Wrong title", authors: ["Wrong Author"] } : record,
  );
  const mismatch = createReferenceVerifier({ doiLookup: async () => drifted });
  const mismatchVerification = await mismatch({ plan: doiPlan(), research: research(doiCards) });
  assert.equal(mismatchVerification.ok, false);
  assert.equal(mismatchVerification.infraError, false);
  assert.equal(verificationFailureCode(mismatchVerification), "verifier_refs");
  assert.ok(mismatchVerification.failed.some((id) => id.startsWith("B2.doi.")));
  assert.ok(mismatchVerification.failed.some((id) => id.startsWith("B4.doi.")));
});

test("Crossref DOI infrastructure failure is not fabrication", async () => {
  const verify = createReferenceVerifier({
    doiLookup: async () => {
      throw new Error("Crossref returned HTTP 503");
    },
  });
  const verification = await verify({ plan: doiPlan(), research: research(doiCards) });

  assert.equal(verification.ok, false);
  assert.equal(verification.infraError, true);
  assert.equal(verification.doiChecked, 0);
  assert.equal(verification.membershipOnly, 0);
  assert.equal(verificationFailureCode(verification), "infra_error");
  assert.deepEqual(verification.failed, ["B2.doi.resolve"]);
});

test("one DOI outage preserves checks for the other successful DOI lookups", async () => {
  const verify = createReferenceVerifier({
    resolveSingleDoi: async (doi) => {
      if (doi === doiRecords[2]!.doi) throw new Error("single DOI timeout");
      const record = doiRecords.find((candidate) => candidate.doi === doi);
      if (!record) return null;
      return {
        doi: record.doi,
        title: record.title,
        url: `https://doi.org/${record.doi}`,
        authors: record.authors,
        published: String(record.year),
        container: "fixture",
      };
    },
  });
  const verification = await verify({ plan: doiPlan(), research: research(doiCards) });

  assert.equal(verification.infraError, true);
  assert.equal(verification.doiChecked, 4);
  assert.deepEqual(verification.failed, ["B2.doi.resolve"]);
  assert.equal(verification.checks.filter((check) => check.id.startsWith("B2.doi.") && check.pass).length, 4);
});

test("never looks up a reference that is not in the frozen evidence", async () => {
  let asked: readonly string[] = [];
  const verify = createReferenceVerifier({
    lookup: async (ids) => {
      asked = ids;
      return [];
    },
  });
  await verify({
    plan: plan(["https://arxiv.org/abs/2999.99999"]),
    research: research([card]),
  });
  // 冻结集里没有它，B1 已经报告；再去反查等于替一条幻觉引用寻找证据
  assert.deepEqual(asked, []);
});

test("marks an arXiv outage as infrastructure failure, not fabrication", async () => {
  const verify = createReferenceVerifier({
    lookup: async () => {
      throw new ArxivLookupError("arXiv lookup returned HTTP 503");
    },
  });
  const verification = await verify({ plan: plan([card.url!]), research: research([card]) });

  assert.equal(verification.infraError, true);
  assert.equal(verification.arxivChecked, 0);
  // 每条引用没有各背一条失败，只有一条「结论未取得」
  assert.deepEqual(verification.failed, ["B3.count", "B2.resolve"]);
  assert.match(verification.checks.at(-1)!.detail, /HTTP 503/);
});

test("chooses the failure code by what actually went wrong", () => {
  const base = {
    ok: false,
    referenceCount: 5,
    frozenSources: 5,
    arxivChecked: 0,
    doiChecked: 0,
    membershipOnly: 0,
    checks: [],
  };
  assert.equal(verificationFailureCode({ ...base, failed: ["B2.resolve"], infraError: true }), "infra_error");
  // 网络好坏改变不了 B1/B3 的结论
  assert.equal(
    verificationFailureCode({ ...base, failed: ["B3.count", "B2.resolve"], infraError: true }),
    "verifier_refs",
  );
  assert.equal(verificationFailureCode({ ...base, failed: ["B2.2301.12345"], infraError: false }), "verifier_refs");
});

// --- 反查通路 -----------------------------------------------------------

const atom = (entries: string) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">${entries}</feed>`;

const entry = (id: string, title: string) => `
  <entry>
    <id>http://arxiv.org/abs/${id}</id>
    <title>${title}</title>
    <summary>A summary.</summary>
    <published>2023-01-15T00:00:00Z</published>
    <author><name>Ada Lovelace</name></author>
  </entry>`;

test("looks papers up by id_list rather than by keyword search", async () => {
  let requested = "";
  const records = await fetchArxivByIds(["2301.12345v2", "2301.12345v2", "2401.00001"], {
    minIntervalMs: 0,
    fetchImpl: (async (url: URL) => {
      requested = url.toString();
      return new Response(atom(entry("2301.12345v2", "Frozen Evidence Gates")));
    }) as unknown as typeof fetch,
  });

  // id_list 命中的是这个 id 本身；`all:` 检索会被相关论文冒名顶替
  assert.match(requested, /id_list=2301.12345v2%2C2401.00001/);
  assert.doesNotMatch(requested, /search_query/);
  assert.equal(records.length, 1);
  assert.equal(records[0]!.arxivId, "2301.12345v2");
  assert.equal(publishedYear(records[0]!.published), 2023);
});

test("throws instead of encoding an outage as an empty result", async () => {
  const failures: Array<() => Promise<Response>> = [
    async () => new Response("", { status: 503 }),
    async () => {
      throw new Error("ECONNREFUSED");
    },
    async () => new Response("not xml at all <<<"),
  ];
  // 一条都不许静默：把通路故障说成「查不到」，就等于把 infra 故障判成引用造假
  for (const impl of failures) {
    await assert.rejects(
      fetchArxivByIds(["2301.12345"], { minIntervalMs: 0, fetchImpl: impl as unknown as typeof fetch }),
      ArxivLookupError,
    );
  }
});

test("does not touch the network when there is nothing to look up", async () => {
  let called = false;
  const records = await fetchArxivByIds(["", "  "], {
    minIntervalMs: 0,
    fetchImpl: (async () => {
      called = true;
      return new Response("");
    }) as unknown as typeof fetch,
  });
  assert.deepEqual(records, []);
  assert.equal(called, false);
});

test("pre-aborted verification never begins independent lookup", async () => {
  const reason = new Error("cancel verification");
  let calls = 0;
  const verify = createReferenceVerifier({
    lookup: async () => {
      calls += 1;
      return [];
    },
  });
  await assert.rejects(
    verify({ plan: plan([card.url!]), research: research([card]), signal: AbortSignal.abort(reason) }),
    (error) => error === reason,
  );
  assert.equal(calls, 0);
});

for (const fails of [false, true]) {
  test(`cancellation wins over a late arXiv lookup (fails=${fails})`, async () => {
    const controller = new AbortController();
    const reason = new Error("cancel verification");
    let doiCalls = 0;
    const verify = createReferenceVerifier({
      lookup: async (_, signal) => {
        assert.equal(signal, controller.signal);
        controller.abort(reason);
        if (fails) throw new Error("lookup failure");
        return [remote];
      },
      doiLookup: async () => {
        doiCalls += 1;
        return [];
      },
    });
    await assert.rejects(
      verify({ plan: plan([card.url!, doiCard.url!]), research: research([card, doiCard]), signal: controller.signal }),
      (error) => error === reason,
    );
    assert.equal(doiCalls, 0);
  });
}

test("DOI cancellation reaches each resolver and is never converted into partial infrastructure failure", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel DOI verification");
  const signals: Array<AbortSignal | undefined> = [];
  const verify = createReferenceVerifier({
    resolveSingleDoi: async (_, options) => {
      signals.push(options?.signal);
      controller.abort(reason);
      throw new Error("fetch interrupted");
    },
  });
  await assert.rejects(
    verify({ plan: doiPlan(), research: research(doiCards), signal: controller.signal }),
    (error) => error === reason,
  );
  assert.equal(signals.length, 5);
  assert.ok(signals.every((signal) => signal === controller.signal));
});
