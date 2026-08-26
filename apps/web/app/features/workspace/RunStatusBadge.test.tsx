import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { RunStatusBadge } from "./RunStatusBadge";

describe("RunStatusBadge", () => {
  test("终态展示已完成文案与 data-slot", () => {
    const { container } = render(<RunStatusBadge status="completed" />);
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(container.querySelector('[data-slot="badge"]')).toBeInTheDocument();
  });
});
