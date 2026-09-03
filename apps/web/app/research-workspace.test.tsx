import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { createApiClient } from "./lib/api/client";
import { RUN_WORKING_SET_KEY } from "./hooks/useRunWorkingSet";
import type { Artifact, Snapshot } from "./lib/types/wire";
import { createTestWrapper } from "./test-utils";
import Home from "./research-workspace";

const completedSnapshot: Snapshot = {
  id: "run-1",
  question: "first question",
  status: "completed",
  current_role: null,
  version: 1,
  error_code: null,
  final_artifact_id: "art-1",
  attempts: [],
  subagents: [],
  tool_evidence: [],
  omitted_evidence_count: 0,
  omitted_evidence_tools: [],
  artifacts: [{ id: "art-1", type: "research-plan" }],
  recent_events: [],
};

const nextSnapshot: Snapshot = {
  ...completedSnapshot,
  id: "run-2",
  question: "第二个研究问题",
};

const artifact: Artifact = {
  id: "art-1",
  type: "research-plan",
  content: {
    artifact_type: "research-plan",
    problem_statement: "p",
    rationale: "r",
    technical_details: "t",
    datasets: [],
    source: "s",
    target: "t",
    execution_plan: {
      predictions: [],
      data_requirements: [],
      steps: [],
      analysis: [],
      result_interpretations: [],
      stop_conditions: [],
      rollback_conditions: [],
      supplement_evidence_conditions: [],
    },
    paper_title: "title",
    paper_abstract: "abstract",
    methods: "m",
    experiments: { baselines: [], metrics: [], design: "d" },
    results: {
      status: "pending_verification",
      validation_basis: "formula_derivation",
      feasibility_argument: "f",
      expected_outcomes: [],
    },
    references: [],
  },
};

function respond(status: number, body: unknown, ok = status < 400): Response {
  return {
    ok,
    status,
    statusText: `HTTP-${status}`,
    json: async () => body,
  } as unknown as Response;
}

describe("Home sticky artifact errors", () => {
  test("旧 artifact 失败会短暂显示，且不会挂到新 run", async () => {
    let artifactCalls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/runs/run-1")) return respond(200, completedSnapshot);
      if (url.includes("/api/runs/run-2")) return respond(200, nextSnapshot);
      if (url.endsWith("/api/artifacts/art-1")) {
        artifactCalls += 1;
        if (artifactCalls === 1) {
          await new Promise((done) => setTimeout(done, 50));
          return respond(500, { detail: "旧 Artifact 失败" });
        }
        return respond(200, artifact);
      }
      if (url.endsWith("/api/runs") && init?.method === "POST") {
        await new Promise((done) => setTimeout(done, 100));
        return respond(200, nextSnapshot);
      }
      return respond(404, { detail: "not found" });
    }) as typeof fetch;

    const client = createApiClient({ fetchImpl });

    render(<Home />, {
      wrapper: createTestWrapper({ client, initialEntries: ["/?run=run-1"] }),
    });

    await screen.findAllByText("first question");
    fireEvent.click(screen.getByRole("button", { name: "查看冻结产物" }));
    fireEvent.click(screen.getByRole("button", { name: "research-plan" }));
    await waitFor(() => expect(screen.getByTestId("artifact-loading")).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByTestId("artifact-loading")).not.toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("提出一个可以设计实验去检验的研究问题"), {
      target: { value: "第二个研究问题" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始研究" }));

    await waitFor(() => expect(screen.getByText("旧 Artifact 失败")).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText("旧 Artifact 失败")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByText("第二个研究问题").length).toBeGreaterThan(0));
  });

  test("在两个已打开 Run 间切换会清理产物选择并隔离旧错误", async () => {
    const storage = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
    window.localStorage.setItem(
      RUN_WORKING_SET_KEY,
      JSON.stringify([
        { id: "run-1", label: "first question" },
        { id: "run-2", label: "第二个研究问题" },
      ]),
    );
    const runTwoSnapshot: Snapshot = {
      ...nextSnapshot,
      final_artifact_id: "art-2",
      artifacts: [{ id: "art-2", type: "research-plan" }],
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/runs/run-1")) return respond(200, completedSnapshot);
      if (url.includes("/api/runs/run-2")) return respond(200, runTwoSnapshot);
      if (url.endsWith("/api/artifacts/art-1")) {
        await new Promise((done) => setTimeout(done, 50));
        return respond(500, { detail: "旧 Artifact 失败" });
      }
      return respond(404, { detail: "not found" });
    }) as typeof fetch;

    render(<Home />, {
      wrapper: createTestWrapper({ client: createApiClient({ fetchImpl }), initialEntries: ["/?run=run-1"] }),
    });

    await screen.findAllByText("first question");
    fireEvent.click(screen.getByRole("button", { name: "查看冻结产物" }));
    fireEvent.click(screen.getByRole("button", { name: "research-plan" }));
    await screen.findByTestId("artifact-loading");
    fireEvent.click(screen.getByRole("tab", { name: "第二个研究问题" }));

    await waitFor(() => expect(screen.getAllByText("第二个研究问题").length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryByTestId("workspace-inspector")).not.toBeInTheDocument());
    await new Promise((done) => setTimeout(done, 70));
    expect(screen.queryByText("旧 Artifact 失败")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看冻结产物" }));
    expect(screen.getByText("点击上方按钮查看详细科学假设或研究计划")).toBeInTheDocument();
    window.localStorage.removeItem(RUN_WORKING_SET_KEY);
  });

  test("选择当前 Run 或关闭非 active tab 不重置当前产物状态", async () => {
    const storage = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
    window.localStorage.setItem(
      RUN_WORKING_SET_KEY,
      JSON.stringify([
        { id: "run-1", label: "first question" },
        { id: "run-2", label: "第二个研究问题" },
      ]),
    );
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/runs/run-1")) return respond(200, completedSnapshot);
      if (url.endsWith("/api/artifacts/art-1")) return respond(200, artifact);
      return respond(404, { detail: "not found" });
    }) as typeof fetch;

    render(<Home />, {
      wrapper: createTestWrapper({ client: createApiClient({ fetchImpl }), initialEntries: ["/?run=run-1"] }),
    });

    await screen.findAllByText("first question");
    fireEvent.click(screen.getByRole("button", { name: "查看冻结产物" }));
    fireEvent.click(screen.getByRole("button", { name: "research-plan" }));
    await screen.findByTestId("artifact-view");

    fireEvent.click(screen.getByRole("tab", { name: "first question" }));
    expect(screen.getByTestId("artifact-view")).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("project-sidebar")).getByTitle("first question"));
    expect(screen.getByTestId("artifact-view")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("close-run-run-2"));
    expect(screen.queryByRole("tab", { name: "第二个研究问题" })).not.toBeInTheDocument();
    expect(screen.getByTestId("artifact-view")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-inspector")).toBeInTheDocument();
    window.localStorage.removeItem(RUN_WORKING_SET_KEY);
  });
});

const science125 = {
  source: "fixture",
  retrievedAt: "2025-01-01",
  total: 1,
  domains: [
    {
      domain: "Physics",
      count: 1,
      questions: [{ id: 1, domain: "Physics", question: "暗物质是什么？" }],
    },
  ],
};

describe("Home shell flows", () => {
  test("无 run 时展示 Welcome，创建失败可关闭横幅", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/science125")) return respond(200, science125);
      if (url.endsWith("/api/runs") && init?.method === "POST") {
        return respond(500, { detail: "创建失败" });
      }
      return respond(404, { detail: "not found" });
    }) as typeof fetch;

    render(<Home />, {
      wrapper: createTestWrapper({ client: createApiClient({ fetchImpl }), initialEntries: ["/"] }),
    });

    expect(await screen.findByTestId("welcome-panel")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("welcome-question-input"), {
      target: { value: "会失败的问题" },
    });
    fireEvent.click(screen.getByTestId("start-research"));
    expect(await screen.findByTestId("error-banner")).toHaveTextContent("创建失败");
    fireEvent.click(within(screen.getByTestId("error-banner")).getByRole("button", { name: "关闭" }));
    expect(screen.queryByTestId("error-banner")).not.toBeInTheDocument();
  });

  test("加载中与硬失败分别展示 loading / run-error", async () => {
    let release!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/science125")) return respond(200, science125);
      if (url.includes("/api/runs/missing")) return pending;
      return respond(404, { detail: "not found" });
    }) as typeof fetch;

    render(<Home />, {
      wrapper: createTestWrapper({
        client: createApiClient({ fetchImpl }),
        initialEntries: ["/?run=missing"],
      }),
    });

    expect(await screen.findByTestId("run-loading")).toBeInTheDocument();
    release(respond(404, { detail: "run gone" }));
    expect(await screen.findByTestId("run-error")).toHaveTextContent("run gone");
  });

  test("宽屏自动打开 artifacts inspector；新研究回到 Welcome", async () => {
    const original = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: query.includes("min-width: 1200px"),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onchange: null,
      })),
    });

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/science125")) return respond(200, science125);
      if (url.includes("/api/runs/run-1")) return respond(200, completedSnapshot);
      return respond(404, { detail: "not found" });
    }) as typeof fetch;

    render(<Home />, {
      wrapper: createTestWrapper({
        client: createApiClient({ fetchImpl }),
        initialEntries: ["/?run=run-1"],
      }),
    });

    await screen.findAllByText("first question");
    expect(await screen.findByTestId("workspace-inspector")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "＋ 新研究" }));
    expect(await screen.findByTestId("welcome-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-inspector")).not.toBeInTheDocument();

    Object.defineProperty(window, "matchMedia", { configurable: true, value: original });
  });

  test("题库开跑创建 run；持久化错误横幅可关闭", async () => {
    const storage = new Map<string, string>();
    storage.set(RUN_WORKING_SET_KEY, "{}");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/science125")) return respond(200, science125);
      if (url.endsWith("/api/runs") && init?.method === "POST") return respond(200, nextSnapshot);
      if (url.includes("/api/runs/run-2")) return respond(200, nextSnapshot);
      return respond(404, { detail: "not found" });
    }) as typeof fetch;

    render(<Home />, {
      wrapper: createTestWrapper({ client: createApiClient({ fetchImpl }), initialEntries: ["/"] }),
    });

    expect(await screen.findByTestId("error-banner")).toHaveTextContent("无法恢复运行标签");
    fireEvent.click(within(screen.getByTestId("error-banner")).getByRole("button", { name: "关闭" }));
    expect(screen.queryByTestId("error-banner")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Science 125 题库/ }));
    const start = await screen.findByRole("button", { name: "开跑 →" });
    fireEvent.click(start);
    await waitFor(() => expect(screen.getAllByText("第二个研究问题").length).toBeGreaterThan(0));
    window.localStorage.removeItem(RUN_WORKING_SET_KEY);
  });

  test("refetch 失败保留 lastSnapshot 时可关闭错误横幅", async () => {
    const running: Snapshot = {
      ...completedSnapshot,
      status: "running",
      current_role: "researcher",
    };
    let runCalls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/science125")) return respond(200, science125);
      if (url.includes("/api/runs/run-1") && !url.includes("/events")) {
        runCalls += 1;
        if (runCalls === 1) return respond(200, running);
        return respond(404, { detail: "refetch failed" });
      }
      return respond(404, { detail: "not found" });
    }) as typeof fetch;

    class FakeEventSource {
      listeners = new Map<string, Array<(event: Event) => void>>();
      constructor(_url: string) {
        queueMicrotask(() => {
          for (const listener of this.listeners.get("error") ?? []) {
            listener(new Event("error"));
          }
        });
      }
      addEventListener(type: string, listener: (event: Event) => void) {
        const bucket = this.listeners.get(type) ?? [];
        bucket.push(listener);
        this.listeners.set(type, bucket);
      }
      close() {}
    }
    const previous = globalThis.EventSource;
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;

    try {
      render(<Home />, {
        wrapper: createTestWrapper({
          client: createApiClient({ fetchImpl }),
          initialEntries: ["/?run=run-1"],
        }),
      });

      await screen.findAllByText("first question");
      expect(await screen.findByTestId("error-banner")).toHaveTextContent("refetch failed");
      fireEvent.click(within(screen.getByTestId("error-banner")).getByRole("button", { name: "关闭" }));
      expect(screen.queryByTestId("error-banner")).not.toBeInTheDocument();
      expect(screen.getByTestId("run-header")).toBeInTheDocument();
    } finally {
      globalThis.EventSource = previous;
    }
  });
});
