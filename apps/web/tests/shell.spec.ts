import { expect, test } from "@playwright/test";

test("shell layout shows sidebar and question input", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("question-sidebar-panel")).toBeVisible();
  await expect(page.getByRole("list", { name: "Science 125 项目导航层级" })).toBeVisible();
  await expect(page.getByRole("button", { name: /题库/ })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: /Runs/ })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("welcome-question-input")).toBeVisible();
  await expect(page.getByTestId("question-search")).toBeVisible();
});

test("home page shows Luup heading", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Luup" })).toBeVisible();
});

test("create run navigates to ?run= query param", async ({ page }) => {
  await page.goto("/");
  const question = "E2E deterministic smoke question";
  await page.getByTestId("welcome-question-input").fill(question);
  await page.getByTestId("start-research").click();
  await page.waitForURL(/\?run=/, { timeout: 60_000 });
  await expect(page.getByTestId("run-header")).toBeVisible();
  await expect(page.getByTestId("run-workspace")).toBeVisible();
  await expect(page.getByRole("tab", { name: question })).toHaveAttribute("aria-selected", "true");
  await page.reload();
  await expect(page.getByRole("tab", { name: question })).toBeVisible();
  await page.getByTestId(/close-run-/).click();
  await expect(page).not.toHaveURL(/\?run=/);
  await expect(page.getByTestId("welcome-panel")).toBeVisible();
  await expect(page.getByTestId("run-tabs")).toBeFocused();
});

test("mobile uses a full-width question drawer and restores the primary task", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("question-sidebar-panel")).not.toBeAttached();
  await page.getByTestId("toggle-sidebar").click();
  const drawer = page.getByTestId("question-sidebar-panel");
  await expect(drawer).toBeVisible();
  await expect.poll(async () => (await drawer.boundingBox())?.width).toBe(390);
  await page.getByTestId("project-sidebar").getByRole("button", { name: "关闭项目导航" }).click();
  await expect(page.getByTestId("welcome-question-input")).toBeVisible();
  await page.getByTestId("toggle-sidebar").click();
  await page.getByTestId("open-settings").click();
  await expect(page.getByRole("dialog", { name: "系统与模型设置" })).toBeVisible();
});

test("inspector overlays Main without geometry changes at desktop breakpoints", async ({ page }) => {
  await page.setViewportSize({ width: 901, height: 844 });
  await page.goto("/");
  await page.getByTestId("welcome-question-input").fill("Inspector geometry test");
  await page.getByTestId("start-research").click();
  await expect(page.getByTestId("run-workspace")).toBeVisible();

  for (const width of [901, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const main = page.getByTestId("app-main");
    const before = await main.boundingBox();
    await page.getByRole("button", { name: "查看冻结产物" }).click();
    await expect(page.getByTestId("workspace-inspector")).toBeVisible();
    const after = await main.boundingBox();
    expect(after).toEqual(before);
    await page.getByRole("button", { name: "关闭证据与冻结产物" }).click();
    await expect(page.getByTestId("workspace-inspector")).not.toBeAttached();
  }
});
