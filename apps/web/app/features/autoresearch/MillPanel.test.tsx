import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApiProvider } from "../../providers/api";
import { AstryxProvider } from "../../providers/astryx";
import { createApiClient } from "../../lib/api/client";
import type { MillSnapshot } from "../../lib/api/mill";
import { MillPanel } from "./MillPanel";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function renderMill(fetchImpl: typeof fetch, onPapersChange?: (titles: string[]) => void) {
  const client = createApiClient({ fetchImpl });
  return render(
    <AstryxProvider>
      <ApiProvider client={client}>
        <MillPanel onPapersChange={onPapersChange} />
      </ApiProvider>
    </AstryxProvider>,
  );
}

const idle: MillSnapshot = { status: "idle" };

const runningWithPaper: MillSnapshot = {
  status: "running",
  papers: [
    {
      id: "p1",
      ticketId: "t1",
      title: "Frontier paper",
      abstract: "a",
      bodyMarkdown: "# hi",
      evidenceIds: ["e1", "e2"],
      createdAt: "2026-01-01T00:00:00Z",
    },
  ],
  quantity: { targetPapers: 3, papersProduced: 1, ok: true },
  ticketsStarted: 2,
  maxTickets: 12,
};

describe("MillPanel", () => {
  it("渲染永动机启动控件", async () => {
    const fetchImpl = vi.fn(async () => json(idle)) as unknown as typeof fetch;
    renderMill(fetchImpl);
    expect(screen.getByRole("heading", { name: /Research Mill/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /启动永动机/ })).toBeTruthy();
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
  });

  it("poll status 展示 papers 并回调 onPapersChange", async () => {
    const onPapersChange = vi.fn();
    const fetchImpl = vi.fn(async () => json(runningWithPaper)) as unknown as typeof fetch;
    renderMill(fetchImpl, onPapersChange);

    expect(await screen.findByText("Frontier paper")).toBeInTheDocument();
    expect(screen.getByText(/产量 1 \/ 3/)).toBeInTheDocument();
    expect(screen.getByText(/gate ok/)).toBeInTheDocument();
    expect(screen.getByText(/Tickets 2 \/ 12/)).toBeInTheDocument();
    expect(screen.getByText(/p1 · 2 evidence/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /停止战役/ })).toBeInTheDocument();
    await waitFor(() => expect(onPapersChange).toHaveBeenCalledWith(["Frontier paper"]));
  });

  it("start 成功切到 running", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/start") && init?.method === "POST") {
        return json({ status: "running", ticketsStarted: 1, maxTickets: 12 });
      }
      if (String(url).endsWith("/stop")) return json({ status: "stopped" });
      return json(idle);
    }) as unknown as typeof fetch;
    renderMill(fetchImpl);

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /启动永动机/ }));
    expect(await screen.findByRole("button", { name: /停止战役/ })).toBeInTheDocument();
  });

  it("start 失败展示错误 Banner", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/start") && init?.method === "POST") {
        return json({ detail: "empty_topic" }, 422);
      }
      return json(idle);
    }) as unknown as typeof fetch;
    renderMill(fetchImpl);

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /启动永动机/ }));
    expect(await screen.findByText(/empty_topic/)).toBeInTheDocument();
  });

  it("stop 成功回到 stopped", async () => {
    let snap: MillSnapshot = runningWithPaper;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/stop") && init?.method === "POST") {
        snap = { status: "stopped" };
        return json(snap);
      }
      return json(snap);
    }) as unknown as typeof fetch;
    renderMill(fetchImpl);

    expect(await screen.findByRole("button", { name: /停止战役/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /停止战役/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /启动永动机/ })).toBeInTheDocument());
  });

  it("stop 失败展示错误", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/stop") && init?.method === "POST") {
        return json({ detail: "already_stopped" }, 409);
      }
      return json(runningWithPaper);
    }) as unknown as typeof fetch;
    renderMill(fetchImpl);

    expect(await screen.findByRole("button", { name: /停止战役/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /停止战役/ }));
    expect(await screen.findByText(/already_stopped/)).toBeInTheDocument();
  });

  it("poll 失败时保持 idle 不炸", async () => {
    const fetchImpl = vi.fn(async () => json({ detail: "down" }, 500)) as unknown as typeof fetch;
    renderMill(fetchImpl);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /启动永动机/ })).toBeInTheDocument();
  });

  it("可编辑 topic / seed 后启动", async () => {
    let startedBody: unknown;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/start") && init?.method === "POST") {
        startedBody = JSON.parse(typeof init.body === "string" ? init.body : "{}");
        return json({ status: "running", ticketsStarted: 1, maxTickets: 12 });
      }
      return json(idle);
    }) as unknown as typeof fetch;
    renderMill(fetchImpl);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText("Topic"), { target: { value: "pulsars" } });
    fireEvent.change(screen.getByLabelText("Seed question"), { target: { value: "q1" } });
    fireEvent.click(screen.getByRole("button", { name: /启动永动机/ }));
    expect(await screen.findByRole("button", { name: /停止战役/ })).toBeInTheDocument();
    expect(startedBody).toMatchObject({ topic: "pulsars", seedQuestions: ["q1"] });
  });
});
