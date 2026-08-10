import { expect, type Page, test } from "@playwright/test"

const bodyBackground = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor)

const backgroundToken = (page: Page) =>
  page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--background")
      .trim(),
  )

test.describe("系统偏好为 dark", () => {
  test.use({ colorScheme: "dark" })

  test("首屏就带上 dark 主题类", async ({ page }) => {
    await page.goto("/")
    await expect(page.locator("html")).toHaveClass(/\bdark\b/)
    await expect(page.getByTestId("topbar")).toBeVisible()
  })
})

test.describe("系统偏好为 light", () => {
  test.use({ colorScheme: "light" })

  test("首屏不带 dark 主题类", async ({ page }) => {
    await page.goto("/")
    await expect(page.locator("html")).not.toHaveClass(/\bdark\b/)
  })
})

test("切到 dark 后主题类与背景色都跟着变", async ({ page }) => {
  const html = page.locator("html")

  await page.emulateMedia({ colorScheme: "light" })
  await page.goto("/")
  await expect(html).not.toHaveClass(/\bdark\b/)
  const lightBackground = await bodyBackground(page)
  const lightToken = await backgroundToken(page)

  // ThemeProvider 订阅了 prefers-color-scheme，运行期切换应即时生效。
  await page.emulateMedia({ colorScheme: "dark" })
  await expect(html).toHaveClass(/\bdark\b/)
  await expect.poll(() => backgroundToken(page)).not.toBe(lightToken)
  expect(await bodyBackground(page)).not.toBe(lightBackground)

  // 深色下页面照常可读，不是只换了个 class。
  await expect(page.getByTestId("topbar")).toBeVisible()
  await expect(page.getByTestId("science125-picker")).toBeVisible()
})
