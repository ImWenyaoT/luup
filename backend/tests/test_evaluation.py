from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from app.evaluation import (
    VersionCandidate,
    evaluate_runs,
    m9_ranking_eligible,
    main,
    paired_comparison,
    select_version,
)

CALIBRATED_REPORT = "rubric v1.0.0｜judge qwen（thinking=true）\n检出 3 / 4 = 75.0%｜逆序 0"


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


def scored(run_id: str, **changes: object) -> VersionCandidate:
    return candidate(run_id, **{"score": 5.0, "rubric_version": "1.0.0", "judge_model": "qwen", **changes})


def write_run(
    runs_root: Path,
    run_id: str,
    *,
    question_id: int | None = 7,
    passed: bool = True,
    refs: int = 5,
    artifacts: dict[str, str] | None = None,
) -> Path:
    run = runs_root / run_id
    run.mkdir(parents=True)
    header = (
        f"来源：《Science》125 前沿科学问题（Science-125 题库）第 {question_id} 题，天文。\n"
        if question_id is not None
        else ""
    )
    (run / "question.md").write_text(f"{header}问题：Q\n", encoding="utf-8")
    (run / "proposal.json").write_text(json.dumps({"references": [{}] * refs}), encoding="utf-8")
    (run / "proposal.md").write_text("# plan\n", encoding="utf-8")
    (run / "verification-report.md").write_text("结果: ALL PASS\n" if passed else "结果: 1/1 FAILED\n", encoding="utf-8")
    if not passed:
        (run / "FAILED.md").write_text("failed\n", encoding="utf-8")
    for name, text in (artifacts or {}).items():
        (run / name).write_text(text, encoding="utf-8")
    return run


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


@pytest.mark.parametrize(
    "report",
    [
        pytest.param("rubric v1.0.0｜judge qwen 本轮没有报校准数字", id="no-calibration-line"),
        pytest.param("检出 3 / 4 = 75.0%｜逆序 0", id="no-rubric-or-judge-line"),
        pytest.param("rubric v2.0.0｜judge qwen\n检出 3 / 4 = 75.0%｜逆序 0", id="rubric-mismatch"),
        pytest.param("rubric v1.0.0｜judge other\n检出 3 / 4 = 75.0%｜逆序 0", id="judge-mismatch"),
        pytest.param("rubric v1.0.0｜judge qwen\n检出 2 / 4 = 50.0%｜逆序 0", id="detection-below-threshold"),
        pytest.param("rubric v1.0.0｜judge qwen\n检出 3 / 3 = 100.0%｜逆序 0", id="too-few-judgeable-cases"),
        pytest.param("rubric v1.0.0｜judge qwen\n检出 4 / 4 = 100.0%｜逆序 2", id="inversions-present"),
        pytest.param("rubric v1.0.0｜judge qwen\n检出 4 / 4 = 60.0%｜逆序 0", id="reported-rate-below-threshold"),
    ],
)
def test_ranking_is_ineligible_unless_a_report_clears_every_calibration_bar(report: str) -> None:
    """M9 may only rank when a matching calibration report proves the judge detects planted flaws."""
    assert m9_ranking_eligible([scored("a"), scored("b")], [report]) is False


@pytest.mark.parametrize(
    "candidates",
    [
        pytest.param([scored("a"), scored("b", rubric_version="2.0.0")], id="two-rubric-versions"),
        pytest.param([scored("a"), scored("b", judge_model="other")], id="two-judges"),
        pytest.param([candidate("a"), candidate("b")], id="no-scores-at-all"),
    ],
)
def test_ranking_is_ineligible_when_the_scores_are_not_mutually_comparable(
    candidates: list[VersionCandidate],
) -> None:
    """Scores produced by different rubrics or judges are not one scale, so they cannot order versions."""
    assert m9_ranking_eligible(candidates, [CALIBRATED_REPORT]) is False


def test_an_unlabelled_score_rides_along_on_another_runs_rubric_label() -> None:
    """Known fail-open gap, pinned so a fix is a deliberate change.

    `m9_ranking_eligible` drops candidates whose `rubricVersion` is missing before
    counting distinct rubrics, so one labelled run unlocks ranking for the whole
    group and the unlabelled score is then compared as if it shared that rubric.
    """
    candidates = [scored("a"), scored("b", rubric_version=None, score=9.0)]

    assert m9_ranking_eligible(candidates, [CALIBRATED_REPORT]) is True
    assert select_version(candidates, [CALIBRATED_REPORT])["winner"]["runId"] == "b"


def test_no_candidates_has_no_winner_and_says_so() -> None:
    choice = select_version([])

    assert choice["winner"] is None
    assert choice["ranked"] == []
    assert choice["reason"] == "没有候选版本"


def test_every_candidate_failing_the_gate_has_no_winner() -> None:
    """The delivery gate is absolute: a best-of-the-failures is not a deliverable version."""
    choice = select_version([candidate("a", deliverable=False), candidate("b", deliverable=False, score=100)])

    assert choice["winner"] is None
    assert choice["reason"] == "没有版本通过交付 gate"
    assert [row["runId"] for row in choice["eliminated"]] == ["a", "b"]


@pytest.mark.parametrize(
    ("candidates", "reports", "winner", "reason"),
    [
        pytest.param(
            [scored("a", score=1.0), scored("b", score=9.0)],
            [CALIBRATED_REPORT],
            "b",
            "M9 总分更高",
            id="score-decides-first",
        ),
        pytest.param(
            [scored("a", refs=5), scored("b", refs=7)],
            [CALIBRATED_REPORT],
            "b",
            "M9 总分持平，refs 更多",
            id="refs-break-a-score-tie",
        ),
        pytest.param(
            [scored("a", tokens=200), scored("b", tokens=100)],
            [CALIBRATED_REPORT],
            "b",
            "M9 总分与 refs 持平，token 成本更低",
            id="cost-breaks-a-refs-tie",
        ),
        pytest.param(
            [scored("b"), scored("a")],
            [CALIBRATED_REPORT],
            "a",
            "各级全部持平，按 run id 取最早的一版",
            id="run-id-is-the-last-resort",
        ),
        pytest.param(
            [candidate("a", tokens=200), candidate("b", tokens=100)],
            [],
            "b",
            "M9 未达校准阈值，refs 持平，token 成本更低",
            id="uncalibrated-falls-through-to-cost",
        ),
    ],
)
def test_the_tie_break_chain_is_score_then_refs_then_cost_then_run_id(
    candidates: list[VersionCandidate], reports: list[str], winner: str, reason: str
) -> None:
    choice = select_version(candidates, reports)

    assert choice["winner"]["runId"] == winner
    assert choice["reason"] == reason
    assert choice["ranked"][0]["runId"] == winner


@pytest.mark.parametrize("field", ["refs", "tokens", "score"])
def test_an_unmeasured_version_never_outranks_a_measured_one(field: str) -> None:
    """A missing measurement is not a good measurement; it must lose in either argument order."""
    reports = [CALIBRATED_REPORT] if field == "score" else []
    measured = 9.0 if field == "score" else 5

    first = select_version([scored("a", **{field: None}), scored("b", **{field: measured})], reports)
    second = select_version([scored("b", **{field: measured}), scored("a", **{field: None})], reports)

    assert first["winner"]["runId"] == "b"
    assert second["winner"]["runId"] == "b"


def test_a_question_with_a_single_run_is_not_a_pair_and_no_change_is_not_significant() -> None:
    paired = paired_comparison(
        [
            candidate("20260810-000001", question_id=1, deliverable=True),
            candidate("20260810-000002", question_id=1, deliverable=True),
            candidate("20260810-000001", question_id=2, deliverable=False),
            candidate("20260810-000002", question_id=2, deliverable=False),
            candidate("20260810-000001", question_id=3, deliverable=True),
        ]
    )

    assert [row["questionId"] for row in paired["questions"]] == [1, 2]
    assert paired["discordant"] == 0
    assert paired["p"] == 1.0
    assert paired["significant"] is False
    assert paired["concordantPass"] == 1
    assert paired["concordantFail"] == 1


def test_six_one_sided_repairs_are_a_significant_improvement() -> None:
    """The McNemar tail is the claim we can defend in the report; six clean repairs clear p<0.05."""
    candidates = [
        item
        for question_id in range(1, 7)
        for item in (
            candidate(f"20260810-{question_id}00001", question_id=question_id, deliverable=False),
            candidate(f"20260810-{question_id}00002", question_id=question_id, deliverable=True),
        )
    ]

    paired = paired_comparison(candidates)

    assert (paired["b"], paired["c"]) == (6, 0)
    assert paired["p"] == pytest.approx(0.03125)
    assert paired["significant"] is True


def test_score_artifacts_drive_the_ranking_and_the_veto_stays_advisory(tmp_path: Path) -> None:
    """A fabrication veto is a diagnostic annotation, not a second delivery gate."""
    write_run(
        tmp_path,
        "20260810-000001",
        artifacts={
            "score.json": json.dumps(
                {"weighted": 9.5, "rubricVersion": "1.0.0", "judgeModel": "qwen", "veto": {"triggered": True}}
            ),
            "calibration.md": CALIBRATED_REPORT,
        },
    )
    write_run(
        tmp_path,
        "20260810-000002",
        artifacts={"score.json": json.dumps({"weighted": 1.0, "rubricVersion": "1.0.0", "judgeModel": "qwen"})},
    )

    selection = evaluate_runs(tmp_path)["versions"]["7"]

    assert selection["m9Eligible"] is True
    assert selection["winner"]["runId"] == "20260810-000001"
    assert selection["winner"]["score"] == 9.5
    assert selection["reason"] == "M9 总分更高"
    assert selection["advisories"] == [{"runId": "20260810-000001", "note": "M9 报了虚构类断言 veto（诊断，不影响择优）"}]


@pytest.mark.parametrize(
    "score_text",
    [
        pytest.param("not json at all", id="unparsable"),
        pytest.param("[1, 2, 3]", id="json-but-not-an-object"),
        pytest.param('{"weighted": true}', id="boolean-score"),
        pytest.param('{"weighted": Infinity}', id="non-finite-score"),
        pytest.param('{"weighted": "9.5"}', id="stringified-score"),
    ],
)
def test_an_unusable_score_artifact_leaves_the_run_unscored(tmp_path: Path, score_text: str) -> None:
    """Ranking must fall back to the deterministic criteria rather than trust a broken score file."""
    write_run(tmp_path, "20260810-000001", refs=6, artifacts={"score.json": score_text, "calibration.md": CALIBRATED_REPORT})
    write_run(tmp_path, "20260810-000002", refs=5, artifacts={"score.json": score_text})

    selection = evaluate_runs(tmp_path)["versions"]["7"]

    assert selection["m9Eligible"] is False
    assert selection["winner"]["score"] is None
    assert selection["winner"]["runId"] == "20260810-000001"
    assert selection["reason"] == "M9 未达校准阈值，refs 更多"


def test_an_unlabelled_rubric_or_judge_is_not_carried_into_the_candidate(tmp_path: Path) -> None:
    write_run(
        tmp_path,
        "20260810-000001",
        artifacts={"score.json": json.dumps({"weighted": 9.5, "rubricVersion": 100, "judgeModel": ""})},
    )
    write_run(tmp_path, "20260810-000002", refs=4)

    winner = evaluate_runs(tmp_path)["versions"]["7"]["winner"]

    assert winner["score"] == 9.5
    assert winner["rubricVersion"] is None
    assert winner["judgeModel"] is None


def test_token_cost_sums_usage_rows_and_ignores_unusable_ones(tmp_path: Path) -> None:
    """usage.jsonl is append-only evidence written per model call; one bad row must not void the total."""
    usage = "\n".join(
        [
            json.dumps({"agent": "scientist", "usage": {"total_tokens": 100}}),
            json.dumps({"agent": "reviewer", "usage": {"totalTokens": 50}}),
            json.dumps({"agent": "scientist", "usage": {"total_tokens": True}}),
            json.dumps({"agent": "scientist", "usage": {"total_tokens": "90"}}),
            json.dumps({"agent": "scientist", "usage": []}),
            json.dumps({"agent": "scientist"}),
            "{ truncated row",
            "",
        ]
    )
    write_run(tmp_path, "20260810-000001", artifacts={"usage.jsonl": usage})
    write_run(tmp_path, "20260810-000002", artifacts={"usage.jsonl": "{ truncated row\n"})

    ranked = evaluate_runs(tmp_path)["versions"]["7"]["ranked"]

    assert {row["runId"]: row["tokens"] for row in ranked} == {"20260810-000001": 150, "20260810-000002": None}
    assert ranked[0]["runId"] == "20260810-000001"


def test_a_run_without_a_science125_id_is_not_a_candidate(tmp_path: Path) -> None:
    """Version selection compares answers to the same question; an unlabelled run has no comparison group."""
    write_run(tmp_path, "20260810-000001")
    write_run(tmp_path, "20260810-000002")
    write_run(tmp_path, "20260810-000003", question_id=None)

    report = evaluate_runs(tmp_path)

    assert [row["runId"] for row in report["versions"]["7"]["ranked"]] == ["20260810-000001", "20260810-000002"]
    assert len(report["versions"]) == 1
    assert report["pairedComparison"]["questions"] == [
        {
            "questionId": 7,
            "earlier": "20260810-000001",
            "later": "20260810-000002",
            "earlierPass": True,
            "laterPass": True,
        }
    ]


def test_evaluation_cli_writes_the_same_report_it_prints(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    runs_root = tmp_path / "runs"
    write_run(runs_root, "20260810-000001")
    write_run(runs_root, "20260810-000002", passed=False)
    output = tmp_path / "reports" / "selection.json"

    code = main(["--runs-root", str(runs_root), "--output", str(output)])

    printed: dict[str, Any] = json.loads(capsys.readouterr().out)
    assert code == 0
    assert json.loads(output.read_text(encoding="utf-8")) == printed
    assert printed["source"] == str(runs_root.resolve())
    assert printed["versions"]["7"]["winner"]["runId"] == "20260810-000001"
