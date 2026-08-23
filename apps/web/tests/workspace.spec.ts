import { expect, test } from "@playwright/test";

test("completes a deterministic research run through the server", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Luup" })).toBeVisible();

  // 设置面：环境变量是默认，页面可补配；保存立即反映在状态行，key 永不回显。
  await expect(page.getByText(/凭据：/)).toBeVisible();
  await page.getByText("设置", { exact: true }).click();
  await page.getByPlaceholder(/模型 id/).fill("qwen-e2e");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("已保存，下一次运行即生效。")).toBeVisible();
  await expect(page.getByText("qwen-e2e")).toBeVisible();
  await page.getByRole("button", { name: "关闭" }).click();

  await page.getByPlaceholder("提出一个可以设计实验去检验的研究问题").fill("冻结证据能降低科研 Agent 的无来源引用吗？");
  await page.getByRole("button", { name: "开始研究" }).click();

  const completedBadge = page
    .locator('[data-slot="badge"]')
    .filter({ hasText: /^已完成$/ })
    .first();
  await expect(completedBadge).toBeVisible();
  await expect(page.getByText("执行轨迹 · 2 次检索")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Subagents · 5" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "审计轨迹 · Audit / Trace" })).toBeVisible();
  await expect(page.getByText("暂无公开 trace · 状态未知")).toBeVisible();
  await expect(page.getByText("控制面")).toBeVisible();
  await expect(page.getByText("one-shot")).toHaveCount(5);
  await expect(page.getByText("counterevidence and methodological risks")).toBeVisible();
  await expect(page.getByText("arxiv:2309.15217v2")).toHaveCount(2);

  const stages = page
    .getByRole("heading", { name: /执行轨迹/ })
    .locator("..")
    .locator("..")
    .getByRole("listitem");
  await expect(stages).toHaveCount(5);

  // 折叠是降采样：摘要行保留计数；展开后引用完整回来。
  const researcherStage = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: /检索证据/ }) });
  await page.getByRole("button", { name: /检索证据/ }).click();
  await expect(researcherStage.getByText(/… 1 次检索 · \d+ 条引用/)).toBeVisible();
  await expect(researcherStage.getByText("arxiv:2309.15217v2")).not.toBeVisible();
  await page.getByRole("button", { name: /检索证据/ }).click();
  await expect(researcherStage.getByText("arxiv:2309.15217v2")).toBeVisible();

  // 未执行过的角色段是禁用态，点不动也不该抛错。
  await expect(page.getByRole("button", { name: "全部折叠" })).toBeVisible();

  await expect(page.getByText("冻结产物")).toBeVisible();
  await expect(page).toHaveURL(/\?run=[a-z0-9]+$/);

  // Run 已持久化；刷新后要从 URL 恢复，而不是变成无法进入的后台任务。
  // 连续四次失败会跨过第一轮快速重试；页面仍应在稍后的恢复轮自动回来。
  await page.route(
    "**/api/runs/*",
    (route) =>
      route.fulfill({
        status: 503,
        json: { detail: "临时不可用" },
      }),
    { times: 4 },
  );
  await page.reload();
  await expect(page.getByText("临时不可用")).toBeVisible();
  await expect(completedBadge).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("临时不可用")).not.toBeVisible();
  await expect(page.getByText("执行轨迹 · 2 次检索")).toBeVisible();
  await expect(page.getByText(/^version:/)).not.toBeVisible();
  await page.getByText("技术详情").first().click();
  await expect(page.getByText(/^version:/)).toBeVisible();

  // 新建失败不能把当前 Run 从 UI 状态中切断。
  await page.getByPlaceholder("提出一个可以设计实验去检验的研究问题").fill("问".repeat(4_001));
  await page.getByRole("button", { name: "开始研究" }).click();
  await expect(page.getByText("question 不能超过 4000 个字符。")).toBeVisible();
  await expect(completedBadge).toBeVisible();
  await expect(page.getByText("执行轨迹 · 2 次检索")).toBeVisible();

  // 旧 Artifact 先失败、新 Run 后成功时，旧错误不能挂到新 Run 下。
  await page.route(
    "**/api/artifacts/*",
    async (route) => {
      await new Promise((done) => setTimeout(done, 50));
      await route.fulfill({ status: 500, json: { detail: "旧 Artifact 失败" } });
    },
    { times: 1 },
  );
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    window.fetch = (async (...args: Parameters<typeof originalFetch>) => {
      const response = await originalFetch(...args);
      const url = typeof args[0] === "string" ? args[0] : args[0] instanceof URL ? args[0].href : args[0].url;
      if (url === "/api/runs" && args[1]?.method === "POST") {
        await new Promise((done) => setTimeout(done, 100));
      }
      return response;
    }) as unknown as typeof window.fetch;
  });
  await page.getByRole("button", { name: "research-plan", exact: true }).click();
  await page.getByPlaceholder("提出一个可以设计实验去检验的研究问题").fill("第二个研究问题");
  await page.getByRole("button", { name: "开始研究" }).click();
  await expect(page.getByText("旧 Artifact 失败")).toBeVisible();
  await expect(page.getByText("旧 Artifact 失败")).not.toBeVisible();
  await expect(completedBadge).toBeVisible();

  await page.getByRole("button", { name: "research-plan", exact: true }).click();
  for (const value of [
    "测量科研 Agent 的无来源引用率。",
    "冻结证据使引用可靠性可被检验。",
    "先冻结证据，再逐条核验引用是否落在冻结集合内。",
    "preregistered question set",
    "Frozen Research Artifacts",
    "降低无来源引用率并保持任务完成率。",
    "可审计证据门对科研 Agent 引用可靠性的影响",
    "本研究通过配对对照实验检验冻结证据 ID 对无来源引用率的影响。",
    "固定问题集与模型，做配对盲评。",
    "同一问题集下对比三组，报告置信区间。",
    "formula_derivation",
    "令证据门组与基线组的无来源引用率分别为 r_gate 与 r_base；若预期 r_gate < r_base，且任务完成率差异处于预设容许范围内，则可用同一验收规则判定设计可行。这里只是公式与逻辑推导，不代表实验已执行。",
    "逐题比例差值预期低于基线组，并报告区间。",
  ]) {
    await expect(page.getByText(value)).toBeVisible();
  }

  let missingRunRequests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/runs/deadbeef")) missingRunRequests += 1;
  });
  await page.goto("/?run=deadbeef");
  await expect(page.getByText("Run 不存在。")).toBeVisible();
  await page.waitForTimeout(5_500);
  expect(missingRunRequests).toBe(1);

  await page.getByPlaceholder("提出一个可以设计实验去检验的研究问题").fill("从无效深链重新开始");
  await page.getByRole("button", { name: "开始研究" }).click();
  await expect(page.getByText("Run 不存在。")).not.toBeVisible();
  await expect(completedBadge).toBeVisible();
});

test("selects Science 125 benchmark preset question and triggers direct run", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("Science 125 题库选题")).toBeVisible();
  await expect(page.getByText("125 题已冻结")).toBeVisible();

  // 左侧边栏搜索 #61
  const searchInput = page.getByPlaceholder("搜索题号 (如 #61) 或中英文关键词…");
  await expect(searchInput).toBeVisible();
  await searchInput.fill("61");
  await expect(page.getByRole("complementary").getByText("#61")).toBeVisible();

  // 点击侧边栏筛选出的题目直接开跑
  const runButtons = page.getByRole("complementary").getByRole("button", { name: "开跑 →" });
  await expect(runButtons.first()).toBeVisible();
  await runButtons.first().click();

  const completedBadge = page
    .locator('[data-slot="badge"]')
    .filter({ hasText: /^已完成$/ })
    .first();
  await expect(completedBadge).toBeVisible();
  await expect(page.getByText("冻结产物")).toBeVisible();
});
