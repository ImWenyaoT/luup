"""Run the Python Harness without FastAPI: `uv run python -m app.cli --question ...`."""

from __future__ import annotations

import argparse
import asyncio
import json
import subprocess
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol

from app.agent import FileReferenceVerifier
from app.agent.campaign import read_prior_attempts, record_run
from app.agent.model import QwenSettings
from app.agent.orchestrator import Harness, RunOutcome
from app.agent.specialists import AgentsSdkSpecialistRunner
from app.agent.tools import ArxivClient, LuupTools
from app.domain.runs import utc_stamp
from app.services.launch import FileRunLock, RunInProgress


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run one Luup scientific-hypothesis pipeline.")
    parser.add_argument("--question", required=True, help="The Science-125 or free-form scientific question.")
    parser.add_argument(
        "--repo-root", type=Path, default=Path.cwd().parent, help="Repository root containing runs/ and memory/."
    )
    parser.add_argument("--run-dir", type=Path, help="Reserved run directory supplied by the HTTP launcher.")
    parser.add_argument(
        "--science125-id",
        type=int,
        dest="science125_id",
        help="Science-125 question number; recorded as meta.questionId so the evaluation sees this run.",
    )
    parser.add_argument(
        "--no-memory",
        action="store_true",
        help="Ablation arm: no campaign-memory reads, no write-back, recorded as meta.memoryArm=off.",
    )
    return parser


class HarnessRunner(Protocol):
    async def run(self, question: str, run_dir: Path, prior_attempts: Sequence[str] = ()) -> RunOutcome: ...


async def run_cli(
    question: str,
    repo_root: Path,
    run_dir: Path | None = None,
    *,
    harness: HarnessRunner | None = None,
    question_id: int | None = None,
    memory: bool = True,
) -> int:
    if harness is None:
        try:
            settings = QwenSettings.from_environment()
        except RuntimeError as exc:
            print(f"[luup] {exc}")
            return 2
    root = repo_root.resolve()
    memory_dir = root / "memory" if memory else None
    held_lock = None
    if run_dir is None:
        try:
            held_lock = FileRunLock(root / "runs").acquire()
        except RunInProgress as exc:
            print(f"[luup] 已有运行中的 run：{exc.holder.run_id or '(启动中)'}")
            return 2
        run_dir = root / "runs" / utc_stamp()
        held_lock.set_run_id(run_dir.name)
    else:
        run_dir = run_dir.resolve()
    try:
        settled_id = _write_cli_start(run_dir, question, question_id, memory)
        if harness is None:
            arxiv = ArxivClient()
            tools = LuupTools(run_dir, memory_dir, arxiv)
            harness = Harness(AgentsSdkSpecialistRunner(settings, tools), FileReferenceVerifier(arxiv))
        outcome = await harness.run(question, run_dir, read_prior_attempts(memory_dir, settled_id))
        exit_code = 0 if outcome.status == "passed" else 1
        _write_cli_complete(run_dir, exit_code, outcome.classification, root)
        record_run(
            memory_dir,
            run_dir=run_dir,
            question_id=settled_id,
            status=outcome.status,
            classification=outcome.classification,
        )
        print(
            json.dumps(
                {"status": outcome.status, "runDir": str(outcome.run_dir), "failures": outcome.failures}, ensure_ascii=False
            )
        )
        return exit_code
    finally:
        if held_lock is not None:
            held_lock.release()


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _write_cli_start(run_dir: Path, question: str, question_id: int | None, memory: bool) -> int | None:
    """Returns the question id in force: the argument, or the one the HTTP launcher already wrote."""
    run_dir.mkdir(parents=True, exist_ok=True)
    question_path = run_dir / "question.md"
    if not question_path.exists():
        question_path.write_text(f"问题：{question.strip()}\n", encoding="utf-8")
    meta_path = run_dir / "meta.json"
    meta = _read_mapping(meta_path)
    meta.setdefault("startedAt", _now())
    if question_id is not None:
        meta["questionId"] = question_id
    meta["memoryArm"] = "on" if memory else "off"
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    settled = meta.get("questionId")
    return settled if isinstance(settled, int) and not isinstance(settled, bool) else None


def _source_identity(repo_root: Path) -> dict[str, object] | None:
    """Which build produced this run — a fact the model has no way to know or report.

    ``--untracked-files=no`` because the run writes its own new directory under ``runs/``:
    counting that as a dirty tree would mark every run dirty and make the flag say nothing.
    """
    try:
        commit = _git(repo_root, "rev-parse", "HEAD")
        dirty = _git(repo_root, "status", "--porcelain", "--untracked-files=no")
    except (OSError, subprocess.SubprocessError):
        return None
    if commit.returncode != 0 or dirty.returncode != 0:
        return None
    return {"gitCommit": commit.stdout.strip(), "treeDirty": bool(dirty.stdout.strip())}


def _git(repo_root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(("git", *args), cwd=repo_root, capture_output=True, text=True, timeout=10)


def _write_cli_complete(run_dir: Path, exit_code: int, classification: str | None, repo_root: Path) -> None:
    finished = _now()
    exit_fact: dict[str, object] = {"exitCode": exit_code, "endedAt": finished}
    if classification is not None:
        exit_fact["classification"] = classification
    exit_fact["sourceIdentity"] = _source_identity(repo_root)
    (run_dir / "exit.json").write_text(
        json.dumps(exit_fact, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    meta_path = run_dir / "meta.json"
    meta = _read_mapping(meta_path)
    meta.update({"finishedAt": finished, "exitCode": exit_code})
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _read_mapping(path: Path) -> dict[str, object]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {}
    return raw if isinstance(raw, dict) else {}


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    return asyncio.run(
        run_cli(
            args.question,
            args.repo_root,
            args.run_dir,
            question_id=args.science125_id,
            memory=not args.no_memory,
        )
    )


if __name__ == "__main__":
    raise SystemExit(main())
