import { expect, test } from "@playwright/test";

test("queues a future-role instruction, observes its application after reload, and preserves the original question", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const question = "可复现的证据能减少无来源引用吗？";
  await page.getByPlaceholder("提出一个可以设计实验去检验的研究问题").fill(question);
  await page.getByRole("button", { name: "开始研究" }).click();
  const controls = page.getByTestId("run-controls");
  await expect(controls).toBeVisible();
  await controls.getByText("向后续角色追加指令").click();
  await controls.getByLabel("追加指令的目标角色").selectOption("reviewer");
  await controls.getByRole("textbox", { name: "追加指令", exact: true }).fill("请明确列出无法验证的假设。");
  await controls.getByRole("button", { name: "追加指令", exact: true }).click();
  await expect(controls.getByLabel("追加指令状态")).toContainText("已排队");
  await page.screenshot({ path: "/private/tmp/luup-harness-control-desktop.png", fullPage: false });
  const runId = new URL(page.url()).searchParams.get("run")!;
  await page.reload();
  await expect(controls.getByLabel("追加指令状态")).toContainText("已应用到角色", { timeout: 15_000 });
  const response = await request.get(`/api/runs/${runId}`);
  const snapshot = await response.json();
  expect(snapshot.question).toBe(question);
  expect(
    snapshot.recent_events.filter((event: { kind: string }) => event.kind === "harness.instruction_queued"),
  ).toHaveLength(1);
  expect(
    snapshot.recent_events.filter((event: { kind: string }) => event.kind === "harness.instruction_applied"),
  ).toHaveLength(1);
  expect(JSON.stringify(snapshot.recent_events)).not.toContain("请明确列出无法验证的假设。");
  await expect(page.getByTestId("run-status-badge")).toContainText("已完成", { timeout: 15_000 });
  expect(errors).toEqual([]);
});

test("stops a live deterministic run from a mobile viewport and keeps the stopped state after reload", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByPlaceholder("提出一个可以设计实验去检验的研究问题").fill("停止研究控制测试");
  await page.getByRole("button", { name: "开始研究" }).click();
  const controls = page.getByTestId("run-controls");
  await controls.getByRole("button", { name: "停止研究" }).click();
  await expect(controls.getByRole("status")).toContainText("已停止");
  await expect(page.getByTestId("run-status-badge")).toContainText("已停止");
  const runId = new URL(page.url()).searchParams.get("run")!;
  const snapshot = await (await request.get(`/api/runs/${runId}`)).json();
  expect(snapshot.status).toBe("failed");
  expect(snapshot.error_code).toBe("interrupted");
  expect(snapshot.attempts.every((attempt: { status: string }) => attempt.status !== "running")).toBe(true);
  expect(snapshot.final_artifact_id).toBeNull();
  await page.reload();
  await expect(controls.getByRole("status")).toContainText("已停止");
  await expect(page.getByTestId("run-status-badge")).toContainText("已停止");
  await expect(controls.getByRole("button", { name: "停止研究" })).toHaveCount(0);
  await page.screenshot({ path: "/private/tmp/luup-harness-control-mobile.png", fullPage: false });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
