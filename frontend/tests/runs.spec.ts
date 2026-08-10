import { expect, test } from "@playwright/test"
import { PASSED_RUN_ID } from "./config"

const rowFor = (id: string) => `[data-testid="run-row"][data-run-id="${id}"]`

test.beforeEach(async ({ page }) => {
  await page.goto("/runs")
})

test("历史表格渲染出仓里已提交的 run", async ({ page }) => {
  await expect(page.getByTestId("runs-table")).toBeVisible()

  const rows = page.getByTestId("run-row")
  await expect(rows.first()).toBeVisible()
  const total = await rows.count()
  expect(total).toBeGreaterThan(1)

  // 行数与表头右侧的「N 行」计数一致。
  await expect(page.getByTestId("runs-shown-count")).toHaveText(`${total} 行`)

  // fixture run 必须在表里，带 ALL PASS 验收，并链到自己的详情页。
  const row = page.locator(rowFor(PASSED_RUN_ID))
  await expect(row).toBeVisible()
  await expect(row.getByTestId("run-row-status")).toHaveText("通过验收")
  await expect(row.getByTestId("run-row-verify")).toHaveText("ALL PASS")
  await expect(row.getByTestId("run-row-id")).toHaveAttribute(
    "href",
    `/runs/${PASSED_RUN_ID}`,
  )
})

test("状态过滤只留下同状态的行", async ({ page }) => {
  const rows = page.getByTestId("run-row")
  await expect(rows.first()).toBeVisible()
  const total = await rows.count()

  const failedFilter = page
    .getByTestId("runs-filter")
    .filter({ hasText: "失败" })
  // 过滤按钮上的数字由数据算出，用它当断言基准，加一个 run 不会让用例失灵。
  const expected = Number((await failedFilter.innerText()).replace(/\D+/g, ""))
  expect(expected).toBeGreaterThan(0)
  expect(expected).toBeLessThan(total)

  await failedFilter.click()
  // 过滤器是互斥单选，用 ToggleGroup 渲染：选中态在 radio 的 aria-checked 上。
  await expect(failedFilter).toHaveAttribute("aria-checked", "true")
  await expect(rows).toHaveCount(expected)
  await expect(page.getByTestId("runs-shown-count")).toHaveText(
    `${expected} 行`,
  )
  await expect(page.getByTestId("run-row-status")).toHaveText(
    Array(expected).fill("失败"),
  )

  const allFilter = page.getByTestId("runs-filter").filter({ hasText: "全部" })
  await allFilter.click()
  await expect(allFilter).toHaveAttribute("aria-checked", "true")
  await expect(rows).toHaveCount(total)
})

test("按 id 排序可在降序与升序间切换", async ({ page }) => {
  const ids = page.getByTestId("run-row-id")
  await expect(ids.first()).toBeVisible()
  const descending = await ids.allInnerTexts()
  expect(descending.length).toBeGreaterThan(1)
  expect(descending).toEqual([...descending].sort().reverse())

  const sortById = page.getByTestId("runs-sort-id")
  await expect(sortById).toHaveText(/↓/)
  await sortById.click()
  await expect(sortById).toHaveText(/↑/)

  await expect(ids.first()).toHaveText(descending[descending.length - 1])
  expect(await ids.allInnerTexts()).toEqual([...descending].sort())
})

test("点表格里的 run id 进详情页", async ({ page }) => {
  await page.locator(rowFor(PASSED_RUN_ID)).getByTestId("run-row-id").click()
  await expect(page).toHaveURL(new RegExp(`/runs/${PASSED_RUN_ID}$`))
  await expect(page.getByTestId("run-id")).toHaveText(PASSED_RUN_ID)
})
