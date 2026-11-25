import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApiProvider } from "../../providers/api";
import { AstryxProvider } from "../../providers/astryx";
import { createApiClient } from "../../lib/api/client";
import { MillPanel } from "./MillPanel";

describe("MillPanel", () => {
  it("渲染永动机启动控件", () => {
    const fetchImpl = vi.fn(async () => Response.json({ status: "idle" })) as unknown as typeof fetch;
    const client = createApiClient({ fetchImpl });
    render(
      <AstryxProvider>
        <ApiProvider client={client}>
          <MillPanel />
        </ApiProvider>
      </AstryxProvider>,
    );
    expect(screen.getByRole("heading", { name: /Research Mill/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /启动永动机/ })).toBeTruthy();
  });
});
