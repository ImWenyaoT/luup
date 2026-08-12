"""Batch delivery vehicle: `uv run python -m app.batch --ids 1-125`.

Criteria G5 asks for the whole Science-125 set with resumption. That is a loop around
the existing composition root, not a second pipeline: every question goes through
`cli.run_cli`, so a batch run and a single run produce byte-identical artifacts.

Three properties make a many-hour production run survivable:
resumption (a question whose settled run already exited 0 is never paid for twice),
isolation (one question's outage is recorded and the batch continues), and
serialization (Bailian rate-limits, so questions run one at a time, in a fixed order).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import time
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from app.cli import run_cli
from app.domain.runs import is_run_id
from app.domain.science125 import find_question
from app.services.launch import science125_text

Status = Literal["passed", "failed", "skipped", "error", "missing", "planned"]

CLEAN = ("passed", "skipped", "planned")
"""Statuses that leave the batch's exit code at 0; everything else is a question owed."""

SAME_CLASS_STOP = 5
"""A batch is worth running because questions are independent; a same-class streak refutes that."""

OUTAGE_STOP = 2
"""Two outages in a row is credentials, network, or quota — the other 123 would fail identically."""

OUTAGE_CLASSES = frozenset({"infra_error", "infra_timeout"})

_RANGE = re.compile(r"(\d+)-(\d+)")
_SINGLE = re.compile(r"\d+")


@dataclass(frozen=True)
class QuestionOutcome:
    question_id: int
    status: Status
    seconds: float
    detail: str = ""
    classification: str | None = None


def parse_ids(spec: str) -> list[int]:
    """`61`, `3,54,61`, `1-125`, or any mixture; the result is deduplicated and ascending."""
    ids: set[int] = set()
    for piece in (chunk.strip() for chunk in spec.split(",")):
        if not piece:
            continue
        span = _RANGE.fullmatch(piece)
        if span is not None:
            low, high = int(span.group(1)), int(span.group(2))
            if low > high:
                raise ValueError(f"题号区间 {piece!r} 的起点大于终点。")
            ids.update(range(low, high + 1))
        elif _SINGLE.fullmatch(piece):
            ids.add(int(piece))
        else:
            raise ValueError(f"无法解析的题号片段 {piece!r}；只接受 `61`、`3,54,61` 或 `1-125`。")
    if not ids:
        raise ValueError("--ids 没有给出任何题号。")
    return sorted(ids)


def passed_question_runs(runs_root: Path) -> dict[int, str]:
    """Question id -> newest run that carries it and finished deliverable.

    `meta.questionId` ties a run to a question; a second artifact makes it terminal.
    Two shapes count as terminal, because the committed corpus contains both:

    - current: `exit.json` with exit code 0;
    - legacy: no `exit.json` (it predates that convention) but a verifier verdict of
      ALL PASS — the TypeScript-era `meta` + ALL PASS contract.

    Reading legacy runs rather than backfilling them keeps `runs/` immutable after
    terminal state, which is the whole reason it is fact data and not cache.
    """
    passed: dict[int, str] = {}
    for entry in _run_dirs(runs_root):
        question_id = _int(_read_mapping(entry / "meta.json").get("questionId"))
        if question_id is not None and _is_deliverable(entry):
            passed[question_id] = entry.name
    return passed


def _run_dirs(runs_root: Path) -> list[Path]:
    try:
        return sorted(entry for entry in runs_root.iterdir() if entry.is_dir() and is_run_id(entry.name))
    except OSError:
        return []


def _failure_class(runs_root: Path, question_id: int) -> str | None:
    """Read back the reason the Harness recorded — the only thing that can tell the batch to stop."""
    runs = [
        run for run in _run_dirs(runs_root) if _int(_read_mapping(run / "meta.json").get("questionId")) == question_id
    ]
    classification = _read_mapping(runs[-1] / "exit.json").get("classification") if runs else None
    return classification if isinstance(classification, str) and classification else None


def _is_deliverable(run: Path) -> bool:
    exit_code = _int(_read_mapping(run / "exit.json").get("exitCode"))
    if exit_code is not None:
        return exit_code == 0
    return _read_mapping(run / "verification.json").get("ok") is True or _all_pass(run)


def _all_pass(run: Path) -> bool:
    """The legacy verdict lives only in the rendered report; runs before verification.json have no other."""
    try:
        return "结果: ALL PASS" in (run / "verification-report.md").read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return False


async def run_batch(
    question_ids: Sequence[int],
    repo_root: Path,
    *,
    runs_root: Path | None = None,
    dry_run: bool = False,
    memory: bool = True,
) -> list[QuestionOutcome]:
    root = repo_root.resolve()
    runs = runs_root or root / "runs"
    already = passed_question_runs(runs)
    outcomes: list[QuestionOutcome] = []
    cause, streak = "", 0
    for index, question_id in enumerate(question_ids, start=1):
        outcome = await _run_one(question_id, root, already, runs, dry_run=dry_run, memory=memory)
        print(
            f"[batch] {index}/{len(question_ids)} q{outcome.question_id} | {outcome.status} | "
            f"{outcome.seconds:.1f}s{f' | {outcome.detail}' if outcome.detail else ''}",
            flush=True,
        )
        outcomes.append(outcome)
        if outcome.status == "passed":
            cause, streak = "", 0
        if outcome.status in CLEAN:
            continue
        current = outcome.classification or outcome.status
        streak = streak + 1 if current == cause else 1
        cause = current
        if streak >= (OUTAGE_STOP if current in OUTAGE_CLASSES else SAME_CLASS_STOP):
            remaining = ",".join(str(owed) for owed in question_ids[index:])
            print(
                f"[batch] 熔断停批：连续 {streak} 次 {current}。已完成 {index}/{len(question_ids)}，"
                f"剩余 --ids {remaining or '（无）'}"
            )
            break
    print(f"[batch] 合计 {len(outcomes)} 题：" + "，".join(f"{name} {count}" for name, count in _tally(outcomes)))
    return outcomes


async def _run_one(
    question_id: int, root: Path, already: dict[int, str], runs_root: Path, *, dry_run: bool, memory: bool
) -> QuestionOutcome:
    if question_id in already:
        return QuestionOutcome(question_id, "skipped", 0.0, f"已有终态 passed 的 run {already[question_id]}")
    question = find_question(question_id)
    if question is None:
        return QuestionOutcome(question_id, "missing", 0.0, "题号不在 science125.json 内")
    if dry_run:
        return QuestionOutcome(question_id, "planned", 0.0, question.question[:60])
    started = time.monotonic()
    try:
        code = await run_cli(science125_text(question), root, question_id=question_id, memory=memory)
    except Exception as exc:  # One question's outage must not cost the other 124.
        detail = f"{type(exc).__name__}: {exc}"
        return QuestionOutcome(question_id, "error", time.monotonic() - started, detail, "infra_error")
    elapsed = time.monotonic() - started
    if code == 0:
        return QuestionOutcome(question_id, "passed", elapsed)
    # exit 2 is a refusal to start (missing credentials, lock held) rather than a verdict;
    # printing the code is what tells a half-hour batch log apart from a five-second one, and
    # it settles no run to read a class off, so the environment is named here instead.
    classification = _failure_class(runs_root, question_id) or ("infra_error" if code == 2 else None)
    return QuestionOutcome(question_id, "failed", elapsed, f"app.cli exit {code}", classification)


def _tally(outcomes: Sequence[QuestionOutcome]) -> list[tuple[str, int]]:
    """A histogram over (status, classification): after 125 questions it is what says what to fix."""
    counts: dict[str, int] = {}
    for outcome in outcomes:
        key = outcome.status if outcome.classification is None else f"{outcome.status}/{outcome.classification}"
        counts[key] = counts.get(key, 0) + 1
    return sorted(counts.items())


def _read_mapping(path: Path) -> dict[str, object]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {}
    return raw if isinstance(raw, dict) else {}


def _int(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run a list of Science-125 questions serially, skipping successes.")
    parser.add_argument("--ids", required=True, help="题号，例如 `1-125`、`3,54,61`，或两者混写。")
    parser.add_argument("--repo-root", type=Path, default=Path.cwd().parent, help="含 runs/ 与 memory/ 的仓库根。")
    parser.add_argument("--runs-root", type=Path, help="断点续跑扫描的 runs 目录；默认取 <repo-root>/runs。")
    parser.add_argument("--dry-run", action="store_true", help="只打印计划，一次运行都不发起。")
    parser.add_argument("--no-memory", action="store_true", help="消融臂：整批关闭跨 run 记忆，透传给 app.cli。")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        question_ids = parse_ids(args.ids)
    except ValueError as exc:
        print(f"[batch] {exc}")
        return 2
    outcomes = asyncio.run(
        run_batch(
            question_ids,
            args.repo_root,
            runs_root=args.runs_root,
            dry_run=args.dry_run,
            memory=not args.no_memory,
        )
    )
    return 0 if all(outcome.status in CLEAN for outcome in outcomes) else 1


if __name__ == "__main__":
    raise SystemExit(main())
