import { expect, type Route, test } from "@playwright/test"
import { PASSED_RUN_ID, PASSED_RUN_PAPER_TITLE } from "./config"

/**
 * 瞬时故障（网络抖动 / 5xx）走的是另一条链路：ErrorBox + 「重试」按钮。
 * 这里用 Playwright 的 route mocking 造 500，只拦被测的那一条 API 路径，
 * 不碰 LLM、不碰 POST /api/runs。恢复链路要真点通，不是只断言按钮在。
 */

const FAULT_MESSAGE = "模拟的服务端故障"

const failWith500 = (route: Route) =>
  route.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ error: FAULT_MESSAGE, code: "injected_fault" }),
  })

/** 只匹配列表端点本身，不吃 /api/runs/<id>，也不吃 /api/science125。 */
const isRunsList = (url: URL) => url.pathname === "/api/runs"
/** 详情 JSON 与工件读取共用 pathname，靠 ?artifact= 区分，别把工件也一起打掉。 */
const isRunDetail = (url: URL) =>
  url.pathname === `/api/runs/${PASSED_RUN_ID}` &&
  !url.searchParams.has("artifact")

test("历史页遇到 5xx 时给出错误态，重试后恢复", async ({ page }) => {
  await page.route(isRunsList, failWith500)
  await page.goto("/runs")

  const errorBox = page.getByTestId("error-box")
  await expect(errorBox).toBeVisible()
  await expect(errorBox).toContainText(FAULT_MESSAGE)
  const retry = errorBox.getByRole("button", { name: "重试" })
  await expect(retry).toBeVisible()
  // 不白屏：外壳照常在，只有数据区退化成错误态。
  await expect(page.getByTestId("topbar")).toBeVisible()
  await expect(page.getByTestId("runs-table")).toHaveCount(0)

  // 放行后点「重试」，应当真的重新取数并渲染出仓里的 fixture 行。
  await page.unroute(isRunsList, failWith500)
  await retry.click()

  await expect(page.getByTestId("runs-table")).toBeVisible()
  await expect(
    page.locator(`[data-testid="run-row"][data-run-id="${PASSED_RUN_ID}"]`),
  ).toBeVisible()
  await expect(page.getByTestId("error-box")).toHaveCount(0)
})

test("详情页遇到 5xx 时给出错误态，重试后恢复", async ({ page }) => {
  await page.route(isRunDetail, failWith500)
  await page.goto(`/runs/${PASSED_RUN_ID}`)

  const errorBox = page.getByTestId("error-box")
  await expect(errorBox).toBeVisible()
  await expect(errorBox).toContainText(FAULT_MESSAGE)
  const retry = errorBox.getByRole("button", { name: "重试" })
  await expect(retry).toBeVisible()
  await expect(page.getByTestId("topbar")).toBeVisible()
  await expect(page.getByTestId("run-detail")).toHaveCount(0)

  await page.unroute(isRunDetail, failWith500)
  await retry.click()

  await expect(page.getByTestId("run-detail")).toBeVisible()
  await expect(page.getByTestId("run-id")).toHaveText(PASSED_RUN_ID)
  await expect(page.getByTestId("run-verify")).toHaveText("验收 ALL PASS")
  await expect(page.getByTestId("tab-content")).toContainText(
    PASSED_RUN_PAPER_TITLE,
  )
  await expect(page.getByTestId("error-box")).toHaveCount(0)
})
