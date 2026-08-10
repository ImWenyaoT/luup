from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock

import pytest

from app import cli as cli_module
from app.agent.orchestrator import RunOutcome
from app.agent.specialists import AgentsSdkSpecialistRunner
from app.agent.tools import LuupTools
from app.agent.verifier import FileReferenceVerifier
from app.cli import main, run_cli
from app.services.launch import FileRunLock
from app.services.runs import RunService


class SuccessfulHarness:
    async def run(self, question: str, run_dir: Path) -> RunOutcome:
        run_dir.mkdir(parents=True, exist_ok=True)
        (run_dir / "proposal.md").write_text("# Proposal\n", encoding="utf-8")
        (run_dir / "verification-report.md").write_text("结果: ALL PASS\n", encoding="utf-8")
        return RunOutcome(status="passed", run_dir=run_dir)


class FailingHarness:
    async def run(self, question: str, run_dir: Path) -> RunOutcome:
        run_dir.mkdir(parents=True, exist_ok=True)
        return RunOutcome(status="failed", run_dir=run_dir, failures=("B1.2401.12345",))


def with_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("QWEN_BASE_URL", "https://dashscope.invalid/compatible-mode/v1")
    monkeypatch.setenv("QWEN_API_KEY", "offline-test-key")


async def test_cli_refuses_to_start_without_qwen_credentials(monkeypatch, tmp_path, capsys) -> None:
    monkeypatch.delenv("QWEN_BASE_URL", raising=False)
    monkeypatch.delenv("QWEN_API_KEY", raising=False)

    code = await run_cli("a scientific question", tmp_path)

    assert code == 2
    assert not (tmp_path / "runs").exists()
    assert "QWEN_BASE_URL" in capsys.readouterr().out


async def test_direct_cli_success_is_a_settled_passed_run(tmp_path: Path) -> None:
    run_dir = tmp_path / "runs" / "20260810-010203"

    code = await run_cli("a scientific question", tmp_path, run_dir, harness=SuccessfulHarness())

    assert code == 0
    assert (run_dir / "question.md").is_file()
    assert (run_dir / "meta.json").is_file()
    assert (run_dir / "exit.json").is_file()
    status = RunService(tmp_path / "runs").status(run_dir.name)
    assert status is not None and status["status"] == "passed"


async def test_cli_reserves_a_timestamped_run_directory_and_releases_the_lock(tmp_path: Path, capsys) -> None:
    """Without an HTTP launcher the CLI owns the serialization lock, and must hand it back."""
    lock = FileRunLock(tmp_path / "runs")

    code = await run_cli("a scientific question", tmp_path, harness=SuccessfulHarness())

    assert code == 0
    created = [path.name for path in (tmp_path / "runs").iterdir() if path.is_dir()]
    assert len(created) == 1 and re.fullmatch(r"\d{8}-\d{6}", created[0])
    assert json.loads(capsys.readouterr().out) == {
        "status": "passed",
        "runDir": str(tmp_path / "runs" / created[0]),
        "failures": [],
    }
    assert not lock.path.exists()
    assert lock.active_run_id() is None
    lock.acquire().release()  # The next run can take the lock without a manual cleanup.


@pytest.mark.parametrize("holder_run_id", ["20260810-010203", None], ids=["named-holder", "starting-holder"])
async def test_a_second_cli_run_refuses_while_another_run_holds_the_lock(
    tmp_path: Path, capsys, holder_run_id: str | None
) -> None:
    """The pipeline is serial: a concurrent start must exit 2 and leave the holder's run untouched."""
    held = FileRunLock(tmp_path / "runs").acquire()
    if holder_run_id is not None:
        held.set_run_id(holder_run_id)

    code = await run_cli("a scientific question", tmp_path, harness=SuccessfulHarness())

    assert code == 2
    assert (holder_run_id or "(启动中)") in capsys.readouterr().out
    assert [path.name for path in (tmp_path / "runs").iterdir() if path.is_dir()] == []
    assert held.release() is True


async def test_a_reserved_run_directory_keeps_the_launcher_question_and_start_time(tmp_path: Path) -> None:
    """The HTTP launcher already wrote the canonical Science-125 question; the CLI must not clobber it."""
    run_dir = tmp_path / "runs" / "20260810-010203"
    run_dir.mkdir(parents=True)
    (run_dir / "question.md").write_text("来源：Science-125 第 7 题。\n问题：Q\n", encoding="utf-8")
    (run_dir / "meta.json").write_text(json.dumps({"startedAt": "2020-01-01T00:00:00.000Z", "questionId": 7}))

    code = await run_cli("a different question", tmp_path, run_dir, harness=SuccessfulHarness())

    assert code == 0
    assert "第 7 题" in (run_dir / "question.md").read_text(encoding="utf-8")
    meta = json.loads((run_dir / "meta.json").read_text(encoding="utf-8"))
    assert meta["startedAt"] == "2020-01-01T00:00:00.000Z"
    assert meta["questionId"] == 7
    assert meta["exitCode"] == 0
    assert meta["finishedAt"] > meta["startedAt"]
    assert not (tmp_path / "runs" / ".active.json").exists()  # A supplied run dir takes no lock.


async def test_a_failed_pipeline_exits_one_and_settles_the_run_with_its_failures(tmp_path: Path, capsys) -> None:
    run_dir = tmp_path / "runs" / "20260810-010203"

    code = await run_cli("a scientific question", tmp_path, run_dir, harness=FailingHarness())

    assert code == 1
    assert json.loads(capsys.readouterr().out)["failures"] == ["B1.2401.12345"]
    assert json.loads((run_dir / "exit.json").read_text(encoding="utf-8"))["exitCode"] == 1
    assert json.loads((run_dir / "meta.json").read_text(encoding="utf-8"))["exitCode"] == 1


async def test_the_default_harness_is_the_real_sdk_adapter_wired_to_this_run(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """The composition root is the only place the real adapters are chosen; nothing here calls a model."""
    with_credentials(monkeypatch)
    run_dir = tmp_path / "runs" / "20260810-010203"
    captured: dict[str, Any] = {}
    real_tools = cli_module.LuupTools

    def spy_tools(tools_run_dir: Path, memory_dir: Path, arxiv: Any) -> LuupTools:
        captured["tools"] = (tools_run_dir, memory_dir, arxiv)
        return real_tools(tools_run_dir, memory_dir, arxiv)

    class SpyHarness:
        def __init__(self, runner: Any, verifier: Any) -> None:
            captured["harness"] = (runner, verifier)

        async def run(self, question: str, harness_run_dir: Path) -> RunOutcome:
            captured["question"] = question
            return RunOutcome(status="passed", run_dir=harness_run_dir)

    monkeypatch.setattr(cli_module, "LuupTools", spy_tools)
    monkeypatch.setattr(cli_module, "Harness", SpyHarness)

    code = await run_cli("a scientific question", tmp_path, run_dir)

    assert code == 0
    assert captured["question"] == "a scientific question"
    assert captured["tools"][0] == run_dir
    assert captured["tools"][1] == tmp_path / "memory"
    runner, verifier = captured["harness"]
    assert isinstance(runner, AgentsSdkSpecialistRunner)
    assert isinstance(verifier, FileReferenceVerifier)


def test_main_passes_the_parsed_arguments_through_and_returns_the_pipeline_exit_code(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    pipeline = AsyncMock(return_value=1)
    monkeypatch.setattr(cli_module, "run_cli", pipeline)

    code = main(["--question", "why do stars explode?", "--repo-root", str(tmp_path), "--run-dir", str(tmp_path / "r")])

    assert code == 1
    pipeline.assert_awaited_once_with("why do stars explode?", tmp_path, tmp_path / "r")


def test_main_defaults_the_repo_root_to_the_parent_of_the_backend_working_directory(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """`uv run python -m app.cli` runs from backend/, so runs/ and memory/ live one level up."""
    pipeline = AsyncMock(return_value=0)
    monkeypatch.setattr(cli_module, "run_cli", pipeline)
    (tmp_path / "backend").mkdir()
    monkeypatch.chdir(tmp_path / "backend")

    assert main(["--question", "why do stars explode?"]) == 0
    pipeline.assert_awaited_once_with("why do stars explode?", tmp_path, None)


def test_the_question_argument_is_required(capsys) -> None:
    with pytest.raises(SystemExit) as raised:
        main([])

    assert raised.value.code == 2
    assert "--question" in capsys.readouterr().err
