import { expect, test } from "@playwright/test";
import { MIN_RUNS, RUNS } from "./fixtures.ts";

/**
 * 交付要求里 API 与前端是同一份交付物。所以这里验的是「页面上看到的」与
 * 「curl 拿到的」是同一件事，以及一个无鉴权的本地工具在被乱打时不塌。
 */
test.describe("API 契约", () => {
  test("GET /api/runs 的条数与历史页的行数一致", async ({ page, request }) => {
    const res = await request.get("/api/runs?limit=500");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { active: string | null; runs: { id: string }[] };
    expect(body.runs.length).toBeGreaterThanOrEqual(MIN_RUNS);

    await page.goto("/runs");
    const rows = page.getByRole("row").filter({ has: page.getByRole("link") });
    await expect(rows).toHaveCount(body.runs.length);
  });

  test("GET /api/runs 的 limit 只收 1..500", async ({ request }) => {
    expect((await request.get("/api/runs?limit=0")).status()).toBe(400);
    expect((await request.get("/api/runs?limit=abc")).status()).toBe(400);
    expect((await request.get("/api/runs?limit=501")).status()).toBe(400);
  });

  test("POST /api/runs 不给 body 就不会起子进程", async ({ request }) => {
    const res = await request.post("/api/runs", { headers: { "content-type": "application/json" }, data: "" });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
    expect((await res.json()).code).toBe("bad_body");
  });

  test("POST /api/runs 挡住非 JSON 的跨站表单提交", async ({ request }) => {
    const res = await request.post("/api/runs", {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      data: "science125Id=61",
    });
    expect(res.status()).toBe(415);
  });

  test("POST /api/runs 的 question 与 science125Id 必须给且只给一个", async ({ request }) => {
    const both = await request.post("/api/runs", { data: { question: "为什么天是蓝的？", science125Id: 61 } });
    expect(both.status()).toBe(400);
    expect((await both.json()).code).toBe("bad_input");

    const neither = await request.post("/api/runs", { data: {} });
    expect(neither.status()).toBe(400);
  });

  test("?artifact= 取不到 run 目录以外的文件", async ({ request }) => {
    // 白名单是 readdir 的真实结果，不是正则放行——越界串永远命不中集合
    const escape = await request.get(`/api/runs/${RUNS.allPass}?artifact=../../package.json`);
    expect(escape.status()).toBe(404);
    expect((await escape.json()).code).toBe("artifact_not_found");
    expect(await escape.text()).not.toContain("devDependencies");

    // 越界形状的 run id 在进文件系统之前就被判死
    const badId = await request.get("/api/runs/..%2F..%2Fpackage.json");
    expect(badId.status()).toBe(400);
    expect((await badId.json()).code).toBe("bad_run_id");

    // console.log 可能带 QWEN_* 环境噪声，明确不在白名单里
    const denied = await request.get(`/api/runs/${RUNS.failed}?artifact=console.log`);
    expect(denied.status()).toBe(404);
  });

  test("?artifact= 取得到本 run 的工件原文", async ({ request }) => {
    const res = await request.get(`/api/runs/${RUNS.allPass}?artifact=proposal.md`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/plain");
    expect(await res.text()).toContain("Constraining Pulsar Formation Channels");
  });

  test("GET /api/science125 就是首页选题器的那份题库", async ({ page, request }) => {
    const body = (await request.get("/api/science125")).json() as Promise<{
      total: number;
      domains: { domain: string; count: number }[];
    }>;
    const { total, domains } = await body;
    expect(total).toBe(125);

    await page.goto("/");
    await expect(page.getByText(`${total} 题 / ${domains.length} 学科`, { exact: true })).toBeVisible();
  });
});
