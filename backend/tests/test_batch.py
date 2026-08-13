from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock

import pytest

from app import batch as batch_module
from app.batch import main, parse_ids, passed_question_runs, run_batch


def write_run(runs_root: Path, run_id: str, *, question_id: int | None, exit_code: int | None) -> Path:
    run = runs_root / run_id
    run.mkdir(parents=True)
    meta: dict[str, object] = {"startedAt": "2026-08-10T00:00:00.000Z"}
    if question_id is not None:
        meta["questionId"] = question_id
    (run / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
    if exit_code is not None:
        (run / "exit.json").write_text(json.dumps({"exitCode": exit_code}), encoding="utf-8")
    return run


def stub_runner(monkeypatch: pytest.MonkeyPatch, *, codes: dict[int, int] | None = None) -> list[dict[str, Any]]:
    """Records every `run_cli` call; no test in this file may reach a model or the network."""
    calls: list[dict[str, Any]] = []

    async def fake_run_cli(
        question: str, repo_root: Path, run_dir: Path | None = None, **options: Any
    ) -> int:
        calls.append({"question": question, "repoRoot": repo_root, "runDir": run_dir, **options})
        question_id = options.get("question_id")
        return (codes or {}).get(question_id, 0) if isinstance(question_id, int) else 0

    monkeypatch.setattr(batch_module, "run_cli", fake_run_cli)
    return calls


@pytest.mark.parametrize(
    ("spec", "expected"),
    [
        pytest.param("61", [61], id="one-id"),
        pytest.param("3,54,61", [3, 54, 61], id="comma-list"),
        pytest.param("1-5", [1, 2, 3, 4, 5], id="range"),
        pytest.param("1-3,61", [1, 2, 3, 61], id="range-and-list"),
        pytest.param(" 61 , 3 ", [3, 61], id="whitespace-and-order"),
        pytest.param("3,3,2-3", [2, 3], id="duplicates-collapse"),
        pytest.param("7-7", [7], id="degenerate-range"),
    ],
)
def test_parse_ids_accepts_ranges_lists_and_mixtures(spec: str, expected: list[int]) -> None:
    assert parse_ids(spec) == expected


@pytest.mark.parametrize(
    "spec",
    [
        pytest.param("", id="empty"),
        pytest.param(",,", id="only-separators"),
        pytest.param("5-1", id="reversed-range"),
        pytest.param("abc", id="not-a-number"),
        pytest.param("1-2-3", id="double-range"),
        pytest.param("-5", id="open-range"),
    ],
)
def test_parse_ids_rejects_a_spec_it_cannot_read_exactly(spec: str) -> None:
    """A silently mis-parsed id list would spend real money on the wrong questions."""
    with pytest.raises(ValueError):
        parse_ids(spec)


def write_legacy_run(runs_root: Path, run_id: str, *, question_id: int, all_pass: bool = True) -> Path:
    """A run shaped like the committed q61 ones: meta.questionId, ALL PASS, and no exit.json."""
    run = runs_root / run_id
    run.mkdir(parents=True)
    (run / "meta.json").write_text(json.dumps({"questionId": question_id}), encoding="utf-8")
    (run / "verification-report.md").write_text(
        "# 验收报告（确定性检查）\n\n结果: ALL PASS\n" if all_pass else "结果: 2/6 FAILED\n", encoding="utf-8"
    )
    return run


def test_passed_runs_index_only_counts_settled_successes(tmp_path: Path) -> None:
    runs_root = tmp_path / "runs"
    write_run(runs_root, "20260810-000001", question_id=3, exit_code=0)
    write_run(runs_root, "20260810-000002", question_id=4, exit_code=1)
    write_run(runs_root, "20260810-000003", question_id=5, exit_code=None)
    write_run(runs_root, "20260810-000004", question_id=None, exit_code=0)
    write_run(runs_root, "20260810-000005", question_id=3, exit_code=0)
    (runs_root / "not-a-run-id").mkdir()

    assert passed_question_runs(runs_root) == {3: "20260810-000005"}


def test_a_missing_runs_root_simply_has_no_completed_questions(tmp_path: Path) -> None:
    assert passed_question_runs(tmp_path / "absent") == {}


def test_a_legacy_all_pass_run_without_exit_json_still_counts_as_completed(tmp_path: Path) -> None:
    """已提交的 q61 run 早于 exit.json；跑 125 题的批次不能为它们再付一次钱。"""
    runs_root = tmp_path / "runs"
    write_legacy_run(runs_root, "20260810-000011", question_id=54)
    write_legacy_run(runs_root, "20260810-000012", question_id=61)
    write_legacy_run(runs_root, "20260810-000013", question_id=125)
    write_legacy_run(runs_root, "20260810-000014", question_id=7, all_pass=False)

    assert passed_question_runs(runs_root) == {
        54: "20260810-000011",
        61: "20260810-000012",
        125: "20260810-000013",
    }


def test_a_structured_verification_verdict_counts_when_there_is_no_exit_json(tmp_path: Path) -> None:
    runs_root = tmp_path / "runs"
    run = write_legacy_run(runs_root, "20260810-000001", question_id=3, all_pass=False)
    (run / "verification.json").write_text(json.dumps({"ok": True}), encoding="utf-8")

    assert passed_question_runs(runs_root) == {3: "20260810-000001"}


def test_a_settled_failure_is_never_rescued_by_a_stale_all_pass_report(tmp_path: Path) -> None:
    """exit.json is the newer, stronger fact: when it exists it decides alone."""
    runs_root = tmp_path / "runs"
    run = write_legacy_run(runs_root, "20260810-000001", question_id=3)
    (run / "exit.json").write_text(json.dumps({"exitCode": 1}), encoding="utf-8")
    (run / "verification.json").write_text(json.dumps({"ok": True}), encoding="utf-8")

    assert passed_question_runs(runs_root) == {}


async def test_a_legacy_completed_question_is_skipped_by_the_batch(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    write_legacy_run(tmp_path / "runs", "20260810-000012", question_id=61)
    calls = stub_runner(monkeypatch)

    outcomes = await run_batch([61], tmp_path)

    assert calls == []
    assert outcomes[0].status == "skipped"
    assert "20260810-000012" in outcomes[0].detail


async def test_a_question_with_a_passed_run_is_skipped_and_a_failed_one_is_rerun(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Resumability is the whole point: 125 questions cost real money, so successes are never redone."""
    runs_root = tmp_path / "runs"
    write_run(runs_root, "20260810-000001", question_id=3, exit_code=0)
    write_run(runs_root, "20260810-000002", question_id=4, exit_code=1)
    calls = stub_runner(monkeypatch)

    outcomes = await run_batch([3, 4], tmp_path)

    assert [(row.question_id, row.status) for row in outcomes] == [(3, "skipped"), (4, "passed")]
    assert [call["question_id"] for call in calls] == [4]
    assert "20260810-000001" in outcomes[0].detail


async def test_questions_run_serially_in_the_order_they_were_asked_for(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Bailian rate-limits; the batch must be one question at a time, in a reproducible order."""
    calls = stub_runner(monkeypatch)

    outcomes = await run_batch([61, 3, 54], tmp_path)

    assert [call["question_id"] for call in calls] == [61, 3, 54]
    assert [row.question_id for row in outcomes] == [61, 3, 54]
    assert {row.status for row in outcomes} == {"passed"}


async def test_the_batch_carries_the_science125_wording_and_the_question_id(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    calls = stub_runner(monkeypatch)

    await run_batch([61], tmp_path)

    assert calls[0]["question_id"] == 61
    assert calls[0]["repoRoot"] == tmp_path.resolve()
    assert calls[0]["runDir"] is None  # Each question reserves its own timestamped run.
    assert "第 61 题" in calls[0]["question"]
    assert "How are pulsars formed?" in calls[0]["question"]


async def test_a_failing_question_is_recorded_and_the_batch_keeps_going(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    calls = stub_runner(monkeypatch, codes={3: 1})

    outcomes = await run_batch([3, 4], tmp_path)

    assert [(row.question_id, row.status) for row in outcomes] == [(3, "failed"), (4, "passed")]
    assert [call["question_id"] for call in calls] == [3, 4]
    assert outcomes[0].detail == "app.cli exit 1"


async def test_a_refusal_to_start_is_visible_as_its_exit_code(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """exit 2 means `app.cli` never started (no credentials, lock held) — a 125-question
    batch that quietly logs 125 "failed" lines in five seconds must still say why."""
    stub_runner(monkeypatch, codes={3: 2})

    outcomes = await run_batch([3], tmp_path)

    assert outcomes[0].detail == "app.cli exit 2"


async def test_one_question_raising_never_takes_down_the_rest_of_the_batch(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """A 125-question production run must survive a single question's outage."""
    attempted: list[int] = []

    async def exploding_run_cli(question: str, repo_root: Path, run_dir: Path | None = None, **options: Any) -> int:
        question_id = options["question_id"]
        attempted.append(question_id)
        if question_id == 3:
            raise TimeoutError("arXiv 无响应")
        return 0

    monkeypatch.setattr(batch_module, "run_cli", exploding_run_cli)

    outcomes = await run_batch([3, 4], tmp_path)

    assert attempted == [3, 4]
    assert [(row.question_id, row.status) for row in outcomes] == [(3, "error"), (4, "passed")]
    assert "TimeoutError" in outcomes[0].detail and "arXiv" in outcomes[0].detail


def stub_classified_runner(
    monkeypatch: pytest.MonkeyPatch, runs_root: Path, classifications: dict[int, str]
) -> list[int]:
    """Fails the listed questions the way the Harness does: a settled run dir carrying its class."""
    attempted: list[int] = []

    async def fake_run_cli(question: str, repo_root: Path, run_dir: Path | None = None, **options: Any) -> int:
        question_id = options["question_id"]
        attempted.append(question_id)
        classification = classifications.get(question_id)
        if classification is None:
            return 0
        run = runs_root / f"20260811-{question_id:06d}"
        run.mkdir(parents=True)
        (run / "meta.json").write_text(json.dumps({"questionId": question_id}), encoding="utf-8")
        (run / "exit.json").write_text(
            json.dumps({"exitCode": 1, "classification": classification}), encoding="utf-8"
        )
        return 1

    monkeypatch.setattr(batch_module, "run_cli", fake_run_cli)
    return attempted


async def test_five_consecutive_failures_of_one_class_stop_the_batch(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """Per-question independence is what makes a batch worth running; a same-class streak refutes it."""
    attempted = stub_classified_runner(
        monkeypatch, tmp_path / "runs", dict.fromkeys(range(1, 9), "contract_violation")
    )

    outcomes = await run_batch(list(range(1, 9)), tmp_path)

    assert attempted == [1, 2, 3, 4, 5]
    assert len(outcomes) == 5
    stop = next(line for line in capsys.readouterr().out.splitlines() if "熔断" in line)
    assert "contract_violation" in stop and "5/8" in stop and "6,7,8" in stop


async def test_two_consecutive_infrastructure_failures_stop_the_batch_at_once(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Credentials, network, or quota: question 3 through 125 would fail exactly the same way."""
    attempted = stub_classified_runner(monkeypatch, tmp_path / "runs", dict.fromkeys(range(1, 6), "infra_error"))

    outcomes = await run_batch(list(range(1, 6)), tmp_path)

    assert attempted == [1, 2]
    assert [row.classification for row in outcomes] == ["infra_error", "infra_error"]


async def test_a_refusal_to_start_twice_in_a_row_is_treated_as_an_outage(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """exit 2 writes no run to read a class off, but it is still the environment refusing."""
    stub_runner(monkeypatch, codes=dict.fromkeys(range(1, 6), 2))

    outcomes = await run_batch(list(range(1, 6)), tmp_path)

    assert len(outcomes) == 2
    assert outcomes[0].classification == "infra_error"


async def test_one_success_clears_the_failure_streak(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    classes = dict.fromkeys([1, 2, 3, 4, 6, 7], "verifier_refs")
    attempted = stub_classified_runner(monkeypatch, tmp_path / "runs", classes)

    outcomes = await run_batch([1, 2, 3, 4, 5, 6, 7], tmp_path)

    assert attempted == [1, 2, 3, 4, 5, 6, 7]
    assert len(outcomes) == 7


async def test_alternating_failure_classes_never_trip_the_streak(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """The breaker fires on one repeated cause, not on a batch that is merely hard."""
    classes = {index: ("verifier_refs" if index % 2 else "contract_violation") for index in range(1, 9)}
    attempted = stub_classified_runner(monkeypatch, tmp_path / "runs", classes)

    await run_batch(list(range(1, 9)), tmp_path)

    assert attempted == list(range(1, 9))


async def test_the_final_tally_groups_failures_by_classification(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """After 125 questions the histogram is the only thing that says what to rerun and what to fix."""
    stub_classified_runner(
        monkeypatch, tmp_path / "runs", {1: "verifier_refs", 2: "verifier_refs", 3: "contract_violation"}
    )

    await run_batch([1, 2, 3, 4], tmp_path)

    summary = capsys.readouterr().out.splitlines()[-1]
    assert "failed/verifier_refs 2" in summary
    assert "failed/contract_violation 1" in summary
    assert "passed 1" in summary


async def test_a_dry_run_executes_nothing_at_all(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """`--dry-run` is the plan review before the money is spent; it must not start a single run."""
    runs_root = tmp_path / "runs"
    write_run(runs_root, "20260810-000001", question_id=3, exit_code=0)
    calls = stub_runner(monkeypatch)

    outcomes = await run_batch([3, 4], tmp_path, dry_run=True)

    assert calls == []
    assert [(row.question_id, row.status) for row in outcomes] == [(3, "skipped"), (4, "planned")]


async def test_an_id_outside_the_question_bank_is_reported_without_being_run(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    calls = stub_runner(monkeypatch)

    outcomes = await run_batch([126], tmp_path)

    assert calls == []
    assert outcomes[0].status == "missing"


async def test_the_memory_off_arm_reaches_every_question(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    calls = stub_runner(monkeypatch)

    await run_batch([3, 4], tmp_path, memory=False)

    assert [call["memory"] for call in calls] == [False, False]


async def test_the_runs_root_that_is_scanned_for_resumption_can_be_pointed_elsewhere(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    elsewhere = tmp_path / "archive"
    write_run(elsewhere, "20260810-000001", question_id=3, exit_code=0)
    calls = stub_runner(monkeypatch)

    outcomes = await run_batch([3], tmp_path, runs_root=elsewhere)

    assert calls == []
    assert outcomes[0].status == "skipped"


async def test_every_question_is_printed_as_it_settles(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """A batch that only speaks at the end is unusable for a run that lasts hours."""
    stub_runner(monkeypatch, codes={4: 1})

    await run_batch([3, 4], tmp_path)

    lines = [line for line in capsys.readouterr().out.splitlines() if line.startswith("[batch]")]
    assert len(lines) == 3
    assert "1/2" in lines[0] and "q3" in lines[0] and "passed" in lines[0] and "s" in lines[0]
    assert "2/2" in lines[1] and "q4" in lines[1] and "failed" in lines[1]
    assert "passed 1" in lines[2] and "failed 1" in lines[2]


def test_main_parses_the_id_spec_and_reports_a_clean_batch_as_zero(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    batch = AsyncMock(return_value=[batch_module.QuestionOutcome(3, "passed", 1.0)])
    monkeypatch.setattr(batch_module, "run_batch", batch)

    code = main(["--ids", "3", "--repo-root", str(tmp_path)])

    assert code == 0
    batch.assert_awaited_once_with([3], tmp_path, runs_root=None, dry_run=False, memory=True)


def test_main_forwards_every_switch_and_fails_the_batch_when_a_question_failed(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    batch = AsyncMock(
        return_value=[
            batch_module.QuestionOutcome(3, "skipped", 0.0),
            batch_module.QuestionOutcome(4, "error", 2.0, "TimeoutError"),
        ]
    )
    monkeypatch.setattr(batch_module, "run_batch", batch)

    code = main(
        [
            "--ids",
            "3-4",
            "--repo-root",
            str(tmp_path),
            "--runs-root",
            str(tmp_path / "archive"),
            "--dry-run",
            "--no-memory",
        ]
    )

    assert code == 1
    batch.assert_awaited_once_with(
        [3, 4], tmp_path, runs_root=tmp_path / "archive", dry_run=True, memory=False
    )


def test_main_rejects_an_unreadable_id_spec_before_spending_anything(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    batch = AsyncMock(return_value=[])
    monkeypatch.setattr(batch_module, "run_batch", batch)

    code = main(["--ids", "5-1"])

    assert code == 2
    batch.assert_not_awaited()
    assert "5-1" in capsys.readouterr().out


def test_main_defaults_the_repo_root_to_the_parent_of_the_backend_working_directory(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    batch = AsyncMock(return_value=[])
    monkeypatch.setattr(batch_module, "run_batch", batch)
    (tmp_path / "backend").mkdir()
    monkeypatch.chdir(tmp_path / "backend")

    assert main(["--ids", "3"]) == 0
    batch.assert_awaited_once_with([3], tmp_path, runs_root=None, dry_run=False, memory=True)
