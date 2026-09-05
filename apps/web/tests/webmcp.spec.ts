import { expect, test, type Page } from "@playwright/test";

// Native browser API only: missing/changed experimental support must fail this project.
type BrowserContext = {
  getTools: () => Promise<Array<{ name: string }>>;
  executeTool: (tool: { name: string }, args: string) => Promise<string>;
};

async function registeredTools(page: Page) {
  return page.evaluate(async () => {
    const context = (document as Document & { modelContext: BrowserContext }).modelContext;
    return (await context.getTools())
      .filter((tool) => tool.name.startsWith("luup_"))
      .map((tool) => tool.name)
      .sort();
  });
}

async function execute(page: Page, name: string, args: Record<string, unknown> = {}) {
  return page.evaluate(
    async ({ name, args }) => {
      const context = (document as Document & { modelContext: BrowserContext }).modelContext;
      const tool = (await context.getTools()).find((item) => item.name === `luup_${name}`);
      if (!tool) throw new Error(`Missing WebMCP tool: ${name}`);
      return JSON.parse(await context.executeTool(tool, JSON.stringify(args)));
    },
    { name, args },
  );
}

test("native WebMCP follows the visible run, panels and artifact selection", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") errors.push(message.text());
  });
  await page.goto("/");
  await expect(page).toHaveTitle(/Luup/i);
  await expect(page.getByTestId("welcome-panel")).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const context = (document as Document & { modelContext: BrowserContext }).modelContext;
        return (await context.getTools())
          .filter((tool) => tool.name.startsWith("luup_"))
          .map((tool) => tool.name)
          .sort();
      }),
    )
    .toEqual(["luup_get_ui_context", "luup_open_run", "luup_select_artifact", "luup_set_inspector"]);
  expect(await execute(page, "get_ui_context")).toMatchObject({ runId: null, inspector: null, artifacts: [] });

  await page.getByTestId("welcome-question-input").fill("WebMCP native UI verification");
  await page.getByTestId("start-research").click();
  await expect(page.getByTestId("run-workspace")).toBeVisible();
  await expect.poll(async () => (await execute(page, "get_ui_context")).run?.status).toBe("completed");
  const context = await execute(page, "get_ui_context");
  const runId = context.runId;
  const artifactId = context.artifacts.find((item: { type: string }) => item.type === "research-plan").id;
  await expect
    .poll(async () => (await execute(page, "get_ui_context")).runs.map((run: { id: string }) => run.id))
    .toContain(runId);

  await execute(page, "set_inspector", { kind: "process" });
  await expect(page.getByRole("heading", { name: "审计轨迹 · Audit / Trace" })).toBeVisible();
  await expect.poll(async () => (await execute(page, "get_ui_context")).inspector).toBe("process");
  await execute(page, "select_artifact", { artifactId });
  await expect(page.getByTestId("artifact-view")).toBeVisible();
  await expect.poll(async () => (await execute(page, "get_ui_context")).artifactLoading).toBe(false);
  expect(await execute(page, "get_ui_context")).toMatchObject({
    selectedArtifactId: artifactId,
    inspector: "artifacts",
    error: null,
  });

  await execute(page, "open_run", { runId: null });
  await expect(page).not.toHaveURL(/\?run=/);
  await expect(page.getByTestId("welcome-panel")).toBeVisible();
  await expect.poll(async () => (await execute(page, "get_ui_context")).runId).toBeNull();
  await execute(page, "open_run", { runId });
  await expect(page).toHaveURL(new RegExp(`run=${runId}`));
  await expect(page.getByTestId("run-workspace")).toBeVisible();
  await page.reload();
  await expect.poll(() => registeredTools(page)).toHaveLength(4);
  await expect.poll(async () => (await execute(page, "get_ui_context")).run?.id).toBe(runId);

  await page.setViewportSize({ width: 390, height: 844 });
  await execute(page, "set_inspector", { kind: "process" });
  await expect(page.getByTestId("workspace-inspector")).toBeVisible();
  await execute(page, "set_inspector", { kind: null });
  await expect(page.getByTestId("workspace-inspector")).not.toBeAttached();
  expect(errors).toEqual([]);
});

test("native WebMCP rejects invalid navigation without changing the UI", async ({ page }) => {
  // Chromium also reports exceptions from rejected tools as pageerror events.
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByTestId("welcome-panel")).toBeVisible();
  await expect.poll(() => registeredTools(page)).toHaveLength(4);
  await expect.poll(async () => (await execute(page, "get_ui_context")).runId).toBeNull();
  await expect(execute(page, "open_run", { runId: "unknown" })).rejects.toThrow();
  await expect(execute(page, "select_artifact", { artifactId: "foreign-artifact" })).rejects.toThrow();
  await expect(execute(page, "set_inspector", { kind: "process" })).rejects.toThrow();
  await expect(page.getByTestId("welcome-panel")).toBeVisible();
  await expect(page).not.toHaveURL(/\?run=/);
  expect(errors).toEqual([
    "Run must be an already open run ID or null.",
    "Artifact must belong to the current run or be null.",
    "Wait for a run to load first.",
  ]);
});
