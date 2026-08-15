/** 预注册协议只有在「改动它会很响」的前提下才值得存在。
 *
 * `docs/design/experiment-protocol.json` 在 Phase A 开跑**之前**钉死了 Phase B 的 30 题子集。
 * 那个承诺的全部价值在于：结果出来之后没人能悄悄重挑这 30 题。所以这里按协议自己声明的
 * 种子与分层规则，从题库把子集**重算一遍**再逐层比对——手改一个题号而不重新推导，测试必红。
 *
 * 移植自 backend/tests/test_experiment_protocol.py。协议是跨语言产物，两个栈读同一份文件、
 * 用同一条规则重算；两边都绿，才说明这份承诺不依赖任何一个实现。
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

import { readScience125 } from "../src/domain/science125.ts";

const PROTOCOL_PATH = fileURLToPath(new URL("../docs/design/experiment-protocol.json", import.meta.url));

type Allocation = { stratum_size: number; allocated: number; ids: number[] };
type Protocol = {
  status: string;
  arms: Record<string, { memory_arm: string }>;
  phase_b_subset: {
    fixed_before_phase_a: boolean;
    size: number;
    seed: string;
    allocation: Record<string, Allocation>;
    question_ids: number[];
    commitment: { algorithm: string; digest: string; git_commit: string };
  };
  statistics: { design: string; claims_forbidden: string[]; reason: string };
  declarations: Record<string, string>;
  amendments: Array<{
    date: string;
    before_phase_a: boolean;
    summary: string;
    changes: Record<string, string>;
    unchanged: string;
  }>;
};

const protocol = JSON.parse(readFileSync(PROTOCOL_PATH, "utf8")) as Protocol;

/** 题库按协议声明的分层键（domain）分组。 */
function strata(): Map<string, number[]> {
  const bank = readScience125();
  assert.ok(bank, "题库读不出来，后面每一条重算都无从谈起");
  return new Map(bank.domains.map((item) => [item.domain, item.questions.map((question) => question.id)]));
}

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

test("the protocol is parseable JSON registered before the campaign", () => {
  assert.equal(protocol.status, "pre_registered_protocol");
  assert.equal(protocol.phase_b_subset.fixed_before_phase_a, true);
  assert.equal(protocol.arms.phase_a!.memory_arm, "on");
  assert.equal(protocol.arms.phase_b!.memory_arm, "off");
});

test("the subset is thirty distinct question ids inside the bank", () => {
  const ids = protocol.phase_b_subset.question_ids;
  const inBank = new Set([...strata().values()].flat());

  assert.equal(ids.length, 30);
  assert.equal(new Set(ids).size, 30);
  assert.deepEqual(ids, [...ids].sort((left, right) => left - right));
  assert.ok(ids.every((id) => Number.isInteger(id) && id >= 1 && id <= 125));
  assert.ok(ids.every((id) => inBank.has(id)));
});

test("the subset matches the sampling rule the protocol declares", () => {
  const subset = protocol.phase_b_subset;
  const grouped = strata();
  const total = [...grouped.values()].reduce((sum, ids) => sum + ids.length, 0);
  const size = subset.size;

  // 1–2. 比例分配，为 0 的层抬到 1。
  const exact = new Map([...grouped].map(([domain, ids]) => [domain, ids.length * size / total]));
  const allocation = new Map([...exact].map(([domain, value]) => [domain, Math.max(1, Math.floor(value))]));
  // 3. 余额只在**未被抬升**的层里按小数部分降序、同分按 domain 名升序分配。
  const eligible = [...exact].filter(([, value]) => Math.floor(value) >= 1)
    .map(([domain]) => domain)
    .sort((left, right) => {
      const gap = (exact.get(right)! % 1) - (exact.get(left)! % 1);
      return gap !== 0 ? gap : left.localeCompare(right);
    });
  const allocated = [...allocation.values()].reduce((sum, value) => sum + value, 0);
  for (const domain of eligible.slice(0, size - allocated)) {
    allocation.set(domain, allocation.get(domain)! + 1);
  }
  // 4. 层内按 sha256(seed:id) 升序取前 n_h。
  const recomputed = new Map([...grouped].map(([domain, ids]) => [
    domain,
    [...ids].sort((left, right) => sha256(`${subset.seed}:${left}`).localeCompare(sha256(`${subset.seed}:${right}`)))
      .slice(0, allocation.get(domain)!)
      .sort((left, right) => left - right),
  ]));

  for (const [domain, row] of Object.entries(subset.allocation)) {
    assert.deepEqual(row.ids, recomputed.get(domain), `${domain} 的题号与重算结果不符`);
    assert.equal(row.stratum_size, grouped.get(domain)!.length);
    assert.equal(row.allocated, row.ids.length);
  }
  assert.deepEqual(
    subset.question_ids,
    [...recomputed.values()].flat().sort((left, right) => left - right),
  );
});

test("every stratum is represented in proportion", () => {
  const allocation = protocol.phase_b_subset.allocation;
  assert.deepEqual(Object.keys(allocation).sort(), [...strata().keys()].sort());
  assert.ok(Object.values(allocation).every((row) => row.allocated >= 1), "跳过一个 domain 就是替 11 个层回答却宣称 12 个");
  assert.equal(Object.values(allocation).reduce((sum, row) => sum + row.allocated, 0), 30);
});

test("the commitment digest pins the subset", () => {
  const commitment = protocol.phase_b_subset.commitment;
  // 承诺的是题号本身，不是文件的自哈希 —— 文件哈希写进文件是不动点。
  const payload = JSON.stringify(protocol.phase_b_subset.question_ids);

  assert.equal(commitment.algorithm, "sha256");
  assert.equal(sha256(payload), commitment.digest);
  assert.equal(commitment.git_commit.length, 40);
});

test("the protocol refuses significance claims up front", () => {
  const statistics = protocol.statistics;
  assert.equal(statistics.design, "bounded_comparison");
  assert.ok(statistics.claims_forbidden.includes("显著性主张"));
  assert.match(statistics.reason, /0\.0625/);
});

test("the reading declarations are registered before any result exists", () => {
  const declarations = protocol.declarations;
  for (const key of ["pass_squared", "verifier", "failure_classes"]) {
    assert.ok(key in declarations, `少了一条口径声明：${key}`);
  }
  assert.match(declarations.pass_squared!, /机会样本/);
  assert.match(declarations.verifier!, /TITLE_OVERLAP_THRESHOLD=0\.8/);
  assert.match(declarations.verifier!, /未经校准的自由参数/);
  assert.match(declarations.failure_classes!, /infra_timeout/);
});

test("the TypeScript cutover is recorded as an amendment made before Phase A", () => {
  const amendment = protocol.amendments.find((item) => item.date === "2026-08-14");
  assert.ok(amendment, "TS 栈切换必须留下修订记录；没有它，协议描述的就不是实际跑的系统");
  assert.equal(amendment.before_phase_a, true);

  const changes = amendment.changes;
  // ① 执行栈：两角色 → 五角色 + B1–B4。
  assert.match(changes.execution_stack!, /五角色/);
  assert.match(changes.execution_stack!, /B1–B4/);
  // ② 存储：runs/ 文件 → sqlite，runs/ 降为只读归档。
  assert.match(changes.run_storage!, /sqlite/i);
  assert.match(changes.run_storage!, /只读归档/);
  // ③ 记忆通道收窄，消融臂语义与泄漏口径随之改。
  assert.match(changes.memory_channel!, /memory_search/);
  assert.match(changes.memory_channel!, /campaign\.prior_attempts/);
  assert.match(changes.memory_channel!, /注入开 \/ 关/);
  // ④ corrections 存在，无隐式 Attempt 重试不变。
  assert.match(changes.corrections!, /corrections/);
  assert.match(changes.corrections!, /无隐式 Attempt 重试/);
  // 改的是被声明的事实，读数纪律原封不动。
  assert.match(amendment.unchanged, /bounded_comparison/);
  assert.match(amendment.unchanged, /一字未改/);
});
