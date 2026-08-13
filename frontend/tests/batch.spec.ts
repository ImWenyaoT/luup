import { expect, test } from "@playwright/test"

/**
 * fixture 是仓里已提交的 `runs/`：20 个 run 里有 10 个带 `meta.questionId`，覆盖
 * 第 1 / 54 / 61 / 125 四题（第 61 题一题就跑了 6 次）；54 / 61 / 125 的最新终态是
 * passed，第 1 题只跑过一次且以 `contract_violation` 失败（20260813-062746，也是
 * 唯一带 `sourceIdentity` 的 run）。其余 10 个是自由输入的 run，没有题号，只能进
 * 「不计入覆盖率」那一栏。整套用例零 LLM 调用、零 POST。
 */
const ATTEMPTED = 4
const PASSED = 3
const FAILED = 1
const NOT_RUN = 121
/**
 * 第 1 题跑过但一次都没通过，`app.batch` 不会跳过它，所以欠账 = 未跑 121 题 + 第 1 题。
 * 125 题去掉 54 / 61 / 125 之后压出来的区间写法，`app.batch` 的 parse_ids 认这一串。
 */
const OWED = NOT_RUN + FAILED
const RESUME_IDS = "1-53,55-60,62-124"

test.beforeEach(async ({ page }) => {
  await page.goto("/batch")
})

test("顶栏第四个入口进批次概览", async ({ page }) => {
  await page.goto("/")
  await page
    .getByTestId("topbar-nav")
    .getByRole("link", { name: "批次" })
    .click()

  await expect(page).toHaveURL(/\/batch$/)
  await expect(page.getByRole("heading", { name: "批次概览" })).toBeVisible()
})

test("覆盖进度按题号去重，未跑题数是题库减去已跑", async ({ page }) => {
  await expect(page.getByTestId("batch-attempted")).toHaveText(
    String(ATTEMPTED),
  )
  // 10 个自由输入的 run 一个都不许被算进已跑题数。
  await expect(page.getByText("次运行没有题号（自由输入）")).toBeVisible()
  await expect(page.getByTestId("batch-progress")).toHaveAttribute(
    "aria-label",
    `125 题中通过 ${PASSED}、失败 ${FAILED}、未跑 ${NOT_RUN}`,
  )
})

test("续跑命令复制的是 batch 的欠账集合，按钮自报它包含什么", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  const command = page.getByTestId("batch-resume-command")
  // 按钮文案必须带题数，否则会被读成「只含未跑的」。
  await expect(command.getByRole("button")).toHaveText(
    `复制续跑命令（${OWED} 题）`,
  )
  await expect(
    page.getByText(
      `接着跑还欠 ${OWED} 题——未跑过 ${NOT_RUN} 题，加上跑过但一次都没通过的 ${FAILED} 题`,
    ),
  ).toBeVisible()
  await expect(command).toContainText(
    `uv run python -m app.batch --ids ${RESUME_IDS}`,
  )

  await command.getByRole("button").click()

  await expect(command.getByRole("button")).toHaveText("已复制")
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    `uv run python -m app.batch --ids ${RESUME_IDS}`,
  )
})

test("已提交语料里三题通过、第 1 题以 contract_violation 失败", async ({
  page,
}) => {
  const bars = page.getByTestId("batch-distribution").getByTestId("batch-bar")
  // 通过验收一条，加上唯一一类失败分类一条。
  await expect(bars).toHaveCount(2)
  await expect(bars.first()).toContainText("通过验收")
  const kinds = page.getByTestId("batch-kind")
  await expect(kinds).toHaveCount(1)
  await expect(kinds.first()).toContainText("质量性结果")
  await expect(kinds.first()).toContainText("contract_violation")

  const rows = page
    .getByTestId("batch-failures")
    .getByTestId("batch-failure-row")
  await expect(rows).toHaveCount(FAILED)
  await expect(rows.first()).toHaveAttribute("data-question-id", "1")
  await rows.first().click()
  await expect(page).toHaveURL(/\/runs\/20260813-062746$/)
})

test("cohort 区块把记录了 commit 的那题与未记录的分开，并对混 cohort 报警", async ({
  page,
}) => {
  const cohorts = page.getByTestId("batch-cohort")
  await expect(cohorts).toHaveCount(2)
  await expect(cohorts.filter({ hasText: "774a42b1b927" })).toContainText(
    "1 题",
  )
  await expect(cohorts.filter({ hasText: "终态未记录 commit" })).toContainText(
    "3 题",
  )
  // 语料里现在真的混了两个 cohort，这份进度不能当成一个系统的数字读。
  await expect(page.getByTestId("batch-cohort-warning")).toContainText(
    "这些数字不是同一个系统产生的",
  )
})

/**
 * 已提交语料里只有质量性失败，所以「环境性与质量性同时呈现」和「三个 cohort」这两处
 * 渲染在真实 fixture 下仍不可达。它们是本页最有价值的两块信息，不能只靠单测的返回值
 * 担保，所以这一条把 `/api/runs` 换成一份合成响应——仍然零 LLM、零后端状态，换掉的
 * 只是读模型的输出。聚合语义本身由 `src/batch.test.ts` 把关。
 */
test("失败按环境性/质量性分开呈现，混 cohort 时显眼提示", async ({ page }) => {
  const run = (
    id: string,
    science125Id: number,
    classification: string | null,
    gitCommit: string | null,
  ) => ({
    id,
    startedAt: "2026-08-12T00:00:00.000Z",
    finishedAt: "2026-08-12T00:10:00.000Z",
    status: classification === null ? "passed" : "failed",
    question: `第 ${science125Id} 题`,
    domain: "Astronomy",
    science125Id,
    refs: 5,
    verify: classification === null ? "pass" : "fail",
    durationSec: 600,
    classification,
    sourceIdentity: gitCommit && { gitCommit, treeDirty: false },
    nodes: [],
  })

  await page.route("**/api/runs?**", async (route) => {
    await route.fulfill({
      json: {
        active: null,
        runs: [
          run("20260812-000001", 1, null, "aaaaaaa1"),
          run("20260812-000002", 2, "infra_timeout", "aaaaaaa1"),
          run("20260812-000003", 3, "verifier_refs", "bbbbbbb2"),
          run("20260812-000004", 4, "contract_violation", null),
        ],
      },
    })
  })
  await page.reload()

  // 第 1 题通过、2/3/4 题失败：欠账是 2-125，不是未跑集合 5-125。按未跑口径复制会静默
  // 漏掉那三道最该重跑的题——这是「网页与命令行之间的桥」唯一会断的地方。
  await expect(page.getByTestId("batch-resume-command")).toContainText(
    "uv run python -m app.batch --ids 2-125",
  )
  await expect(
    page.getByText(
      "接着跑还欠 124 题——未跑过 121 题，加上跑过但一次都没通过的 3 题",
    ),
  ).toBeVisible()

  const kinds = page.getByTestId("batch-kind")
  await expect(kinds).toHaveCount(2)
  await expect(
    kinds.filter({ has: page.getByText("环境性故障") }),
  ).toContainText("infra_timeout")
  await expect(
    kinds.filter({ has: page.getByText("质量性结果") }),
  ).toContainText("verifier_refs")

  const rows = page.getByTestId("batch-failure-row")
  await expect(rows).toHaveCount(3)
  // 环境性那组排在最前：先回答「该查凭据还是该改代码」。
  await expect(rows.first()).toHaveAttribute("data-question-id", "2")

  // 三个 cohort（两个 commit + 一个未记录）必须被点名，否则这些数字会被当成一份数据读。
  await expect(page.getByTestId("batch-cohort-warning")).toContainText(
    "这些数字不是同一个系统产生的",
  )
  await expect(page.getByTestId("batch-cohort")).toHaveCount(3)

  await rows.first().click()
  await expect(page).toHaveURL(/\/runs\/20260812-000002$/)
})
