"""Campaign-memory write-back: deterministic, append-only, and zero LLM by construction."""

from __future__ import annotations

import json
from pathlib import Path

from app.agent.campaign import read_prior_attempts, record_run


def write_proposal(run_dir: Path, title: str, ids: list[str]) -> None:
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "proposal.json").write_text(
        json.dumps({"paperTitle": title, "references": [{"arxivId": item} for item in ids]}, ensure_ascii=False),
        encoding="utf-8",
    )


def test_a_passed_run_appends_one_line_to_the_question_page_and_the_log(tmp_path: Path) -> None:
    memory = tmp_path / "memory"
    memory.mkdir()
    run_dir = tmp_path / "runs" / "20260811-010203"
    write_proposal(run_dir, "Four-Channel Pulsar Formation", ["2205.03989", "0704.1215"])

    record_run(memory, run_dir=run_dir, question_id=61, status="passed", classification=None)

    page = (memory / "questions" / "q61.md").read_text(encoding="utf-8")
    entries = [line for line in page.splitlines() if line.startswith("- [")]
    assert len(entries) == 1
    assert "SUCCESS" in entries[0]
    assert "20260811-010203" in entries[0]
    assert "Four-Channel Pulsar Formation" in entries[0]
    assert "2205.03989, 0704.1215" in entries[0]
    log = (memory / "log.md").read_text(encoding="utf-8")
    assert "run | q61 | SUCCESS" in log


def test_a_failed_run_records_its_classification_rather_than_a_winning_title(tmp_path: Path) -> None:
    memory = tmp_path / "memory"
    memory.mkdir()
    run_dir = tmp_path / "runs" / "20260811-010204"
    run_dir.mkdir(parents=True)

    record_run(memory, run_dir=run_dir, question_id=61, status="failed", classification="verifier_refs")

    entry = next(
        line
        for line in (memory / "questions" / "q61.md").read_text(encoding="utf-8").splitlines()
        if line.startswith("- [")
    )
    assert "FAILED" in entry
    assert "verifier_refs" in entry
    assert "run | q61 | FAILED" in (memory / "log.md").read_text(encoding="utf-8")


def test_writes_are_append_only_across_runs(tmp_path: Path) -> None:
    memory = tmp_path / "memory"
    memory.mkdir()
    first = tmp_path / "runs" / "20260811-010203"
    second = tmp_path / "runs" / "20260811-010204"
    write_proposal(first, "First winning plan", ["2205.03989"])
    write_proposal(second, "Second winning plan", ["0704.1215"])

    record_run(memory, run_dir=first, question_id=61, status="passed", classification=None)
    record_run(memory, run_dir=second, question_id=61, status="passed", classification=None)

    page = (memory / "questions" / "q61.md").read_text(encoding="utf-8")
    assert "First winning plan" in page and "Second winning plan" in page
    assert page.index("First winning plan") < page.index("Second winning plan")
    assert len([line for line in (memory / "log.md").read_text(encoding="utf-8").splitlines() if line.startswith("## [")]) == 2


def test_a_run_without_a_question_id_writes_only_the_log(tmp_path: Path) -> None:
    memory = tmp_path / "memory"
    memory.mkdir()
    run_dir = tmp_path / "runs" / "20260811-010203"
    write_proposal(run_dir, "A free form plan", ["2205.03989"])

    record_run(memory, run_dir=run_dir, question_id=None, status="passed", classification=None)

    assert not (memory / "questions").exists()
    assert "run | q- | SUCCESS" in (memory / "log.md").read_text(encoding="utf-8")


def test_the_memory_off_arm_writes_nothing_at_all(tmp_path: Path) -> None:
    run_dir = tmp_path / "runs" / "20260811-010203"
    write_proposal(run_dir, "A plan produced with memory off", ["2205.03989"])

    record_run(None, run_dir=run_dir, question_id=61, status="passed", classification=None)

    assert not (tmp_path / "memory").exists()


def test_prior_attempts_are_the_last_entries_of_this_question_page(tmp_path: Path) -> None:
    memory = tmp_path / "memory"
    (memory / "questions").mkdir(parents=True)
    (memory / "questions" / "q61.md").write_text(
        "# q61\n\n- [1] oldest\n- [2] middle\n- [3] newest\n\n## [2026-08-08] 旧格式条目\n- verdict: ALL PASS\n",
        encoding="utf-8",
    )

    assert read_prior_attempts(memory, 61, limit=2) == ("- [2] middle", "- [3] newest")
    assert read_prior_attempts(memory, 99) == ()
    assert read_prior_attempts(memory, None) == ()
    assert read_prior_attempts(None, 61) == ()
