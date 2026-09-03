import { createRef } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { Science125Question } from "../../lib/types/wire";
import { renderWithProviders } from "../../test-utils";
import { ResearchQuestionInput, type ResearchQuestionInputHandle } from "./ResearchQuestionInput";

describe("ResearchQuestionInput", () => {
  test("提交问题并调用 onSubmit", async () => {
    const onSubmit = vi.fn(async () => {});
    renderWithProviders(<ResearchQuestionInput variant="welcome" onSubmit={onSubmit} />);

    fireEvent.change(screen.getByTestId("welcome-question-input"), {
      target: { value: "测试问题" },
    });
    fireEvent.click(screen.getByTestId("start-research"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("测试问题"));
  });

  test("footer 变体成功后清空输入", async () => {
    const onSubmit = vi.fn(async () => {});
    renderWithProviders(<ResearchQuestionInput variant="footer" onSubmit={onSubmit} />);

    fireEvent.change(screen.getByTestId("welcome-question-input"), {
      target: { value: "footer 问题" },
    });
    fireEvent.click(screen.getByTestId("start-research"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("footer 问题"));
    expect(screen.getByTestId("welcome-question-input")).toHaveValue("");
  });

  test("侧边栏选题会填入输入框", () => {
    const selectedQuestion: Science125Question = {
      id: 2,
      domain: "Physics",
      question: "量子引力如何统一？",
    };
    renderWithProviders(
      <ResearchQuestionInput variant="welcome" onSubmit={vi.fn(async () => {})} selectedQuestion={selectedQuestion} />,
    );

    expect(screen.getByTestId("welcome-question-input")).toHaveValue("量子引力如何统一？");
    expect(screen.getByText("已选 #2 · Physics")).toBeInTheDocument();
  });

  test("ref.submit 支持快捷题 override", async () => {
    const onSubmit = vi.fn(async () => {});
    const ref = createRef<ResearchQuestionInputHandle>();
    renderWithProviders(<ResearchQuestionInput ref={ref} variant="welcome" onSubmit={onSubmit} />);

    await ref.current!.submit("快捷 override");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("快捷 override"));
  });
});
