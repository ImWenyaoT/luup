"""一个 run 目录长什么样——全仓测试共用的唯一描述。

`RunService` 和 `app.evaluation` 的真实 interface 不是各自的方法签名，而是 `runs/<id>/`
里这组工件的**字节形状**：它们只读这些文件，不读别的。这份形状此前以几份互不相同的手工
拷贝散落在测试里（读模型一份、评估一份、评估里还有一份内联的），改一个字段要改好几处，
谁也不是权威。这里是权威。

interface 就是「相对路径 -> 文本」这张表，`write_run` 只做两件事：按 `question_id` /
`passed` / `refs` 生成互相自洽的一整套默认工件，再让 `artifacts` 逐个文件覆写、追加，或者
以 `None` 拿掉——某个工件的**缺席**常常正是被测的事实（没有 `exit.json` 的 run 就是那批
已提交的旧 run）。所以任何一个测试只需要说清它关心的那一两个文件，其余形状由这里保证一致。

四条刻意的边界——它们同时解释了为什么有些测试**没有**改用这个 fixture：

- **只描述终态、完整的 run。** 故意不完整的目录不归这里管：批跑索引只读
  `meta.json` + `exit.json`，且好几个用例断言的正是「这个 run 还没终态」；HTTP 预留目录
  只有 `question.md` + `meta.json`，测的正是「pipeline 还没写别的」。给它们一份完整 run
  会连带塞进一份 ALL PASS 报告，悄悄改掉它们在断言什么。所以 `tests/test_batch.py` 和
  `tests/test_cli.py` 保留各自的局部写法。
- **只描述今天的形状。** TS 时代那套（`hypotheses.md` / `critique.md` / `verdicts/*.json`）
  连同产生它的 run 一起已从 HEAD 删除，读模型不再有对应分支；要考古走 `git show`。
- **不写 append-only 的记账流。** `usage.jsonl` / `tool-events.jsonl` / `trace.jsonl`
  在真实 run 里可有可无（一次都没烧 token 的失败不写 usage 行），而且它们的**缺席**本身
  就是被断言的事实（「成本未知记为 null」）。要它们的测试自己用 `artifacts` 给。
- **不参数化没人要的维度。** 只有调用点真正需要变化的东西才是参数；其余一律走
  `artifacts` 逐文件覆写，多一个维度就多一个没人维护的分支。
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from pathlib import Path

import pytest

STARTED_AT = "2026-08-10T00:00:00.000Z"
FINISHED_AT = "2026-08-10T00:01:30.000Z"


def _question_md(question_id: int | None) -> str:
    """自由输入（OOD）run 没有来源行，所以也没有题号可被解析出来。"""
    header = (
        f"来源：《Science》125 前沿科学问题（Science-125 题库）第 {question_id} 题，天文。\n\n"
        if question_id is not None
        else ""
    )
    return f"{header}问题：What makes prime numbers so special?\n"


def _verification_report(passed: bool, refs: int) -> str:
    result = "ALL PASS" if passed else "1/1 FAILED"
    mark = "✅ PASS" if passed else "❌ FAIL"
    return (
        "# 验收报告（确定性检查）\n\n"
        f"结果: {result}\n\n"
        "| 检查项 | 结果 | 说明 |\n"
        "| --- | --- | --- |\n"
        f"| B3.count | {mark} | references = {refs}（要求 ≥5） |\n"
    )


def _default_artifacts(question_id: int | None, passed: bool, refs: int) -> dict[str, str]:
    exit_code = 0 if passed else 1
    meta: dict[str, object] = {
        "startedAt": STARTED_AT,
        "memoryArm": "on",
        "finishedAt": FINISHED_AT,
        "exitCode": exit_code,
    }
    if question_id is not None:
        meta["questionId"] = question_id
    references = [{"arxivId": f"2401.{12345 + index}"} for index in range(refs)]
    artifacts = {
        "question.md": _question_md(question_id),
        "meta.json": json.dumps(meta, ensure_ascii=False, indent=2) + "\n",
        # `sourceIdentity: null` 是 git 不可用时 `app.cli` 真正写出来的值；要具体 commit
        # 的测试自己覆写 exit.json。
        "exit.json": json.dumps(
            {"exitCode": exit_code, "endedAt": FINISHED_AT, "sourceIdentity": None}, indent=2
        )
        + "\n",
        "evidence.md": "# 证据\n\n- F1 2401.12345：一条事实卡。\n",
        "proposal.json": json.dumps(
            {"paperTitle": "A valid title", "references": references}, ensure_ascii=False, indent=2
        )
        + "\n",
        "proposal.md": "# A proposal\n",
        "review.json": json.dumps({"verdict": "pass", "findings": [], "requiredChanges": []}) + "\n",
        "verification.json": json.dumps({"ok": passed, "referenceCount": refs, "checks": [], "failed": []}) + "\n",
        "verification-report.md": _verification_report(passed, refs),
        # 新 run 写 5 列（第一作者随 B4 加入）；已提交的旧 run 只有 4 列。
        "memory/index.md": (
            "# 文献索引\n\n"
            "| arXiv id | 年份 | 第一作者 | 标题 | 一句话摘要 |\n"
            "| --- | --- | --- | --- | --- |\n"
            "| 2401.12345 | 2024 | Ada Lovelace | Paper | First sentence. |\n"
        ),
        "memory/papers/2401.12345.md": "# Paper\n\narXiv: 2401.12345\n",
    }
    if not passed:
        artifacts["FAILED.md"] = "# Luup run failed\n\n- 未知失败\n"
    return artifacts


def _materialise(root: Path, run_id: str, artifacts: Mapping[str, str | None]) -> Path:
    run = root / run_id
    run.mkdir(parents=True)
    for name, text in artifacts.items():
        if text is None:
            continue
        target = run / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
    return run


@pytest.fixture
def write_run() -> Callable[..., Path]:
    """`write_run(root, run_id, *, question_id, passed, refs, artifacts) -> Path`。

    默认给一个终态、通过验收、带 5 篇引用的完整 run。`artifacts` 里的每一项按相对路径
    覆写或追加单个工件（含 `memory/index.md` 这类嵌套路径），值给 `None` 表示这个 run
    没有这个工件。
    """

    def build(
        root: Path,
        run_id: str = "20260810-000001",
        *,
        question_id: int | None = 7,
        passed: bool = True,
        refs: int = 5,
        artifacts: Mapping[str, str | None] | None = None,
    ) -> Path:
        return _materialise(root, run_id, {**_default_artifacts(question_id, passed, refs), **(artifacts or {})})

    return build
