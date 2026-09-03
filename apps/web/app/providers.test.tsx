import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { Providers } from "./providers";
import { useApiClient } from "./providers/api";
import { QueryProvider } from "./providers/query";

describe("providers", () => {
  test("Providers 组合 Query + Api，子组件可取到 client", () => {
    function Probe() {
      const client = useApiClient();
      return <span data-testid="ok">{typeof client.get === "function" ? "ready" : "bad"}</span>;
    }
    render(
      <Providers>
        <Probe />
      </Providers>,
    );
    expect(screen.getByTestId("ok")).toHaveTextContent("ready");
  });

  test("QueryProvider 可注入外部 client", () => {
    render(
      <QueryProvider>
        <span>child</span>
      </QueryProvider>,
    );
    expect(screen.getByText("child")).toBeInTheDocument();
  });
});
