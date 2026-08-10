"""Run the Python Harness without FastAPI: `uv run python -m app.cli --question ...`."""

from __future__ import annotations

import argparse
import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol

from app.domain.runs import utc_stamp
from app.harness.model import QwenSettings
from app.harness.orchestrator import Harness, RunOutcome
from app.harness.specialists import AgentsSdkSpecialistRunner
from app.services.launch import FileRunLock, RunInProgress
from app.tools import ArxivClient, FileReferenceVerifier, LuupTools


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run one Luup scientific-hypothesis pipeline.")
    parser.add_argument("--question", required=True, help="The Science-125 or free-form scientific question.")
    parser.add_argument(
        "--repo-root", type=Path, default=Path.cwd().parent, help="Repository root containing runs/ and memory/."
    )
    parser.add_argument("--run-dir", type=Path, help="Reserved run directory supplied by the HTTP launcher.")
    return parser


class HarnessRunner(Protocol):
    async def run(self, question: str, run_dir: Path) -> RunOutcome: ...


async def run_cli(
    question: str, repo_root: Path, run_dir: Path | None = None, *, harness: HarnessRunner | None = None
) -> int:
    if harness is None:
        try:
            settings = QwenSettings.from_environment()
        except RuntimeError as exc:
            print(f"[luup] {exc}")
            return 2
    root = repo_root.resolve()
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
        _write_cli_start(run_dir, question)
        if harness is None:
            arxiv = ArxivClient()
            tools = LuupTools(run_dir, root / "memory", arxiv)
            harness = Harness(AgentsSdkSpecialistRunner(settings, tools), FileReferenceVerifier(arxiv))
        outcome = await harness.run(question, run_dir)
        exit_code = 0 if outcome.status == "passed" else 1
        _write_cli_complete(run_dir, exit_code)
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


def _write_cli_start(run_dir: Path, question: str) -> None:
    run_dir.mkdir(parents=True, exist_ok=True)
    question_path = run_dir / "question.md"
    if not question_path.exists():
        question_path.write_text(f"问题：{question.strip()}\n", encoding="utf-8")
    meta_path = run_dir / "meta.json"
    meta = _read_mapping(meta_path)
    meta.setdefault("startedAt", _now())
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _write_cli_complete(run_dir: Path, exit_code: int) -> None:
    finished = _now()
    (run_dir / "exit.json").write_text(
        json.dumps({"exitCode": exit_code, "endedAt": finished}, ensure_ascii=False, indent=2) + "\n",
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
    return asyncio.run(run_cli(args.question, args.repo_root, args.run_dir))


if __name__ == "__main__":
    raise SystemExit(main())
