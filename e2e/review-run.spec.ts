import { expect, test } from "@playwright/test";
import { RUNS, openTab, panel, tab } from "./fixtures.ts";

/**
 * 目标：评审用一页把一次 run 审完 —— 走到哪一步、批判说了什么、
 * 引用是不是真的、计划长什么样。每条断言对应审阅动线上的一问。
 */
test.describe(`审一次 run（${RUNS.allPass}）`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/runs/${RUNS.allPass}`);
  });

  test("reasoning spine 五个节点全部已产出", async ({ page }) => {
    const spine = page.getByRole("list", { name: "reasoning spine" });
    const steps = spine.getByRole("listitem");

    await expect(steps).toHaveCount(5);
    for (const label of ["文献", "假设", "批判", "计划", "验收"]) {
      await expect(steps.filter({ hasText: label })).toContainText("已产出");
    }
    // 走完 = 一个「待执行」都不剩
    await expect(spine.getByText("待执行")).toHaveCount(0);
  });

  test("critique 标签渲染结构化 JSON，逐假设的批判看得见", async ({ page }) => {
    const critique = await openTab(page, "critique");

    await expect(critique).toBeVisible();
    // critique.json 的顶层契约字段；缩进渲染而不是揉成一段
    await expect(critique).toContainText("assessments");
    await expect(critique).toContainText("hypothesisId");
    await expect(critique).toContainText("H1");
  });

  test("verification 标签逐项列出确定性验收，且全部通过", async ({ page }) => {
    const verification = await openTab(page, "verification");

    await expect(verification).toContainText("ALL PASS");
    await expect(verification).toContainText("无 LLM 参与");

    // 全绿的报告默认摊开：这时候证据本身就是结论，藏起来等于没给
    const passed = verification.getByText("✓", { exact: true });
    const failed = verification.getByText("✗", { exact: true });
    expect(await passed.count()).toBeGreaterThanOrEqual(20);
    await expect(failed).toHaveCount(0);

    // 引用真实性判据 B2/B4 是反查 arXiv 的那两组，必须逐条可见
    await expect(verification.getByText("B2.astro-ph/9911519")).toBeVisible();
    await expect(verification.getByText("B4.astro-ph/9911519")).toBeVisible();
  });

  test("papers 标签给出本次运行真的读过的论文账本", async ({ page }) => {
    const papers = await openTab(page, "papers");

    const rows = papers.locator("tbody tr");
    expect(await rows.count()).toBeGreaterThan(0);
    await expect(tab(page, "papers")).toContainText(`papers (${await rows.count()})`);
    // 每条都要能点回工件原文，否则这张表只是好看
    await expect(rows.first().getByRole("link")).toHaveAttribute("href", /artifact=memory%2Fpapers%2F/);

    // 过滤是这张表唯一的交互，过滤完还得剩下能对上的行
    await papers.getByPlaceholder("过滤").fill("2207.06311");
    await expect(rows).toHaveCount(1);
  });

  test("proposal 标签渲染研究计划正文，标题与页头一致", async ({ page }) => {
    const title =
      "Constraining Pulsar Formation Channels: A Two-Tier Framework Integrating Core-Collapse Supernova Rates with Binary Recycling Pathways";

    await expect(page.locator("header h2")).toHaveText(title);

    const proposal = panel(page, "proposal");
    await expect(proposal).toBeVisible(); // 有 proposal.md 时它就是默认标签
    await expect(proposal.getByRole("heading", { name: title })).toBeVisible();
    await expect(proposal).toContainText("待研究问题");
    await expect(proposal).toContainText("引用已经确定性反查 arXiv API 核验");
  });

  test("spine 上点一个节点，右边就切到它的工件", async ({ page }) => {
    await page.getByRole("link", { name: "跳到 文献 工件" }).click();

    await expect(panel(page, "evidence")).toBeVisible();
    await expect(panel(page, "proposal")).toBeHidden();
  });

  test("键盘可以在标签之间走，不用鼠标", async ({ page }) => {
    await tab(page, "evidence").focus();
    await page.keyboard.press("ArrowRight");

    await expect(tab(page, "hypotheses")).toBeFocused();
    await expect(panel(page, "hypotheses")).toBeVisible();
  });
});
