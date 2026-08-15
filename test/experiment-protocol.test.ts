/** 预注册协议只有在「改动它会很响」的前提下才值得存在。
 *
 * `docs/design/experiment-protocol.json` 在 Phase A 开跑**之前**钉死了 Phase B 的 30 题子集。
 * 那个承诺的全部价值在于：结果出来之后没人能悄悄重挑这 30 题。所以这里按协议自己声明的
 * 种子与分层规则，从题库把子集**重算一遍**再逐层比对——手改一个题号而不重新推导，测试必红。
 *
 * 移植自 Python 期 `tests/test_experiment_protocol.py`（ADR-0004 已删）。协议本就是跨语言产物：
 * 两个栈曾各自读同一份文件、用同一条规则重算过，两边都绿证明了这份承诺不依赖任何一个实现。
 * Python 侧退役后只剩本用例守它——协议文件本身一字未改，守的仍是同一个承诺。
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
    /** pilot 之后、正式 Phase A 之前落的修订自报这一条。 */
    before_definitive_phase_a?: boolean;
    /** Phase A 之后落的修订必须自报「什么时候写的、写的时候读过数没有」。 */
    recorded_when?: string;
    before_any_reading?: boolean;
    effect_on_numbers?: string;
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

test("the bucket amendment says out loud that it landed after Phase A had started", () => {
  // 按内容挑，不按日期：同一天可以落不止一条修订。
  const amendment = protocol.amendments.find((item) => "bucket_membership" in item.changes);
  assert.ok(amendment, "桶归属明细化必须留下修订记录");
  assert.equal(amendment.date, "2026-08-15");
  // 这条修订的全部价值是时间戳的诚实：它不是预注册的一部分，是开跑之后补的，
  // 但在任何一个数被读出来之前。措辞含糊等于没有这条记录。
  assert.equal(amendment.before_phase_a, false, "写成 true 就是把事后修订伪装成预注册");
  assert.equal(amendment.before_any_reading, true);
  assert.match(amendment.recorded_when!, /Phase A 已经开跑之后/);
  assert.match(amendment.recorded_when!, /尚未从库里读出任何一个指标/);
  // 改的是读数聚合，不是测量行为，也不是已注册的比较设计。
  assert.match(amendment.summary, /不改变任何测量行为/);
  assert.match(amendment.summary, /不改变任何已注册的比较设计/);
  assert.match(amendment.changes.bucket_membership!, /谁能修/);
  assert.match(amendment.changes.review_rejected!, /不是 failure code/);
  // 熔断口径是已注册的 control，读数改动不得顺手动它。
  assert.match(amendment.changes.two_sets_diverge!, /outage_classes/);
  assert.match(amendment.effect_on_numbers!, /质量分母/);
  assert.match(amendment.unchanged, /一字未[改动]/);
});

test("the efficiency amendment fences the pilot off instead of merging its numbers", () => {
  // 按内容挑，不按标志位：`before_definitive_phase_a` 现在不止一条修订带着。
  const amendment = protocol.amendments.find((item) => "pilot_disposition" in item.changes);
  assert.ok(amendment, "并发与退避改的是正式 Phase A 怎么跑，必须留下修订记录");
  assert.equal(amendment.before_definitive_phase_a, true);
  assert.equal(amendment.date, "2026-08-15");
  // pilot 跑完之后写的：声称「一个数都没看过」是假话——失败分类计数表就摆在欠账文件里。
  assert.equal(amendment.before_phase_a, false, "写成 true 就是把 pilot 之后的修订伪装成预注册");
  assert.equal(amendment.before_any_reading, false, "看过 pilot 的失败分类表，不能声称未读数");
  assert.match(amendment.recorded_when!, /pilot 跑完之后、正式 Phase A 开跑之前/);

  const changes = amendment.changes;
  // ① 串行 → 有界并发：注册串行的理由必须被回答，熔断按结算序，在飞的题不取消。
  assert.match(changes.execution_control!, /结算顺序/);
  assert.match(changes.execution_control!, /不取消在飞的题/);
  assert.match(changes.execution_control!, /MAX_CONCURRENCY/);
  assert.match(changes.execution_control!, /429/, "注册串行的理由是 429 噪音，必须正面回答");
  // ② 传输层重试与 no_retry 的边界。
  assert.match(changes.transient_backoff!, /no_retry/);
  assert.match(changes.transient_backoff!, /Attempt/);
  assert.match(changes.transient_backoff!, /不做错误正文的散文匹配/);
  // ③ pilot 归档，且不进正式读数。
  assert.match(changes.pilot_disposition!, /runs-ts\/phase-a-pilot\.db/);
  assert.match(changes.pilot_disposition!, /不并入正式 Phase A 读数/);
  assert.match(changes.pilot_disposition!, /必须逐处标注 pilot/);
  // 会动到数的地方要事先写出机制，不留到看见数之后再解释。
  assert.match(amendment.effect_on_numbers!, /infrastructure/);
  assert.match(amendment.unchanged, /一字未[改动]/);
});

test("the queries-authority amendment fences off v2 and moves the ledger to the harness", () => {
  const amendment = protocol.amendments.find((item) => "queries_authority" in item.changes);
  assert.ok(amendment, "把一道合同门整个删掉，必须留下修订记录");
  assert.equal(amendment.date, "2026-08-15");
  // v3 之前落的：与修订 #3 同一档，不是预注册的一部分。
  assert.equal(amendment.before_phase_a, false, "写成 true 就是把事后修订伪装成预注册");
  assert.equal(amendment.before_definitive_phase_a, true);
  // 21 题的失败分类已经看过，声称「一个数都没看过」是假话。
  assert.equal(amendment.before_any_reading, false, "看过 v2 的失败分类，不能声称未读数");
  assert.match(amendment.recorded_when!, /v2/);
  assert.match(amendment.recorded_when!, /正式 Phase A/);

  const changes = amendment.changes;
  // (1) v2 部分批围出去，且停批原因写的是那个发现本身，不是「跑得不顺」。
  assert.match(changes.v2_partial_disposition!, /phase-a-v2-partial/);
  assert.match(changes.v2_partial_disposition!, /21 题/);
  assert.match(changes.v2_partial_disposition!, /不并入正式 Phase A 读数/);
  assert.match(changes.v2_partial_disposition!, /6% → v2 24%/, "两批的对比是停批的全部理由，必须写出数");
  assert.match(changes.v2_partial_disposition!, /证伪/, "prompt 层方向被证伪这句不能含糊");
  assert.match(changes.v2_partial_disposition!, /必须逐处标注/);
  // (2) queries 权威改由台账持有，漂移可观测，虚报不进证据面。
  assert.match(changes.queries_authority!, /EvidenceLedger\.scopedRecords/);
  assert.match(changes.queries_authority!, /artifact\.field_overwritten/);
  assert.match(changes.queries_authority!, /missing_count/);
  assert.match(changes.queries_authority!, /invented_count/);
  assert.match(changes.queries_authority!, /虚报条目\*\*直接丢弃\*\*/);
  // citations 是模型的选择不是转录，那道门必须明写「一字未改」。
  assert.match(changes.queries_authority!, /citations 的成员性校验与元数据覆写\*\*一字未改\*\*/);
  // (3) 对读数的效应：旧失败形态消失，漂移事件成为机制指标。
  assert.match(amendment.effect_on_numbers!, /invalid_output/);
  assert.match(amendment.effect_on_numbers!, /机制指标/);
  assert.match(amendment.effect_on_numbers!, /设计使然不是回归/, "新指标基线会升，得事先说清怎么读");
  assert.match(amendment.unchanged, /一字未[改动]/);
});

test("the amendments are ordered and only the pre-Phase-A ones claim to be", () => {
  const dates = protocol.amendments.map((item) => item.date);
  assert.deepEqual(dates, [...dates].sort(), "修订按时间顺序追加，不倒插");
  for (const amendment of protocol.amendments) {
    // Phase A 之后落的每一条都必须自报写作时机；缺这一句，读者无从判断它是不是事后追认。
    if (!amendment.before_phase_a) assert.ok(amendment.recorded_when, `${amendment.date} 少了写作时机`);
  }
});
