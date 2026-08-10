from __future__ import annotations

import json
from pathlib import Path

from app.evaluation import VersionCandidate, evaluate_runs, m9_ranking_eligible, paired_comparison, select_version


def candidate(run_id: str, question_id: int = 1, **changes: object) -> VersionCandidate:
    values: dict[str, object] = {
        "run_id": run_id,
        "question_id": question_id,
        "deliverable": True,
        "refs": 5,
        "tokens": 100,
        **changes,
    }
    return VersionCandidate(**values)  # type: ignore[arg-type]


def test_selection_is_gate_first_and_fail_closed_without_calibration() -> None:
    choice = select_version(
        [
            candidate("b", deliverable=False, score=99, refs=99),
            candidate("a", score=1, refs=7, veto=True),
            candidate("c", score=100, refs=5),
        ]
    )

    assert choice["winner"]["runId"] == "a"
    assert choice["reason"] == "M9 未达校准阈值，refs 更多"
    assert choice["eliminated"] == [
        {"runId": "b", "reason": "未通过交付 gate（runOutcome 判定不可交付）"}
    ]
    assert choice["advisories"][0]["runId"] == "a"


def test_calibrated_score_can_rank_and_pairing_uses_first_and_last() -> None:
    reports = ["rubric v1.0.0｜judge qwen（thinking=true）\n检出 3 / 4 = 75.0%｜逆序 0"]
    versions = [
        candidate("20260810-000001", score=1, rubric_version="1.0.0", judge_model="qwen"),
        candidate("20260810-000002", score=9, rubric_version="1.0.0", judge_model="qwen"),
    ]

    assert m9_ranking_eligible(versions, reports)
    assert select_version(versions, reports)["winner"]["runId"] == "20260810-000002"
    paired = paired_comparison([versions[0], versions[1], candidate("20260810-000003", deliverable=False)])
    assert paired["questions"][0]["later"] == "20260810-000003"
    assert paired["c"] == 1
    assert paired["p"] == 1


def test_file_entry_reads_runs_and_preserves_unknown_cost_as_null(tmp_path: Path) -> None:
    for run_id, passed, refs in [("20260810-000001", False, 5), ("20260810-000002", True, 6)]:
        run = tmp_path / run_id
        run.mkdir()
        (run / "question.md").write_text("来源：《Science》125 前沿科学问题（Science-125 题库）第 7 题，天文。\n问题：Q\n")
        (run / "meta.json").write_text(json.dumps({"questionId": 7}))
        (run / "proposal.json").write_text(json.dumps({"references": [{}] * refs}))
        (run / "proposal.md").write_text("# plan\n")
        (run / "verification-report.md").write_text("结果: ALL PASS\n" if passed else "结果: 1/1 FAILED\n")
        if not passed:
            (run / "FAILED.md").write_text("failed\n")

    report = evaluate_runs(tmp_path)

    assert report["versions"]["7"]["winner"]["runId"] == "20260810-000002"
    assert report["versions"]["7"]["winner"]["tokens"] is None
    assert report["pairedComparison"]["b"] == 1
