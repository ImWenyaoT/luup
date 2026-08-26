import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { createApiClient } from "../../lib/api/client";
import type { Science125Data } from "../../lib/types/wire";
import { renderWithProviders } from "../../test-utils";
import { QuestionSidebar } from "./QuestionSidebar";

const mockData: Science125Data = {
  source: "fixture",
  retrievedAt: "2025-01-01",
  total: 3,
  domains: [
    {
      domain: "Physics",
      count: 2,
      questions: [
        { id: 1, domain: "Physics", question: "暗物质" },
        { id: 2, domain: "Physics", question: "量子引力" },
      ],
    },
    {
      domain: "Biology",
      count: 1,
      questions: [{ id: 10, domain: "Biology", question: "意识起源" }],
    },
  ],
};

function science125Response(): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => mockData,
  } as unknown as Response;
}

describe("QuestionSidebar", () => {
  test("域筛选只显示对应题目", async () => {
    const fetchImpl = vi.fn(async () => science125Response());
    const client = createApiClient({ fetchImpl });
    renderWithProviders(<QuestionSidebar onSelect={vi.fn()} />, { client });

    await waitFor(() => expect(screen.getByTestId("question-row-1")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("domain-filter"), { target: { value: "Biology" } });
    expect(screen.queryByTestId("question-row-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("question-row-10")).toBeInTheDocument();
  });

  test("搜索过滤题目", async () => {
    const fetchImpl = vi.fn(async () => science125Response());
    const client = createApiClient({ fetchImpl });
    renderWithProviders(<QuestionSidebar onSelect={vi.fn()} />, { client });

    await waitFor(() => expect(screen.getByTestId("question-row-1")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("question-search"), { target: { value: "意识" } });
    expect(screen.queryByTestId("question-row-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("question-row-10")).toBeInTheDocument();
  });

  test("点击行触发 onSelect", async () => {
    const onSelect = vi.fn();
    const fetchImpl = vi.fn(async () => science125Response());
    const client = createApiClient({ fetchImpl });
    renderWithProviders(<QuestionSidebar onSelect={onSelect} />, { client });

    await waitFor(() => expect(screen.getByTestId("question-row-2")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("question-row-2"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 2, question: "量子引力" }));
  });
});
