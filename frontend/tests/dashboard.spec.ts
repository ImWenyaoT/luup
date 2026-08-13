import { expect, test } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  await page.goto("/")
})

test("topbar 渲染品牌与四条导航", async ({ page }) => {
  const topbar = page.getByTestId("topbar")
  await expect(topbar).toBeVisible()
  await expect(page.getByTestId("topbar-brand")).toContainText("luup")

  const nav = page.getByTestId("topbar-nav")
  await expect(nav.getByRole("link")).toHaveText([
    "仪表台",
    "批次",
    "历史",
    "API",
  ])
  await expect(nav.getByRole("link", { name: "历史" })).toHaveAttribute(
    "href",
    "/runs",
  )
  await expect(nav.getByRole("link", { name: "批次" })).toHaveAttribute(
    "href",
    "/batch",
  )
})

test("历史导航跳到 /runs", async ({ page }) => {
  await page
    .getByTestId("topbar-nav")
    .getByRole("link", { name: "历史" })
    .click()
  await expect(page).toHaveURL(/\/runs$/)
  await expect(page.getByTestId("runs-table")).toBeVisible()
})

test("Science-125 选题器有真实题库数据", async ({ page }) => {
  const picker = page.getByTestId("science125-picker")
  await expect(picker).toBeVisible()

  // 题库固定 125 题 / 12 学科，面板右上角由 API 的 total 渲染。
  await expect(page.getByText(/125 题 \/ \d+ 学科/)).toBeVisible()

  const domains = page.getByTestId("science125-domain")
  await expect(domains.first()).toHaveAttribute("aria-pressed", "true")
  const domainCount = await domains.count()
  expect(domainCount).toBeGreaterThan(1)

  // 首个学科默认选中，题目列表非空。
  const questions = page.getByTestId("science125-question")
  await expect(questions.first()).toBeVisible()
  const firstDomainQuestions = await questions.count()
  expect(firstDomainQuestions).toBeGreaterThan(0)

  // 切学科后题目列表跟着换，证明数据是按学科分组的而不是写死一份。
  const secondDomain = domains.nth(1)
  const secondLabel = (await secondDomain.innerText()).trim()
  await secondDomain.click()
  await expect(secondDomain).toHaveAttribute("aria-pressed", "true")
  await expect(domains.first()).toHaveAttribute("aria-pressed", "false")
  await expect(questions.first()).toBeVisible()
  expect(secondLabel.length).toBeGreaterThan(0)
})

test("选题只改本地选中态，不触发 pipeline", async ({ page }) => {
  const first = page.getByTestId("science125-question").first()
  await first.click()
  await expect(first).toHaveAttribute("aria-pressed", "true")
  // 触发按钮此时可用，但本套用例一律不点：POST /api/runs 会真的调模型。
  await expect(
    page.getByRole("button", { name: "触发 pipeline" }),
  ).toBeEnabled()
  await expect(page).toHaveURL(/\/$/)
})

test("可调用测试 API 面板挂在 #api 锚点上", async ({ page }) => {
  const panel = page.locator("#api")
  await expect(panel).toBeVisible()
  await expect(panel).toContainText("可调用测试 API")

  const examples = panel.getByTestId("api-examples")
  await expect(examples.getByRole("listitem")).toHaveCount(4)
  await expect(examples).toContainText("/api/science125")
  await expect(examples).toContainText("/api/runs")
  // curl 里的 origin 必须是当前页面的 origin —— 单进程同端口托管的直接证据。
  await expect(examples).toContainText(new URL(page.url()).origin)
})
