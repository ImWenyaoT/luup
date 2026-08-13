/**
 * 批次概览的全部计算：runs 列表 + Science-125 题库 -> 一页能读的概览。
 *
 * 这里没有任何新的运行时状态。125 批跑的事实早已躺在 `runs/<id>/` 里——`meta.questionId`
 * 说这次跑的是哪一题，`exit.json` 说它怎么结束的、由哪份代码产出——本模块只是换个视角
 * 把它们聚起来。所以它是纯函数：同一份输入永远得到同一份输出，可以直接单测。
 *
 * 语义的权威在后端，不在这里：
 * - 失败分类的取值域是 `backend/app/domain/runs.py` 的 `FailureClass`；
 * - 环境性/质量性的切分是 `backend/app/evaluation.py` 的 `INFRASTRUCTURE_CLASSES`；
 * - cohort 标签的写法对齐 `evaluation.py` 的 `_cohort_label`（脏树是标签的一部分）；
 * - 题号区间的写法对齐 `backend/app/batch.py` 的 `parse_ids`（`3,7,12-14`）。
 */

import type { RunStatus, RunSummary, Science125 } from "./types"

/**
 * 环境故障不是质量判决：arXiv 超时说明的是网络，不是这份研究计划好不好。
 * 两者混在一个数字里，「我该重跑这批还是该改代码」就没有判据了。
 */
const INFRASTRUCTURE_CLASSES = new Set(["infra_error", "infra_timeout"])

export type FailureKind = "infra" | "quality" | "unclassified"

/** 一题一行：这题最终怎么了，以及是哪次 run 说的。 */
export type QuestionOutcome = {
  questionId: number
  question: string
  domain: string | null
  /** 代表这题终态的那次 run；点它进详情。 */
  runId: string
  status: RunStatus
  classification: string | null
  kind: FailureKind | null
  /** 这题一共跑过几次——多次运行本身是信号。 */
  attempts: number
}

export type FailureGroup = {
  /** 未分类失败没有 classification，用 null 表达，不编一个 "unknown" 出来。 */
  classification: string | null
  kind: FailureKind
  questions: QuestionOutcome[]
}

export type Cohort = {
  /** git 不可用时终态写的就是 null；此时这批数字无法归因到某份代码。 */
  commit: string | null
  treeDirty: boolean
  questions: number
}

export type BatchOverview = {
  /** 题库题数，不是写死的 125。 */
  total: number
  /** 至少跑过一次的题数。 */
  attempted: number
  passed: number
  failed: number
  working: number
  /** 环境性失败的题数。 */
  infra: number
  /** 质量性失败的题数。 */
  quality: number
  /** 失败但终态没自报分类的题数（TS 时代的旧 run）。 */
  unclassified: number
  /** 一次都没跑过的题号，升序。回答「跑到哪了」。 */
  notRun: number[]
  /**
   * 批跑还欠着的题号，升序——`notRun` ∪「跑过但一次都没通过」。回答「接下来跑什么」。
   *
   * 判据与 `app.batch` 的 `passed_question_runs` 同源，且是照它的**实现**定的，不是照直觉：
   * 那个函数遍历升序的 run 目录，只在 `_is_deliverable(entry)` 为真时才写
   * `passed[question_id] = entry.name`，失败的 run 既不覆盖也不删除已有的键。所以它认的是
   * **「存在任一 passed run」**，不是「最新终态是 passed」——先通过后失败的题，batch 照样跳过，
   * 因此它不欠。这与 `failed`（按最新终态算）故意不同：一个说进度，一个说欠账。
   */
  owed: number[]
  /** 已按 kind（infra → quality → 未分类）排好序的失败题清单。 */
  failures: FailureGroup[]
  /** 代表各题终态的那批 run 的 commit 分布；长度 > 1 即这些数字不是同一个系统产生的。 */
  cohorts: Cohort[]
  /** 没有题号的 run 数（自由输入 / 题号不在题库内）；它们不进任何覆盖率。 */
  unattributed: number
}

const KIND_ORDER: Record<FailureKind, number> = {
  infra: 0,
  quality: 1,
  unclassified: 2,
}

const failureKind = (classification: string | null): FailureKind =>
  classification === null
    ? "unclassified"
    : INFRASTRUCTURE_CLASSES.has(classification)
      ? "infra"
      : "quality"

/**
 * 题号列表压成 `app.batch --ids` 认的写法。三个以上的连号才压成区间：
 * `12,13` 与 `12-13` 一样长，压了反而多一次心算。
 */
export function compactIds(ids: readonly number[]): string {
  const sorted = [...new Set(ids)].sort((a, b) => a - b)
  const parts: string[] = []
  let start = 0
  while (start < sorted.length) {
    let end = start
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1)
      end += 1
    if (end - start + 1 >= 3) parts.push(`${sorted[start]}-${sorted[end]}`)
    else for (let i = start; i <= end; i += 1) parts.push(String(sorted[i]))
    start = end + 1
  }
  return parts.join(",")
}

/**
 * run id 形如 `20260810-165229`，字典序即时间序（后端 `list_ids` 也这么排）。
 * 用它而不是 `startedAt`：回填的旧 run 会把 startedAt 写成同一秒，排不出先后。
 */
const newestFirst = (a: RunSummary, b: RunSummary) =>
  a.id < b.id ? 1 : a.id > b.id ? -1 : 0

/**
 * 一题多次运行时，代表它的是**最新的终态 run**。全是 working（只可能是那唯一活跃的
 * 一次）时退回最新的一次，这题就报 working——不能因为还没终态就当它没跑过。
 */
const representative = (ordered: RunSummary[]): RunSummary =>
  ordered.find((run) => run.status !== "working") ?? ordered[0]

export function summarizeBatch(
  runs: readonly RunSummary[],
  science: Science125,
): BatchOverview {
  const bank = new Map<number, { question: string; domain: string }>()
  for (const domain of science.domains)
    for (const question of domain.questions)
      bank.set(question.id, {
        question: question.question,
        domain: domain.domain,
      })

  const byQuestion = new Map<number, RunSummary[]>()
  let unattributed = 0
  for (const run of runs) {
    const questionId = run.science125Id
    // 题号不在题库里的 run（自由输入的 OOD run）无法进覆盖率的分母，只能单列。
    if (questionId === null || !bank.has(questionId)) {
      unattributed += 1
      continue
    }
    const existing = byQuestion.get(questionId)
    if (existing) existing.push(run)
    else byQuestion.set(questionId, [run])
  }

  // 遍历题库而不是遍历 run：分母是题库，「一次没跑过」才有地方被数出来。
  const settled: { outcome: QuestionOutcome; run: RunSummary }[] = []
  const notRun: number[] = []
  const owed: number[] = []
  for (const [questionId, entry] of bank) {
    const group = byQuestion.get(questionId)
    if (group === undefined) {
      notRun.push(questionId)
      owed.push(questionId)
      continue
    }
    // 「存在任一 passed run」——照 `passed_question_runs` 的实现，不是按最新终态。
    if (!group.some((candidate) => candidate.status === "passed"))
      owed.push(questionId)
    const run = representative([...group].sort(newestFirst))
    const classification = run.status === "failed" ? run.classification : null
    settled.push({
      run,
      outcome: {
        questionId,
        question: entry.question,
        domain: entry.domain,
        runId: run.id,
        status: run.status,
        classification,
        kind: run.status === "failed" ? failureKind(classification) : null,
        attempts: group.length,
      },
    })
  }
  settled.sort((a, b) => a.outcome.questionId - b.outcome.questionId)
  notRun.sort((a, b) => a - b)
  owed.sort((a, b) => a - b)

  const outcomes = settled.map((item) => item.outcome)
  const failed = outcomes.filter((outcome) => outcome.status === "failed")
  const counted = (kind: FailureKind) =>
    failed.filter((outcome) => outcome.kind === kind).length

  return {
    total: bank.size,
    attempted: outcomes.length,
    passed: outcomes.filter((outcome) => outcome.status === "passed").length,
    failed: failed.length,
    working: outcomes.filter((outcome) => outcome.status === "working").length,
    infra: counted("infra"),
    quality: counted("quality"),
    unclassified: counted("unclassified"),
    notRun,
    owed,
    failures: groupFailures(failed),
    cohorts: cohortsOf(settled.map((item) => item.run)),
    unattributed,
  }
}

/** 环境性在前、质量性在后，同类里题多的在前——先看该查凭据还是该改代码。 */
function groupFailures(failed: readonly QuestionOutcome[]): FailureGroup[] {
  const groups = new Map<string, FailureGroup>()
  for (const outcome of failed) {
    const kind = outcome.kind ?? "unclassified"
    const key = outcome.classification ?? ""
    const existing = groups.get(key)
    if (existing) existing.questions.push(outcome)
    else
      groups.set(key, {
        classification: outcome.classification,
        kind,
        questions: [outcome],
      })
  }
  return [...groups.values()].sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      b.questions.length - a.questions.length ||
      (a.classification ?? "").localeCompare(b.classification ?? ""),
  )
}

/**
 * 统计的是**代表各题终态的那批 run**的身份，而不是全部 run：页面上的数字由它们产生，
 * 该被追问「是同一份代码吗」的也只有它们。
 */
function cohortsOf(runs: readonly RunSummary[]): Cohort[] {
  const cohorts = new Map<string, Cohort>()
  for (const run of runs) {
    const commit = run.sourceIdentity?.gitCommit ?? null
    const treeDirty = run.sourceIdentity?.treeDirty === true
    const key = commit === null ? "" : treeDirty ? `${commit}+dirty` : commit
    const existing = cohorts.get(key)
    if (existing) existing.questions += 1
    else cohorts.set(key, { commit, treeDirty, questions: 1 })
  }
  return [...cohorts.values()].sort(
    (a, b) =>
      b.questions - a.questions ||
      (a.commit ?? "").localeCompare(b.commit ?? ""),
  )
}
