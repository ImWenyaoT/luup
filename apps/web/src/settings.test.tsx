import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { Settings } from "./settings";
import type { ConfigStatus } from "./api";

const mockStatus: ConfigStatus = {
  model_id: "qwen3-max",
  base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  credential: "environment",
  runtime: "live",
};

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient();
  return renderToStaticMarkup(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

test("renders settings trigger button with dialog aria attributes", () => {
  const html = renderWithClient(<Settings initialStatus={mockStatus} defaultOpen={false} />);
  expect(html).toContain('aria-haspopup="dialog"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain('aria-label="系统与模型设置"');
  expect(html).toContain("凭据：已从环境变量读取");
  expect(html).not.toContain('role="dialog"');
});

test("renders modal dialog with accessible attributes, labeled form inputs, and close button label", () => {
  const html = renderWithClient(<Settings initialStatus={mockStatus} defaultOpen={true} />);
  expect(html).toContain('role="dialog"');
  expect(html).toContain('aria-modal="true"');
  expect(html).toContain('aria-labelledby="settings-dialog-title"');
  expect(html).toContain('id="settings-dialog-title"');
  expect(html).toContain('aria-label="关闭设置"');
  expect(html).toContain('for="setting-api-key"');
  expect(html).toContain('id="setting-api-key"');
  expect(html).toContain('for="setting-model-id"');
  expect(html).toContain('id="setting-model-id"');
  expect(html).toContain('for="setting-base-url"');
  expect(html).toContain('id="setting-base-url"');
});
