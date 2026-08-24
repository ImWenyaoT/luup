import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { science125GlobalFilter, Sidebar } from "./sidebar";
import type { Science125Data, Science125Question } from "./types";

const mockScienceData: Science125Data = {
  source: "Science 125 Issues (2005)",
  retrievedAt: "2026-08-08T00:00:00Z",
  total: 2,
  domains: [
    {
      domain: "Physics & Astronomy",
      count: 1,
      questions: [
        {
          id: 61,
          domain: "Physics & Astronomy",
          question: "How are pulsars formed?",
        },
      ],
    },
    {
      domain: "Mathematical Sciences",
      count: 1,
      questions: [
        {
          id: 2,
          domain: "Mathematical Sciences",
          question: "Is the Riemann hypothesis true?",
        },
      ],
    },
  ],
};

describe("Sidebar component rendering", () => {
  test("renders sidebar with questions and domain translations", () => {
    const html = renderToStaticMarkup(
      <Sidebar
        scienceData={mockScienceData}
        selectedQuestion={null}
        onSelectQuestion={vi.fn()}
        onDirectRun={vi.fn()}
        onNewResearch={vi.fn()}
      />,
    );

    expect(html).toContain("Science 125 题库");
    expect(html).toContain("How are pulsars formed?");
    expect(html).toContain("Is the Riemann hypothesis true?");
    expect(html).toContain("物理与天文");
    expect(html).toContain("数学科学");
    expect(html).toContain("#61");
    expect(html).toContain("#2");
  });

  test("highlights currently selected question", () => {
    const selected: Science125Question = {
      id: 61,
      domain: "Physics & Astronomy",
      question: "How are pulsars formed?",
    };

    const html = renderToStaticMarkup(
      <Sidebar
        scienceData={mockScienceData}
        selectedQuestion={selected}
        onSelectQuestion={vi.fn()}
        onDirectRun={vi.fn()}
        onNewResearch={vi.fn()}
      />,
    );

    expect(html).toContain("bg-primary/10");
  });

  test("renders empty placeholder when scienceData is null", () => {
    const html = renderToStaticMarkup(
      <Sidebar
        scienceData={null}
        selectedQuestion={null}
        onSelectQuestion={vi.fn()}
        onDirectRun={vi.fn()}
        onNewResearch={vi.fn()}
      />,
    );

    expect(html).toContain("载入中…");
  });
});

describe("science125GlobalFilter function", () => {
  const q61: Science125Question = {
    id: 61,
    domain: "Physics & Astronomy",
    question: "How are pulsars formed?",
  };

  const createMockRow = (original: Science125Question) => ({ original }) as any;

  const testFilter = (row: any, val: string) => science125GlobalFilter(row, "question", val, () => {});

  test("matches exact ID with # or without #", () => {
    const row = createMockRow(q61);
    expect(testFilter(row, "#61")).toBe(true);
    expect(testFilter(row, "61")).toBe(true);
    expect(testFilter(row, "62")).toBe(false);
  });

  test("matches question text substring case-insensitively", () => {
    const row = createMockRow(q61);
    expect(testFilter(row, "pulsar")).toBe(true);
    expect(testFilter(row, "PULSAR")).toBe(true);
    expect(testFilter(row, "quantum")).toBe(false);
  });

  test("matches Chinese domain translation", () => {
    const row = createMockRow(q61);
    expect(testFilter(row, "物理")).toBe(true);
    expect(testFilter(row, "天文")).toBe(true);
    expect(testFilter(row, "化学")).toBe(false);
  });

  test("returns true for empty filter string", () => {
    const row = createMockRow(q61);
    expect(testFilter(row, "")).toBe(true);
    expect(testFilter(row, "   ")).toBe(true);
  });
});
