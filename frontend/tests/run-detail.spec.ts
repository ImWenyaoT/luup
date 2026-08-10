import { expect, test } from "@playwright/test"
import { PASSED_RUN_ID, PASSED_RUN_PAPER_TITLE } from "./config"

test.beforeEach(async ({ page }) => {
  await page.goto(`/runs/${PASSED_RUN_ID}`)
  await expect(page.getByTestId("run-detail")).toBeVisible()
})

test("终态徽章与标题来自真实工件", async ({ page }) => {
  await expect(page.getByTestId("run-id")).toHaveText(PASSED_RUN_ID)
  await expect(page.getByTestId("run-status")).toHaveText("通过验收")
  // 独立验收的结论是终态判据：verification.json 里 result = ALL PASS。
  await expect(page.getByTestId("run-verify")).toHaveText("验收 ALL PASS")
  await expect(
    page.getByRole("heading", { name: new RegExp(PASSED_RUN_PAPER_TITLE) }),
  ).toBeVisible()
})

test("reasoning spine 渲染出 Scientist → Reviewer → Verify", async ({
  page,
}) => {
  const spine = page.getByTestId("spine")
  await expect(spine).toBeVisible()
  await expect(spine).toContainText("reasoning spine")

  const nodes = spine.getByTestId("spine-node")
  await expect(nodes).toHaveCount(3)
  await expect(nodes.nth(0)).toContainText("Scientist")
  await expect(nodes.nth(1)).toContainText("Reviewer")
  await expect(nodes.nth(2)).toContainText("Verify")
  // 三节点都已产出，工件名跟着节点走。
  await expect(nodes.nth(0)).toContainText("已产出")
  await expect(nodes.nth(1)).toContainText("review.json")
})

test("tab 切换后出现的是各自的真实工件内容", async ({ page }) => {
  const content = page.getByTestId("tab-content")

  // 默认停在 proposal：proposal.md 的一级标题就是论文题目。
  await expect(page.getByRole("tab", { name: "proposal" })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await expect(content).toContainText(PASSED_RUN_PAPER_TITLE)
  await expect(content).toContainText("研究问题")

  // review：review.json 被格式化后展示，含 reviewer 的裁决与整改项。
  await page.getByRole("tab", { name: "review" }).click()
  await expect(page.getByRole("tab", { name: "review" })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await expect(content).toContainText('"verdict"')
  await expect(content).toContainText("requiredChanges")

  // verification：结构化验收报告，逐项 check 带分组。
  await page.getByRole("tab", { name: "verification" }).click()
  await expect(content).toContainText("结果: ALL PASS")
  await expect(content).toContainText(/\d+\/\d+ 项通过/)
  await expect(content).toContainText("B3.count")

  // evidence：文献层落盘的证据卡。
  await page.getByRole("tab", { name: "evidence" }).click()
  await expect(content).not.toContainText("尚未产出")
  await expect(content).not.toHaveText("")
})

test("点 spine 节点把 tab 切到对应工件", async ({ page }) => {
  await page.getByTestId("spine-node").filter({ hasText: "Reviewer" }).click()
  await expect(page.getByRole("tab", { name: "review" })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await expect(page.getByTestId("tab-content")).toContainText("requiredChanges")
})

test("没有工件的节点其 tab 是禁用的", async ({ page }) => {
  // 本 run 没跑旧 L/H/C/W 拓扑，hypotheses / critique 应灰显而不是给空页面。
  await expect(page.getByRole("tab", { name: "hypotheses" })).toBeDisabled()
  await expect(page.getByRole("tab", { name: "critique" })).toBeDisabled()
  await expect(page.getByRole("tab", { name: /^papers/ })).toBeEnabled()
})

test("深链直开详情页返回页面而不是 404", async ({ page }) => {
  // 浏览器导航带 Accept: text/html，单进程托管必须回落到 index.html。
  const response = await page.goto(`/runs/${PASSED_RUN_ID}`)
  expect(response?.status()).toBe(200)
  expect(response?.headers()["content-type"]).toContain("text/html")

  await expect(page.getByTestId("run-detail")).toBeVisible()
  await expect(page.getByTestId("run-id")).toHaveText(PASSED_RUN_ID)
  await expect(page.getByTestId("not-found")).toHaveCount(0)
})

test("不存在的 run id 走前端的错误态而不是白屏", async ({ page }) => {
  const response = await page.goto("/runs/20000101-000000")
  expect(response?.status()).toBe(200)
  // 页面照常渲染出来，由 API 的 404 转成页面上的错误提示。
  await expect(page.getByTestId("topbar")).toBeVisible()
  await expect(page.getByRole("button", { name: "重试" })).toBeVisible()
})
