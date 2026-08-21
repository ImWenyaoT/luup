import type { EvidenceStatus, SourceType } from "./contracts.ts";

export type EvidenceCitation = {
  source_type: SourceType;
  title: string;
  locator: string;
  url: string | null;
  /** 检索当时从 arXiv 拿到的作者与发表年，只有 arXiv 通路会登记。
   *
   * 这两个字段是 B4 元数据比对的「本 run 冻结事实」—— 没有它们，验收器手上只剩一条
   * URL，无从判断这条引用今天是否仍然指向同一篇论文。数据本来就在 ArxivRecord 里，
   * 之前被丢掉了。UI 投影不放行它们（见 publicCitationSchema），只供验收器与审计使用。 */
  authors?: string[];
  year?: number | null;
};

/** 一次检索事件。
 *
 * `evidenceId` 标识的是**这次检索**，不是一条来源 —— 一次检索可以产出多条 citation，
 * 它们共享同一个 evidenceId。这是 Python 期 `app/harness.py`（ADR-0004 已删）的语义
 * （那边 `citations_by_evidence[evidence_id]` 是个 list）。
 *
 * 这里曾经把 evidenceId 算成 `hash(url + claim)`，即一条来源一个 ID。那样
 * Artifact 里的 `queries[]`（检索动作）和 `citations[]`（可引用条目）被迫共用同一套 ID，
 * 「queries 必须冻结每一次检索」这道门就无从建立 —— 检索了 1 次拿回 5 条来源，
 * 到底该有 1 条 query 还是 5 条，说不清。
 */
export type EvidenceRecord = {
  evidenceId: string;
  tool: string;
  sourceType: SourceType;
  query: string;
  status: EvidenceStatus;
  resultSummary: string;
  citations: EvidenceCitation[];
};

export type EvidenceInput = Omit<EvidenceRecord, "evidenceId">;

const DEFAULT_SCOPE = "default";

/** 检索台账。ID 与内容都由代码拥有；模型只能引用，不能命名、不能改写。
 *
 * 台账按 scope 记账，一个 scope 就是一个业务 Attempt：补证轮必须自己重新检索，
 * 不能白嫖上一轮留在台账里的记录。没有这层作用域，「Researcher 必须真的检索过」
 * 和「本轮 Artifact 只引用本轮证据」两道门在第二轮都会自动放行。
 */
export class EvidenceLedger {
  readonly #records = new Map<string, EvidenceRecord>();
  readonly #onRecord: ((record: EvidenceRecord) => void) | undefined;
  readonly #namespace: string;
  readonly #scopes = new Map<string, Set<string>>();
  #current = DEFAULT_SCOPE;
  #sequence = 0;

  /** `onRecord` 在检索发生的那一刻回调，用来把证据落库。
   *
   * 落库时机是「检索时」而不是「Attempt 成功后」：失败的 Attempt 也查过东西，
   * 那些检索记录恰恰是排查为什么失败的材料，丢掉就没了。 */
  constructor(options: { onRecord?: (record: EvidenceRecord) => void; namespace?: string } = {}) {
    this.#onRecord = options.onRecord;
    this.#namespace = options.namespace ?? "";
  }

  /** 开一个新的记账区间，后续 record 都归到它名下。 */
  beginScope(key: string): void {
    this.#current = key;
    this.#scopes.set(key, new Set());
  }

  /** 登记一次检索。每次调用都是一个新事件，即使查询词与上次相同 ——
   *  同一个查询两次可能拿回不同结果，合并会让审计说不清哪条对应哪次。 */
  record(input: EvidenceInput): EvidenceRecord {
    this.#sequence += 1;
    const record: EvidenceRecord = {
      ...input,
      // 序号只在一本台账内递增；持久库用完整 Attempt ID 作为 namespace，避免跨 Run 碰撞。
      evidenceId: `ev_${this.#namespace}${String(this.#sequence).padStart(2, "0")}_${input.sourceType}`,
    };
    // 持久化是权威提交点：sink 失败时不能让内存台账独自拥有一条下游可引用的“幽灵证据”。
    // sequence 保留缺口，明确表示一次提交尝试发生过；records/scope 只在 sink 成功后更新。
    this.#onRecord?.(record);
    this.#records.set(record.evidenceId, record);
    this.#scope().add(record.evidenceId);
    return record;
  }

  values(): EvidenceRecord[] {
    return [...this.#records.values()];
  }

  /** 当前 scope 里登记过的检索；台账全集不算数。 */
  scopedRecords(): EvidenceRecord[] {
    return [...this.#scope()].map((id) => this.#records.get(id)!);
  }

  #scope(): Set<string> {
    let scope = this.#scopes.get(this.#current);
    if (!scope) {
      scope = new Set();
      this.#scopes.set(this.#current, scope);
    }
    return scope;
  }
}
