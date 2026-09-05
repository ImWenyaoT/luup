import { StrictMode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useWebMCP, type WebMCPTool, type WorkspaceContext } from "./useWebMCP";

const state = (): WorkspaceContext => ({
  runId: null,
  status: "idle",
  runs: [{ id: "run-1", label: "first" }],
  inspector: null,
  selectedArtifactId: null,
  artifactLoading: false,
  error: null,
  navigateToRun: vi.fn(),
  setInspector: vi.fn(),
  selectArtifact: vi.fn(),
});

function registry() {
  const registered = new Map<string, WebMCPTool>();
  const registerTool = vi.fn(async (tool: WebMCPTool, { signal }: { signal: AbortSignal }) => {
    signal.throwIfAborted();
    if (registered.has(tool.name)) throw new Error("Duplicate tool");
    registered.set(tool.name, tool);
    signal.addEventListener("abort", () => registered.delete(tool.name), { once: true });
  });
  Object.defineProperty(document, "modelContext", { configurable: true, value: { registerTool } });
  const execute = (name: string, args: unknown = {}, signal = new AbortController().signal) =>
    registered.get(`luup_${name}`)!.execute(args, { signal });
  return { registered, registerTool, execute };
}

afterEach(() => {
  Reflect.deleteProperty(document, "modelContext");
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("WebMCP workspace tools", () => {
  test("default off, unsupported browser and disabling all preserve the workspace", async () => {
    vi.stubEnv("NEXT_PUBLIC_LUUP_WEBMCP", "0");
    const api = registry();
    const defaults = renderHook(() => useWebMCP(state()));
    expect(api.registerTool).not.toHaveBeenCalled();
    defaults.unmount();
    Reflect.deleteProperty(document, "modelContext");
    const unsupported = renderHook(() => useWebMCP(state(), true));
    unsupported.unmount();
    const supported = registry();
    const hook = renderHook(({ enabled }) => useWebMCP(state(), enabled), { initialProps: { enabled: true } });
    await waitFor(() => expect(supported.registered.size).toBe(4));
    hook.rerender({ enabled: false });
    expect(supported.registered.size).toBe(0);
  });

  test("StrictMode and rerenders keep one registration and read committed state", async () => {
    const api = registry();
    const initial = state();
    const { rerender, unmount } = renderHook((value) => useWebMCP(value, true), {
      initialProps: initial,
      wrapper: StrictMode,
    });
    await waitFor(() => expect(api.registered.size).toBe(4));
    expect(JSON.parse(await api.registered.get("luup_get_ui_context")!.execute({}))).toMatchObject({ runId: null });
    const registrations = api.registerTool.mock.calls.length;
    const updated = { ...initial, runId: "run-1", status: "loading", error: "temporary" };
    rerender(updated);
    expect(JSON.parse(await api.execute("get_ui_context"))).toMatchObject({
      runId: "run-1",
      status: "loading",
      error: "temporary",
    });
    expect(api.registerTool).toHaveBeenCalledTimes(registrations);
    const stale = api.registered.get("luup_open_run")!;
    unmount();
    expect(api.registered.size).toBe(0);
    await expect(stale.execute({ runId: null }, { signal: new AbortController().signal })).rejects.toThrow();
  });

  test("valid navigation uses UI callbacks; invalid and cancelled calls do not", async () => {
    const api = registry();
    const value = state();
    renderHook(() => useWebMCP(value, true));
    await waitFor(() => expect(api.registered.size).toBe(4));
    await api.execute("open_run", { runId: "run-1" });
    await api.execute("open_run", { runId: null });
    expect(value.navigateToRun).toHaveBeenNthCalledWith(1, "run-1");
    expect(value.navigateToRun).toHaveBeenNthCalledWith(2, null);
    for (const args of [
      null,
      [],
      "run-1",
      {},
      { runId: "unknown" },
      { runId: "x".repeat(201) },
      { runId: null, extra: 1 },
    ]) {
      await expect(api.execute("open_run", args)).rejects.toThrow();
    }
    const cancelled = AbortSignal.abort();
    await expect(api.execute("open_run", { runId: "run-1" }, cancelled)).rejects.toThrow();
    expect(value.navigateToRun).toHaveBeenCalledTimes(2);
    await expect(api.execute("set_inspector", { kind: "process" })).rejects.toThrow("load first");
    await expect(api.execute("set_inspector", { kind: "unknown" })).rejects.toThrow("Invalid");
    await expect(api.execute("select_artifact", { artifactId: "foreign" })).rejects.toThrow("current run");
    await api.execute("set_inspector", { kind: null });
    await api.execute("select_artifact", { artifactId: null });
    expect(value.setInspector).toHaveBeenCalledExactlyOnceWith(null);
    expect(value.selectArtifact).toHaveBeenCalledExactlyOnceWith(null);
  });

  test("artifact ownership follows the active run and output stays bounded", async () => {
    const api = registry();
    const value: WorkspaceContext = {
      ...state(),
      runId: "run-1",
      status: "ready",
      runs: Array.from({ length: 101 }, (_, index) => ({ id: String(index), label: "x".repeat(201) })),
      snapshot: {
        id: "run-1",
        question: "q".repeat(4001),
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
        recent_events: [],
        artifacts: [{ id: "art-1", type: "research-plan" }],
      },
    };
    const { rerender } = renderHook((input) => useWebMCP(input, true), { initialProps: value });
    await waitFor(() => expect(api.registered.size).toBe(4));
    const context = JSON.parse(await api.execute("get_ui_context"));
    expect(context.runs).toHaveLength(100);
    expect(context.omittedRuns).toBe(1);
    expect(context.runs[0].label).toHaveLength(200);
    expect(context.run.question).toHaveLength(4000);
    await api.execute("select_artifact", { artifactId: "art-1" });
    expect(value.selectArtifact).toHaveBeenCalledExactlyOnceWith("art-1");
    expect(value.setInspector).toHaveBeenCalledWith("artifacts");
    await api.execute("set_inspector", { kind: "process" });
    expect(value.setInspector).toHaveBeenCalledWith("process");
    rerender({ ...value, snapshot: undefined, runId: "run-2" });
    await expect(api.execute("select_artifact", { artifactId: "art-1" })).rejects.toThrow();
    for (const artifactId of [undefined, 123, "x".repeat(201)]) {
      await expect(api.execute("select_artifact", { artifactId })).rejects.toThrow();
    }
  });

  test("partial registration failure rolls back and reports once", async () => {
    const api = registry();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    api.registerTool
      .mockImplementationOnce(async (tool, { signal }) => {
        api.registered.set(tool.name, tool);
        signal.addEventListener("abort", () => api.registered.delete(tool.name));
      })
      .mockRejectedValueOnce(new Error("registration denied"));
    renderHook(() => useWebMCP(state(), true));
    await waitFor(() => expect(warning).toHaveBeenCalledTimes(1));
    expect(api.registered.size).toBe(0);
  });

  test("unmount during asynchronous registration aborts the rest", async () => {
    const api = registry();
    let finish!: () => void;
    api.registerTool.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { unmount } = renderHook(() => useWebMCP(state(), true));
    const signal = api.registerTool.mock.calls[0][1].signal;
    unmount();
    await act(async () => finish());
    expect(signal.aborted).toBe(true);
    expect(api.registerTool).toHaveBeenCalledTimes(1);
  });
});
