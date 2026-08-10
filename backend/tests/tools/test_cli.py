from __future__ import annotations

from pathlib import Path

from app.cli import run_cli
from app.harness.orchestrator import RunOutcome
from app.services.runs import RunService


class SuccessfulHarness:
    async def run(self, question: str, run_dir: Path) -> RunOutcome:
        run_dir.mkdir(parents=True, exist_ok=True)
        (run_dir / "proposal.md").write_text("# Proposal\n", encoding="utf-8")
        (run_dir / "verification-report.md").write_text("结果: ALL PASS\n", encoding="utf-8")
        return RunOutcome(status="passed", run_dir=run_dir)


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
