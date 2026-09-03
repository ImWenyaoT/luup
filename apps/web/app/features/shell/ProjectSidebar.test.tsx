import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { renderWithProviders } from "../../test-utils";
import { ProjectSidebar } from "./ProjectSidebar";

describe("ProjectSidebar", () => {
  test("展开 Runs、选择 run、新研究与折叠", () => {
    const onSelectRun = vi.fn();
    const onNewResearch = vi.fn();
    const onCollapse = vi.fn();

    renderWithProviders(
      <ProjectSidebar
        activeRunId="run-1"
        runs={[
          { id: "run-1", label: "问题一" },
          { id: "run-2", label: "问题二" },
        ]}
        onSelectRun={onSelectRun}
        questionBank={<div data-testid="bank">题库</div>}
        onNewResearch={onNewResearch}
        settings={<button type="button">设置</button>}
        onCollapse={onCollapse}
        collapseLabel="折叠侧栏"
        mobile={false}
      />,
    );

    expect(screen.getByTestId("project-sidebar")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /问题二/ }));
    expect(onSelectRun).toHaveBeenCalledWith("run-2");

    fireEvent.click(screen.getByRole("button", { name: /新研究/ }));
    expect(onNewResearch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("toggle-sidebar"));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  test("搜索题库打开面板，关闭后收起；空 Runs 显示提示", () => {
    renderWithProviders(
      <ProjectSidebar
        activeRunId={null}
        runs={[]}
        onSelectRun={vi.fn()}
        questionBank={<div>题库内容</div>}
        settings={null}
        onCollapse={vi.fn()}
        collapseLabel="折叠"
        mobile
      />,
    );

    expect(screen.getByText(/本机尚未打开 Run/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /搜索题库/ }));
    expect(screen.getByRole("dialog", { name: "Science 125 题库" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭题库" }));
    expect(screen.queryByRole("dialog", { name: "Science 125 题库" })).not.toBeInTheDocument();
  });

  test("折叠 Science 125 项目节点隐藏子树", () => {
    renderWithProviders(
      <ProjectSidebar
        activeRunId={null}
        runs={[]}
        onSelectRun={vi.fn()}
        questionBank={<div />}
        settings={null}
        onCollapse={vi.fn()}
        collapseLabel="折叠"
        mobile={false}
      />,
    );

    const project = screen.getByRole("button", { name: "Science 125" });
    expect(project).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(project);
    expect(project).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /Runs/ })).not.toBeInTheDocument();
  });
});
