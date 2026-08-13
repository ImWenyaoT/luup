import { describe, expect, it } from "bun:test"
import { compactIds, summarizeBatch } from "./batch"
import type { RunSummary, Science125 } from "./types"

/**
 * 期望值的语义来源，一律从后端契约推导，不从本模块的输出反抄：
 * - `FailureClass` 的取值域：`backend/app/domain/runs.py`；
 * - 环境性 vs 质量性的切分：`backend/app/evaluation.py` 的 `INFRASTRUCTURE_CLASSES`
 *   （`agent_budget_exhausted` 是**质量性**的，那条注释专门写过为什么）；
 * - cohort 标签含脏树：同文件的 `_cohort_label`；
 * - `--ids` 的合法写法：`backend/app/batch.py` 的 `parse_ids`；
 * - `sourceIdentity` / `classification` 的缺席形态：`app.cli` 在 git 不可用时写 null，
 *   而 2026-08-08 之前那批已提交 run 连 `exit.json` 都没有。
 */

const bank = (domains: { domain: string; ids: number[] }[]): Science125 => ({
  source: "fixtures/science125.json",
  retrievedAt: "2026-08-08T00:00:00Z",
  total: domains.reduce((sum, entry) => sum + entry.ids.length, 0),
  domains: domains.map((entry) => ({
    domain: entry.domain,
    count: entry.ids.length,
    questions: entry.ids.map((id) => ({ id, question: `Q${id}?` })),
  })),
})

/** 五题两学科，够表达「未跑 / 多次运行 / 只失败」而不用手写 125 行。 */
const SCIENCE = bank([
  { domain: "Astronomy", ids: [1, 2, 3] },
  { domain: "Biology", ids: [7, 8] },
])

const run = (over: Partial<RunSummary> & { id: string }): RunSummary => ({
  startedAt: "2026-08-10T00:00:00.000Z",
  finishedAt: "2026-08-10T00:10:00.000Z",
  status: "passed",
  question: "问题原文",
  domain: null,
  science125Id: 1,
  refs: 5,
  verify: "pass",
  durationSec: 600,
  classification: null,
  sourceIdentity: { gitCommit: "abc1234", treeDirty: false },
  nodes: [],
  ...over,
})

describe("compactIds", () => {
  it("空列表压成空串，不产出一条会被 parse_ids 拒绝的 `--ids`", () => {
    // `parse_ids("")` 抛「--ids 没有给出任何题号」；空串让调用方能自己决定不显示命令。
    expect(compactIds([])).toBe("")
  })

  it("离散题号逐个列出，升序去重", () => {
    expect(compactIds([12, 3, 7, 3])).toBe("3,7,12")
  })

  it("三个及以上连号压成区间，两个连号保持原样", () => {
    // `12,13` 与 `12-13` 一样长；压到三个才真的省字。
    expect(compactIds([12, 13])).toBe("12,13")
    expect(compactIds([12, 13, 14])).toBe("12-14")
  })

  it("区间与离散题号混写，与 parse_ids 接受的形态一致", () => {
    expect(compactIds([1, 2, 3, 7, 20, 21, 22, 23, 99])).toBe("1-3,7,20-23,99")
  })

  it("整批未跑时压成单个区间", () => {
    expect(compactIds(Array.from({ length: 125 }, (_, i) => i + 1))).toBe(
      "1-125",
    )
  })
})

describe("summarizeBatch 覆盖进度", () => {
  it("分母是题库题数，不是写死的 125", () => {
    const overview = summarizeBatch([], SCIENCE)

    expect(overview.total).toBe(5)
    expect(overview.attempted).toBe(0)
  })

  it("一次没跑过的题进 notRun，且能直接压成续跑用的 --ids", () => {
    const overview = summarizeBatch(
      [run({ id: "20260810-000001", science125Id: 1 })],
      SCIENCE,
    )

    expect(overview.attempted).toBe(1)
    expect(overview.notRun).toEqual([2, 3, 7, 8])
    expect(compactIds(overview.notRun)).toBe("2,3,7,8")
  })

  it("同一题多次运行只算一题，attempts 记住跑过几次", () => {
    const overview = summarizeBatch(
      [
        run({ id: "20260810-000001", science125Id: 2 }),
        run({ id: "20260810-000002", science125Id: 2 }),
        run({ id: "20260810-000003", science125Id: 2 }),
      ],
      SCIENCE,
    )

    expect(overview.attempted).toBe(1)
    expect(overview.passed).toBe(1)
    expect(overview.failures).toEqual([])
    expect(overview.notRun).toEqual([1, 3, 7, 8])
  })

  it("题号缺席或不在题库内的 run 单列，不进覆盖率的分子", () => {
    const overview = summarizeBatch(
      [
        run({ id: "20260810-000001", science125Id: null }),
        run({ id: "20260810-000002", science125Id: 999 }),
        run({ id: "20260810-000003", science125Id: 1 }),
      ],
      SCIENCE,
    )

    expect(overview.unattributed).toBe(2)
    expect(overview.attempted).toBe(1)
    expect(overview.notRun).toEqual([2, 3, 7, 8])
  })
})

/**
 * 欠账集合的判据抄的是 `app/batch.py` 的**实现**而不是它的名字：`passed_question_runs`
 * 遍历升序的 run 目录，只在 `_is_deliverable(entry)` 为真时才写
 * `passed[question_id] = entry.name`；失败的 run 既不覆盖也不删除已有的键。于是
 * `_run_one` 里的 `if question_id in already: skipped` 认的是**「存在任一 passed run」**，
 * 而不是「最新终态是 passed」。下面每条期望都由这一句推出来。
 */
describe("summarizeBatch 欠账集合（owed）", () => {
  const failing = (id: string, questionId: number) =>
    run({
      id,
      science125Id: questionId,
      status: "failed",
      verify: "fail",
      classification: "verifier_refs",
    })

  it("一次没跑过的题欠着", () => {
    const overview = summarizeBatch(
      [run({ id: "20260810-000001", science125Id: 1 })],
      SCIENCE,
    )

    expect(overview.owed).toEqual([2, 3, 7, 8])
  })

  it("只失败过的题仍然欠着——按 notRun 复制会静默漏掉它", () => {
    const overview = summarizeBatch([failing("20260810-000001", 2)], SCIENCE)

    expect(overview.notRun).toEqual([1, 3, 7, 8])
    expect(overview.owed).toEqual([1, 2, 3, 7, 8])
    // 这就是两个口径必须分开的原因：进度说「跑过 1 题」，欠账说「还得跑 5 题」。
    expect(overview.attempted).toBe(1)
  })

  it("先失败后通过：不欠——batch 会跳过它", () => {
    const overview = summarizeBatch(
      [
        failing("20260810-013424", 3),
        run({ id: "20260810-052412", science125Id: 3, status: "passed" }),
      ],
      SCIENCE,
    )

    expect(overview.owed).not.toContain(3)
    expect(overview.owed).toEqual([1, 2, 7, 8])
  })

  it("先通过后失败：也不欠——失败的 run 不会把 passed 的键删掉，batch 照样跳过", () => {
    const overview = summarizeBatch(
      [
        run({ id: "20260810-013424", science125Id: 3, status: "passed" }),
        failing("20260810-052412", 3),
      ],
      SCIENCE,
    )

    // 最新终态是失败，所以它进 failed 与失败清单；但 batch 不会重跑它，所以它不欠。
    expect(overview.failed).toBe(1)
    expect(overview.owed).not.toContain(3)
    expect(overview.owed).toEqual([1, 2, 7, 8])
  })

  it("还在跑且从未通过的题欠着——working 不是 passed", () => {
    const overview = summarizeBatch(
      [
        run({
          id: "20260810-999999",
          science125Id: 3,
          status: "working",
          verify: null,
        }),
      ],
      SCIENCE,
    )

    expect(overview.owed).toContain(3)
  })

  it("整题库都通过过时欠账为空，页面不该给出一条空的 --ids", () => {
    const overview = summarizeBatch(
      [1, 2, 3, 7, 8].map((id) =>
        run({ id: `2026081${id}-000001`, science125Id: id }),
      ),
      SCIENCE,
    )

    expect(overview.owed).toEqual([])
    expect(compactIds(overview.owed)).toBe("")
  })

  it("欠账压成 --ids 时与未跑集合可以不同——这正是按错口径会断掉的地方", () => {
    const overview = summarizeBatch(
      [
        run({ id: "20260810-000001", science125Id: 1 }),
        failing("20260810-000002", 2),
        failing("20260810-000003", 3),
      ],
      SCIENCE,
    )

    expect(compactIds(overview.notRun)).toBe("7,8")
    expect(compactIds(overview.owed)).toBe("2,3,7,8")
  })
})

describe("summarizeBatch 取最新终态", () => {
  it("同题多 run 取 run id 最大的那次终态，先失败后通过就是通过", () => {
    const overview = summarizeBatch(
      [
        run({
          id: "20260810-013424",
          science125Id: 3,
          status: "failed",
          classification: "verifier_refs",
        }),
        run({ id: "20260810-052412", science125Id: 3, status: "passed" }),
      ],
      SCIENCE,
    )

    expect(overview.passed).toBe(1)
    expect(overview.failed).toBe(0)
    expect(overview.failures).toEqual([])
  })

  it("先通过后失败就是失败——最新终态是最新那次说的，不是最好那次说的", () => {
    const overview = summarizeBatch(
      [
        run({ id: "20260810-013424", science125Id: 3, status: "passed" }),
        run({
          id: "20260810-052412",
          science125Id: 3,
          status: "failed",
          classification: "contract_violation",
        }),
      ],
      SCIENCE,
    )

    expect(overview.passed).toBe(0)
    expect(overview.failed).toBe(1)
    expect(overview.failures[0].questions[0].runId).toBe("20260810-052412")
  })

  it("活跃 run 不遮住这题已有的终态：终态优先，working 只在没有终态时代表这题", () => {
    const working = run({
      id: "20260810-999999",
      science125Id: 3,
      status: "working",
      verify: null,
    })
    const settled = run({
      id: "20260810-052412",
      science125Id: 3,
      status: "passed",
    })

    expect(summarizeBatch([working, settled], SCIENCE).passed).toBe(1)

    const onlyWorking = summarizeBatch([working], SCIENCE)
    expect(onlyWorking.working).toBe(1)
    expect(onlyWorking.attempted).toBe(1)
    expect(onlyWorking.passed).toBe(0)
    expect(onlyWorking.failed).toBe(0)
    // 还在跑不等于没跑过：它不能同时出现在 notRun 里。
    expect(onlyWorking.notRun).toEqual([1, 2, 7, 8])
  })

  it("只有失败 run 的题算已跑，并进失败清单", () => {
    const overview = summarizeBatch(
      [
        run({
          id: "20260810-000001",
          science125Id: 7,
          status: "failed",
          verify: "fail",
          classification: "revision_no_change",
        }),
        run({
          id: "20260810-000002",
          science125Id: 7,
          status: "failed",
          verify: "fail",
          classification: "revision_no_change",
        }),
      ],
      SCIENCE,
    )

    expect(overview.attempted).toBe(1)
    expect(overview.failed).toBe(1)
    expect(overview.notRun).not.toContain(7)
    expect(overview.failures[0].questions[0].attempts).toBe(2)
  })
})

describe("summarizeBatch 环境性 vs 质量性", () => {
  const failing = (
    id: string,
    questionId: number,
    classification: string | null,
  ) =>
    run({
      id,
      science125Id: questionId,
      status: "failed",
      verify: "fail",
      classification,
    })

  it("infra_* 归环境性，其余归质量性，两个数字分开报", () => {
    const overview = summarizeBatch(
      [
        failing("20260810-000001", 1, "infra_timeout"),
        failing("20260810-000002", 2, "infra_error"),
        failing("20260810-000003", 3, "verifier_refs"),
        failing("20260810-000004", 7, "agent_budget_exhausted"),
      ],
      SCIENCE,
    )

    expect(overview.failed).toBe(4)
    expect(overview.infra).toBe(2)
    // agent_budget_exhausted 是 agent 行为失败，不是环境故障——把它算进 infra 会虚高一档。
    expect(overview.quality).toBe(2)
    expect(overview.unclassified).toBe(0)
  })

  it("分组按环境性→质量性→未分类排序，同类里题多的在前", () => {
    const overview = summarizeBatch(
      [
        failing("20260810-000001", 1, "verifier_refs"),
        failing("20260810-000002", 2, "verifier_refs"),
        failing("20260810-000003", 3, "contract_violation"),
        failing("20260810-000004", 7, "infra_error"),
        failing("20260810-000005", 8, null),
      ],
      SCIENCE,
    )

    expect(
      overview.failures.map((group) => [
        group.kind,
        group.classification,
        group.questions.length,
      ]),
    ).toEqual([
      ["infra", "infra_error", 1],
      ["quality", "verifier_refs", 2],
      ["quality", "contract_violation", 1],
      ["unclassified", null, 1],
    ])
  })

  it("classification 缺失的历史 run 归未分类，不被塞进任何一类", () => {
    const overview = summarizeBatch(
      [failing("20260808-054611", 1, null)],
      SCIENCE,
    )

    expect(overview.unclassified).toBe(1)
    expect(overview.infra).toBe(0)
    expect(overview.quality).toBe(0)
    expect(overview.failures[0].classification).toBeNull()
    expect(overview.failures[0].kind).toBe("unclassified")
  })

  it("通过的 run 即便带着 classification 也不进失败清单", () => {
    // 终态是 exitCode 0 而 classification 留有前一轮的字样时，判据是 status 不是字段有无。
    const overview = summarizeBatch(
      [
        run({
          id: "20260810-000001",
          science125Id: 1,
          status: "passed",
          classification: "verifier_refs",
        }),
      ],
      SCIENCE,
    )

    expect(overview.passed).toBe(1)
    expect(overview.failures).toEqual([])
    expect(overview.owed).not.toContain(1)
  })

  it("失败题带着题库题面与学科，清单一行就能读懂是哪题", () => {
    const overview = summarizeBatch(
      [failing("20260810-000001", 8, "verifier_refs")],
      SCIENCE,
    )

    expect(overview.failures[0].questions[0]).toMatchObject({
      questionId: 8,
      question: "Q8?",
      domain: "Biology",
      runId: "20260810-000001",
      status: "failed",
      classification: "verifier_refs",
      kind: "quality",
      attempts: 1,
    })
  })
})

describe("summarizeBatch cohort 身份", () => {
  it("同一 commit 的整批只有一个 cohort", () => {
    const overview = summarizeBatch(
      [
        run({ id: "20260810-000001", science125Id: 1 }),
        run({ id: "20260810-000002", science125Id: 2 }),
      ],
      SCIENCE,
    )

    expect(overview.cohorts).toEqual([
      { commit: "abc1234", treeDirty: false, questions: 2 },
    ])
  })

  it("脏树是标签的一部分：同一 commit 的干净树与脏树是两个 cohort", () => {
    const overview = summarizeBatch(
      [
        run({ id: "20260810-000001", science125Id: 1 }),
        run({
          id: "20260810-000002",
          science125Id: 2,
          sourceIdentity: { gitCommit: "abc1234", treeDirty: true },
        }),
      ],
      SCIENCE,
    )

    expect(overview.cohorts).toEqual([
      { commit: "abc1234", treeDirty: false, questions: 1 },
      { commit: "abc1234", treeDirty: true, questions: 1 },
    ])
  })

  it("sourceIdentity 为 null 的历史 run 自成一个不可归因的 cohort", () => {
    const overview = summarizeBatch(
      [
        run({ id: "20260808-054611", science125Id: 1, sourceIdentity: null }),
        run({ id: "20260808-055459", science125Id: 2, sourceIdentity: null }),
        run({ id: "20260810-000003", science125Id: 3 }),
      ],
      SCIENCE,
    )

    // 混了两个 cohort：这三个数字不是同一个系统产生的，页面必须能看出来。
    expect(overview.cohorts.length).toBe(2)
    expect(overview.cohorts[0]).toEqual({
      commit: null,
      treeDirty: false,
      questions: 2,
    })
    expect(overview.cohorts[1]).toEqual({
      commit: "abc1234",
      treeDirty: false,
      questions: 1,
    })
  })

  it("treeDirty 缺失（旧终态只写了 commit）不当作脏树，也不当作另一个 cohort", () => {
    const overview = summarizeBatch(
      [
        run({
          id: "20260810-000001",
          science125Id: 1,
          sourceIdentity: { gitCommit: "abc1234", treeDirty: null },
        }),
        run({ id: "20260810-000002", science125Id: 2 }),
      ],
      SCIENCE,
    )

    expect(overview.cohorts).toEqual([
      { commit: "abc1234", treeDirty: false, questions: 2 },
    ])
  })

  it("cohort 只统计代表各题终态的那批 run——被取代的旧 run 不参与", () => {
    const overview = summarizeBatch(
      [
        run({
          id: "20260810-000001",
          science125Id: 1,
          sourceIdentity: { gitCommit: "old0000", treeDirty: false },
        }),
        run({ id: "20260810-000002", science125Id: 1 }),
      ],
      SCIENCE,
    )

    expect(overview.cohorts).toEqual([
      { commit: "abc1234", treeDirty: false, questions: 1 },
    ])
  })

  it("没有任何 run 时 cohort 为空，不编一个 unknown 出来", () => {
    expect(summarizeBatch([], SCIENCE).cohorts).toEqual([])
  })
})
