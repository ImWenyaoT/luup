import { Link } from "@tanstack/react-router"
import { TriangleAlertIcon } from "lucide-react"
import type {
  BatchOverview,
  FailureGroup,
  FailureKind,
  QuestionOutcome,
} from "@/batch"
import { compactIds } from "@/batch"
import { CopyCommand } from "@/components/Batch/CopyCommand"
import { Section } from "@/components/Common/Section"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { cn } from "@/lib/utils"

/** 批跑的入口命令；`--ids` 的写法由 `app.batch` 的 parse_ids 定义。 */
const command = (ids: readonly number[]) =>
  `uv run python -m app.batch --ids ${compactIds(ids)}`

/**
 * 环境性与质量性的区别不是配色问题，是「我该重跑这批还是该改代码」的判据，
 * 所以它以标题 + 一句判断写出来，而不是指望读者从两种红里读出来。
 */
const KIND_CAPTION: Record<FailureKind, { title: string; hint: string }> = {
  infra: {
    title: "环境性故障",
    hint: "凭据、网络或配额的问题，与这份研究计划的质量无关——重跑即可。",
  },
  quality: {
    title: "质量性结果",
    hint: "Harness 自己判的不合格，重跑同一份代码只会再失败一次。",
  },
  unclassified: {
    title: "未分类",
    hint: "终态没自报分类的旧 run；只能开 run 详情逐个看。",
  },
}

export function BatchView({ overview }: { overview: BatchOverview }) {
  return (
    <div className="flex flex-col gap-12">
      <Coverage overview={overview} />
      <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start gap-12">
        <Distribution overview={overview} />
        <Cohorts overview={overview} />
      </div>
      <Failures overview={overview} />
    </div>
  )
}

function Coverage({ overview }: { overview: BatchOverview }) {
  const { total, attempted, passed, failed, working, notRun, owed } = overview
  const share = (value: number) => (total ? (value / total) * 100 : 0)
  return (
    <Section title="覆盖进度" meta="按 questionId 去重，同题多 run 取最新终态">
      <div className="flex flex-col gap-4">
        <p className="text-base">
          <span
            className="text-2xl font-medium tabular-nums"
            data-testid="batch-attempted"
          >
            {attempted}
          </span>
          <span className="text-muted-foreground"> / </span>
          <span className="tabular-nums">{total}</span> 题已跑
          <span className="text-muted-foreground">
            {" "}
            · 通过 <span className="tabular-nums">{passed}</span> · 失败{" "}
            <span className="tabular-nums">{failed}</span>
            {working ? (
              <>
                {" "}
                · 运行中 <span className="tabular-nums">{working}</span>
              </>
            ) : null}
          </span>
        </p>
        <div
          className="flex h-1.5 w-full overflow-hidden rounded-sm bg-muted"
          data-testid="batch-progress"
          role="img"
          aria-label={`${total} 题中通过 ${passed}、失败 ${failed}、未跑 ${notRun.length}`}
        >
          <span
            className="bg-primary"
            style={{ width: `${share(passed)}%` }}
            aria-hidden
          />
          <span
            className="bg-destructive"
            style={{ width: `${share(failed)}%` }}
            aria-hidden
          />
        </div>
        {owed.length ? (
          <div className="flex flex-col gap-1">
            {/*
              「已跑」与「还欠」是两个口径，必须写在同一句里，否则两个数字看起来在打架：
              上一行按最新终态说进度，这一行按 app.batch 的跳过判据说欠账。
            */}
            {/* 整句放进一个表达式：断句由这里决定，不由 JSX 的换行折叠决定。 */}
            <p className="max-w-[68ch] text-[13px] tabular-nums text-muted-foreground">
              {`接着跑还欠 ${owed.length} 题——未跑过 ${notRun.length} 题，加上跑过但一次都没通过的 ${owed.length - notRun.length} 题。app.batch 只跳过「有过 passed run」的题，所以失败过的题仍然欠着：`}
            </p>
            <CopyCommand
              command={command(owed)}
              label={`复制续跑命令（${owed.length} 题）`}
              testId="batch-resume-command"
            />
          </div>
        ) : (
          <p className="text-[13px] tabular-nums text-muted-foreground">
            {`${total} 题都已有通过的 run，批跑没有欠账的题号。`}
          </p>
        )}
        {overview.unattributed ? (
          <p className="text-[13px] text-muted-foreground">
            另有 <span className="tabular-nums">{overview.unattributed}</span>{" "}
            次运行没有题号（自由输入），不计入覆盖率。
          </p>
        ) : null}
      </div>
    </Section>
  )
}

function Distribution({ overview }: { overview: BatchOverview }) {
  const { passed, failures, attempted } = overview
  const peak = Math.max(
    passed,
    ...failures.map((group) => group.questions.length),
    1,
  )
  // 环境性/质量性的题数由聚合函数给（有单测），这里不再从分组重算一遍。
  const kinds: [FailureKind, number][] = [
    ["infra", overview.infra],
    ["quality", overview.quality],
    ["unclassified", overview.unclassified],
  ]
  return (
    <Section title="终态分布" meta={`${attempted} 题的最新终态`}>
      <div className="flex flex-col gap-6" data-testid="batch-distribution">
        <Bar label="通过验收" count={passed} peak={peak} tone="good" />
        {kinds.map(([kind, sum]) => {
          const groups = failures.filter((group) => group.kind === kind)
          if (!groups.length) return null
          const caption = KIND_CAPTION[kind]
          return (
            <div
              key={kind}
              className="flex flex-col gap-2"
              data-testid="batch-kind"
              data-kind={kind}
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] font-medium">
                  {caption.title}
                  <span className="text-muted-foreground">
                    {" "}
                    · <span className="tabular-nums">{sum}</span> 题
                  </span>
                </span>
                <span className="max-w-[52ch] text-xs text-muted-foreground">
                  {caption.hint}
                </span>
              </div>
              {groups.map((group) => (
                <Bar
                  key={group.classification ?? "unclassified"}
                  label={group.classification ?? "（终态未自报分类）"}
                  mono={group.classification !== null}
                  count={group.questions.length}
                  peak={peak}
                  tone="bad"
                />
              ))}
            </div>
          )
        })}
        {passed === 0 && failures.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            还没有终态可分布——跑完第一题后这里就有数字了。
          </p>
        ) : null}
      </div>
    </Section>
  )
}

function Bar({
  label,
  count,
  peak,
  tone,
  mono,
}: {
  label: string
  count: number
  peak: number
  tone: "good" | "bad"
  mono?: boolean
}) {
  return (
    <div className="flex items-center gap-3" data-testid="batch-bar">
      <span
        className={cn(
          "w-[196px] shrink-0 truncate text-[13px]",
          mono && "font-mono text-xs",
        )}
        title={label}
      >
        {label}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span
          aria-hidden
          className={cn(
            "h-2 rounded-[1px]",
            tone === "good" ? "bg-primary" : "bg-destructive",
          )}
          style={{ width: `${(count / peak) * 100}%` }}
        />
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {count}
        </span>
      </span>
    </div>
  )
}

function Cohorts({ overview }: { overview: BatchOverview }) {
  const { cohorts } = overview
  return (
    <Section title="cohort 身份" meta="产出这些数字的那份代码">
      <div className="flex flex-col gap-4" data-testid="batch-cohorts">
        {cohorts.length > 1 ? (
          <Alert data-testid="batch-cohort-warning">
            <TriangleAlertIcon />
            <AlertTitle>这些数字不是同一个系统产生的</AlertTitle>
            <AlertDescription>
              <p className="max-w-[52ch]">
                本页有 <span className="tabular-nums">{cohorts.length}</span> 个
                cohort。跨 cohort 的通过率不可直接相加——报告里要么按 cohort
                分开给，要么重跑成一个干净 cohort。
              </p>
            </AlertDescription>
          </Alert>
        ) : null}
        {cohorts.length ? (
          <ul className="flex flex-col">
            {cohorts.map((cohort) => (
              <li
                key={`${cohort.commit ?? "unknown"}${cohort.treeDirty}`}
                className="flex items-baseline gap-3 border-b py-2 last:border-b-0"
                data-testid="batch-cohort"
              >
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-[13px]",
                    cohort.commit
                      ? "font-mono text-xs"
                      : "text-muted-foreground",
                  )}
                  title={cohort.commit ?? undefined}
                >
                  {cohort.commit?.slice(0, 12) ?? "终态未记录 commit"}
                </span>
                {cohort.treeDirty ? (
                  <span className="shrink-0 text-xs text-destructive">
                    工作区有改动
                  </span>
                ) : null}
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {cohort.questions} 题
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            还没有终态可归因。
          </p>
        )}
      </div>
    </Section>
  )
}

function Failures({ overview }: { overview: BatchOverview }) {
  const { failures, failed } = overview
  return (
    <Section
      title="失败题清单"
      meta={failed ? <span className="tabular-nums">{failed} 题</span> : null}
    >
      {failures.length ? (
        <div className="flex flex-col gap-8" data-testid="batch-failures">
          {failures.map((group) => (
            <FailureBlock
              key={group.classification ?? "unclassified"}
              group={group}
            />
          ))}
        </div>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          没有最新终态为失败的题。
        </p>
      )}
    </Section>
  )
}

function FailureBlock({ group }: { group: FailureGroup }) {
  const caption = KIND_CAPTION[group.kind]
  return (
    <div className="flex flex-col gap-2" data-testid="batch-failure-group">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className={cn(
            "text-[13px] font-medium",
            group.classification ? "font-mono text-xs" : null,
          )}
        >
          {group.classification ?? "（终态未自报分类）"}
        </span>
        <span className="text-xs text-muted-foreground">
          {caption.title} ·{" "}
          <span className="tabular-nums">{group.questions.length}</span> 题
        </span>
      </div>
      <ul className="flex flex-col">
        {group.questions.map((question) => (
          <li key={question.questionId} className="border-b last:border-b-0">
            <FailureRow question={question} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function FailureRow({ question }: { question: QuestionOutcome }) {
  return (
    <Link
      to="/runs/$runId"
      params={{ runId: question.runId }}
      data-testid="batch-failure-row"
      data-question-id={question.questionId}
      className="-mx-2 flex min-h-8 items-baseline gap-3 rounded-sm px-2 py-2 transition-colors hover:bg-accent/60 active:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
        q{question.questionId}
      </span>
      <span className="w-[128px] shrink-0 truncate text-xs text-muted-foreground">
        {question.domain ?? "—"}
      </span>
      <span
        className="min-w-0 flex-1 truncate text-[13px]"
        title={question.question}
      >
        {question.question}
      </span>
      {question.attempts > 1 ? (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          跑过 {question.attempts} 次
        </span>
      ) : null}
      <span className="shrink-0 font-mono text-xs text-muted-foreground">
        {question.runId}
      </span>
    </Link>
  )
}
