import { expect, type Page, test } from "@playwright/test"

/**
 * 「网页发起批次」这条链路的终点是真钱：`POST /api/batch` 会起一个跑几十小时、
 * 逐题调模型的子进程。所以这一套把那一个端点 mock 掉——选题分流、确认这一关、
 * 成功后的跳转全都真的走一遍，唯独不落到后端。其余端点仍读仓里已提交的 runs/。
 */

const CONFIRM = "batch-confirm"

const questions = (page: Page) => page.getByTestId("science125-question")
const selected = (page: Page) => page.getByTestId("science125-selected")
const trigger = (page: Page) =>
  page.getByRole("button", { name: /触发 pipeline|发起批次/ })

/** 拦下 POST /api/batch 并记录它收到的 body；返回值用来断言「到底发没发」。 */
async function interceptBatch(page: Page) {
  const bodies: unknown[] = []
  await page.route("**/api/batch", async (route) => {
    bodies.push(route.request().postDataJSON())
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ ids: [1, 2], idsSpec: "1,2" }),
    })
  })
  return bodies
}

test.beforeEach(async ({ page }) => {
  await page.goto("/")
})

test("勾一题走单题、勾两题改走批次，按钮文案跟着变", async ({ page }) => {
  await expect(selected(page)).toHaveText("已选 0 题")
  await expect(trigger(page)).toHaveText("触发 pipeline")

  await questions(page).nth(0).click()
  await expect(selected(page)).toHaveText("已选 1 题")
  // 单题仍是原来那条路：文案不变，点下去就是 POST /api/runs。
  await expect(trigger(page)).toHaveText("触发 pipeline")

  await questions(page).nth(1).click()
  await expect(selected(page)).toHaveText("已选 2 题")
  await expect(trigger(page)).toHaveText("发起批次（2 题）")
})

test("整行都是命中目标：点题面文字也能勾选", async ({ page }) => {
  const first = questions(page).first()
  await expect(first).toHaveAttribute("aria-checked", "false")

  // 勾选框只有 16px，行高 36px；label 把整行变成同一个命中目标。
  await first.locator("xpath=..").getByText(/\S/).last().click()

  await expect(first).toHaveAttribute("aria-checked", "true")
})

test("全选 125 题 / 清空，选中数与按钮同步", async ({ page }) => {
  await page.getByRole("button", { name: "全选（125 题）" }).click()
  await expect(selected(page)).toHaveText("已选 125 题")
  await expect(trigger(page)).toHaveText("发起批次（125 题）")

  await page.getByRole("button", { name: "清空" }).click()
  await expect(selected(page)).toHaveText("已选 0 题")
  await expect(trigger(page)).toHaveText("触发 pipeline")
})

test("全选当前学科只勾当前学科，切学科后可继续累加", async ({ page }) => {
  const domains = page.getByTestId("science125-domain")
  // count() 不会自动等待：题库还在加载时它会数出 0，把断言变成一句空话。
  await expect(questions(page).first()).toBeVisible()
  const firstCount = await questions(page).count()

  await page.getByRole("button", { name: "全选（当前学科）" }).click()
  await expect(selected(page)).toHaveText(`已选 ${firstCount} 题`)

  await domains.nth(1).click()
  const secondCount = await questions(page).count()
  await page.getByRole("button", { name: "全选（当前学科）" }).click()
  await expect(selected(page)).toHaveText(`已选 ${firstCount + secondCount} 题`)
})

test("≥2 题必须过确认这一关，取消不发任何请求", async ({ page }) => {
  const bodies = await interceptBatch(page)
  await questions(page).nth(0).click()
  await questions(page).nth(1).click()
  await trigger(page).click()

  const confirm = page.getByTestId(CONFIRM)
  await expect(confirm).toBeVisible()
  // 确认框必须回答「多少题、多久、要不要花钱」，否则它只是一次多余的点击。
  await expect(confirm).toContainText("发起 2 题的批次？")
  await expect(confirm).toContainText("真实 API 费用")
  await expect(confirm).toContainText("38–52 分钟")

  await confirm.getByRole("button", { name: "取消" }).click()
  await expect(confirm).toBeHidden()
  expect(bodies).toEqual([])
  await expect(page).toHaveURL(/\/$/)
})

test("125 题的确认框按实测样本给出小时量级的耗时", async ({ page }) => {
  await interceptBatch(page)
  await page.getByRole("button", { name: "全选（125 题）" }).click()
  await trigger(page).click()

  const confirm = page.getByTestId(CONFIRM)
  await expect(confirm).toContainText("发起 125 题的批次？")
  await expect(confirm).toContainText("40–54 小时")
  // 题号以 app.batch 认的写法给出，人能把它跟续跑命令对上。
  await expect(confirm).toContainText("1-125")
})

test("确认后发出 ids 并跳到批次页", async ({ page }) => {
  const bodies = await interceptBatch(page)
  const first = questions(page).nth(0)
  const second = questions(page).nth(1)
  const ids = [
    Number(await first.getAttribute("data-question-id")),
    Number(await second.getAttribute("data-question-id")),
  ]
  await first.click()
  await second.click()
  await trigger(page).click()
  await page
    .getByTestId(CONFIRM)
    .getByRole("button", { name: "确认发起" })
    .click()

  await expect(page).toHaveURL(/\/batch$/)
  await expect(page.getByRole("heading", { name: "批次概览" })).toBeVisible()
  expect(bodies).toEqual([{ ids }])
})

test("自由输入与选题互斥，写文字后回到单题路径", async ({ page }) => {
  await questions(page).nth(0).click()
  await questions(page).nth(1).click()
  await expect(trigger(page)).toHaveText("发起批次（2 题）")

  await page.getByLabel("自由输入").fill("一个足够长的自由输入科学问题")

  await expect(selected(page)).toHaveText("已选 0 题")
  await expect(trigger(page)).toHaveText("触发 pipeline")
  await expect(questions(page).nth(0)).toHaveAttribute("aria-checked", "false")
})
