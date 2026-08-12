from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from app.evaluation import (
    RunFacts,
    delivery_rate,
    evaluate_runs,
    failure_classes,
    main,
    paired_comparison,
    pass_squared,
    revision_rate,
    search_health,
    select_version,
)


def candidate(run_id: str, question_id: int = 1, **changes: object) -> RunFacts:
    values: dict[str, object] = {
        "run_id": run_id,
        "question_id": question_id,
        "deliverable": True,
        "refs": 5,
        "tokens": 100,
        **changes,
    }
    return RunFacts(**values)  # type: ignore[arg-type]


# --- version selection (M9/M10 retired 2026-08-11: the chain is deterministic) ------------------


def test_selection_is_gate_first_then_refs() -> None:
    choice = select_version(
        [candidate("b", deliverable=False, refs=99), candidate("a", refs=7), candidate("c", refs=5)]
    )

    assert choice["winner"]["runId"] == "a"
    assert choice["reason"] == "refs 更多"
    assert choice["eliminated"] == [{"runId": "b", "reason": "未通过交付 gate（runOutcome 判定不可交付）"}]


def test_no_candidates_has_no_winner_and_says_so() -> None:
    choice = select_version([])

    assert choice["winner"] is None
    assert choice["ranked"] == []
    assert choice["reason"] == "没有候选版本"


def test_every_candidate_failing_the_gate_has_no_winner() -> None:
    """The delivery gate is absolute: a best-of-the-failures is not a deliverable version."""
    choice = select_version([candidate("a", deliverable=False), candidate("b", deliverable=False, refs=99)])

    assert choice["winner"] is None
    assert choice["reason"] == "没有版本通过交付 gate"
    assert [row["runId"] for row in choice["eliminated"]] == ["a", "b"]


def test_a_retired_judge_score_can_no_longer_appear_in_the_report(
    tmp_path: Path, write_run: Callable[..., Path]
) -> None:
    """M9/M10 were retired, so their fields must be gone rather than present and empty."""
    write_run(
        tmp_path,
        "20260810-000001",
        artifacts={
            "score.json": json.dumps({"weighted": 9.5, "rubricVersion": "1.0.0", "judgeModel": "qwen"}),
            "calibration.md": "rubric v1.0.0｜judge qwen\n检出 4 / 4 = 100.0%｜逆序 0",
        },
    )
    write_run(tmp_path, "20260810-000002", refs=9)

    report = evaluate_runs(tmp_path)
    selection = report["versions"]["7"]

    assert selection["winner"]["runId"] == "20260810-000002"  # A perfect score no longer outranks refs.
    assert selection["reason"] == "refs 更多"
    assert set(selection) == {"winner", "ranked", "reason", "eliminated"}
    assert set(selection["winner"]) == {"runId", "questionId", "deliverable", "refs", "tokens"}


@pytest.mark.parametrize(
    ("candidates", "winner", "reason"),
    [
        pytest.param([candidate("a", refs=5), candidate("b", refs=7)], "b", "refs 更多", id="refs-decide-first"),
        pytest.param(
            [candidate("a", tokens=200), candidate("b", tokens=100)],
            "b",
            "refs 持平，token 成本更低",
            id="cost-breaks-a-refs-tie",
        ),
        pytest.param(
            [candidate("b"), candidate("a")],
            "a",
            "各级全部持平，按 run id 取最早的一版",
            id="run-id-is-the-last-resort",
        ),
    ],
)
def test_the_tie_break_chain_is_refs_then_cost_then_run_id(
    candidates: list[RunFacts], winner: str, reason: str
) -> None:
    choice = select_version(candidates)

    assert choice["winner"]["runId"] == winner
    assert choice["reason"] == reason
    assert choice["ranked"][0]["runId"] == winner


@pytest.mark.parametrize("field", ["refs", "tokens"])
def test_an_unmeasured_version_never_outranks_a_measured_one(field: str) -> None:
    """A missing measurement is not a good measurement; it must lose in either argument order."""
    first = select_version([candidate("a", **{field: None}), candidate("b", **{field: 5})])
    second = select_version([candidate("b", **{field: 5}), candidate("a", **{field: None})])

    assert first["winner"]["runId"] == "b"
    assert second["winner"]["runId"] == "b"


def test_token_cost_sums_usage_rows_and_ignores_unusable_ones(
    tmp_path: Path, write_run: Callable[..., Path]
) -> None:
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


def test_file_entry_reads_runs_and_preserves_unknown_cost_as_null(
    tmp_path: Path, write_run: Callable[..., Path]
) -> None:
    """No usage.jsonl anywhere: an unmeasured cost stays null instead of being read as a free run."""
    write_run(tmp_path, "20260810-000001", passed=False, refs=5)
    write_run(tmp_path, "20260810-000002", passed=True, refs=6)

    report = evaluate_runs(tmp_path)

    assert report["versions"]["7"]["winner"]["runId"] == "20260810-000002"
    assert report["versions"]["7"]["winner"]["tokens"] is None
    assert report["pairedComparison"]["firstVsLatest"]["b"] == 1


# --- M11 paired comparison ---------------------------------------------------------------------


def test_a_question_with_a_single_run_is_not_a_pair_and_no_change_is_not_significant() -> None:
    paired = paired_comparison(
        [
            candidate("20260810-000001", question_id=1, deliverable=True),
            candidate("20260810-000002", question_id=1, deliverable=True),
            candidate("20260810-000001", question_id=2, deliverable=False),
            candidate("20260810-000002", question_id=2, deliverable=False),
            candidate("20260810-000001", question_id=3, deliverable=True),
        ]
    )["firstVsLatest"]

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

    paired = paired_comparison(candidates)["firstVsLatest"]

    assert (paired["b"], paired["c"]) == (6, 0)
    assert paired["p"] == pytest.approx(0.03125)
    assert paired["significant"] is True


def test_first_versus_latest_is_named_for_what_it_actually_compares() -> None:
    """Two runs a week apart differ by every change in between; the key must not claim otherwise."""
    paired = paired_comparison(
        [
            candidate("20260810-000001", deliverable=False),
            candidate("20260810-000002", deliverable=True),
            candidate("20260810-000003", deliverable=False),
        ]
    )

    assert set(paired) == {"firstVsLatest", "memoryArms"}
    row = paired["firstVsLatest"]["questions"][0]
    assert (row["earlier"], row["later"]) == ("20260810-000001", "20260810-000003")
    assert paired["memoryArms"] is None  # No question ran both arms, so there is nothing to pair.


def test_two_memory_arms_on_the_same_question_are_paired_by_arm() -> None:
    """The ablation is the only controlled pairing in the campaign; it must not be diluted."""
    candidates = [
        item
        for question_id in range(1, 4)
        for item in (
            candidate(f"20260810-{question_id}00001", question_id=question_id, deliverable=False, memory_arm="off"),
            candidate(f"20260810-{question_id}00002", question_id=question_id, deliverable=True, memory_arm="on"),
        )
    ]

    arms = paired_comparison(candidates)["memoryArms"]

    assert [row["questionId"] for row in arms["questions"]] == [1, 2, 3]
    assert arms["questions"][0]["off"] == "20260810-100001"
    assert arms["questions"][0]["on"] == "20260810-100002"
    assert (arms["b"], arms["c"]) == (3, 0)
    assert arms["p"] == pytest.approx(0.25)  # Exact binomial, not χ²: three pairs prove nothing yet.
    assert arms["significant"] is False


def test_a_question_that_only_ran_one_arm_contributes_no_arm_pair() -> None:
    arms = paired_comparison(
        [
            candidate("20260810-000001", question_id=1, memory_arm="on"),
            candidate("20260810-000002", question_id=1, memory_arm="on"),
            candidate("20260810-000003", question_id=2, memory_arm="off", deliverable=False),
            candidate("20260810-000004", question_id=2, memory_arm="on"),
        ]
    )["memoryArms"]

    assert [row["questionId"] for row in arms["questions"]] == [2]
    assert arms["b"] == 1


# --- Tier1 aggregates --------------------------------------------------------------------------


def test_delivery_rate_carries_its_standard_error_and_separates_outages() -> None:
    """M4 read as a quality number while outages are folded in is a wrong number."""
    facts = [
        candidate("a", deliverable=True),
        candidate("b", deliverable=True),
        candidate("c", deliverable=False, classification="verifier_refs"),
        candidate("d", deliverable=False, classification="infra_timeout"),
    ]

    rate = delivery_rate(facts)

    assert (rate["runs"], rate["deliverable"], rate["rate"]) == (4, 2, 0.5)
    assert rate["se"] == pytest.approx(0.25)
    assert rate["excludingInfrastructure"]["runs"] == 3
    assert rate["excludingInfrastructure"]["rate"] == pytest.approx(2 / 3)


def test_an_empty_campaign_reports_no_rate_rather_than_a_zero() -> None:
    assert delivery_rate([])["rate"] is None
    assert pass_squared([])["rate"] is None
    assert revision_rate([])["rate"] is None
    assert search_health([])["newInformationRate"] is None


def test_pass_squared_counts_adjacent_same_question_pairs_in_time_order() -> None:
    """M5 asks whether the pipeline can do it twice running, not whether it ever did it once."""
    facts = [
        candidate("20260810-000003", question_id=1, deliverable=True),
        candidate("20260810-000001", question_id=1, deliverable=True),
        candidate("20260810-000002", question_id=1, deliverable=False),
        candidate("20260810-000001", question_id=2, deliverable=True),
        candidate("20260810-000002", question_id=2, deliverable=True),
        candidate("20260810-000001", question_id=3, deliverable=True),
    ]

    squared = pass_squared(facts)

    assert (squared["pairs"], squared["both"]) == (3, 1)
    assert squared["rate"] == pytest.approx(1 / 3)


def test_revision_rate_only_counts_runs_that_actually_reached_the_reviewer() -> None:
    facts = [
        candidate("a", reviewed=True, revised=True),
        candidate("b", reviewed=True, revised=False),
        candidate("c"),
    ]

    assert revision_rate(facts) == {"reviewed": 2, "revised": 1, "rate": 0.5, "se": pytest.approx(0.35355339059)}


def test_search_health_reports_yield_per_search_not_per_run() -> None:
    facts = [
        candidate("a", searches=4, deduplicated_searches=1, new_information_searches=2, refs=6),
        candidate("b", searches=6, deduplicated_searches=1, new_information_searches=1, refs=4),
        candidate("c", searches=0, refs=None),
    ]

    health = search_health(facts)

    assert (health["runsWithSearchEvents"], health["searches"]) == (2, 10)
    assert health["deduplicatedRate"] == pytest.approx(0.2)
    assert health["newInformationRate"] == pytest.approx(0.3)
    assert health["refsMean"] == pytest.approx(5.0)


def test_failure_classes_keep_outages_apart_from_quality_verdicts() -> None:
    facts = [
        candidate("a", deliverable=True),
        candidate("b", deliverable=False, classification="verifier_refs"),
        candidate("c", deliverable=False, classification="verifier_refs"),
        candidate("d", deliverable=False, classification="reviewer_no_new_evidence"),
        candidate("e", deliverable=False, classification="infra_timeout"),
        candidate("f", deliverable=False),
        candidate("g", deliverable=False, classification="agent_budget_exhausted"),
    ]

    classes = failure_classes(facts)

    assert classes["failed"] == 6
    # A burned turn budget is the agent's behaviour, not an outage, so it groups with quality.
    assert classes["quality"] == {
        "count": 4,
        "byClass": {"agent_budget_exhausted": 1, "reviewer_no_new_evidence": 1, "verifier_refs": 2},
    }
    assert classes["infrastructure"] == {"count": 1, "byClass": {"infra_timeout": 1}}
    assert classes["unclassified"] == 1


def test_the_statistics_block_is_derived_from_the_artifacts_on_disk(
    tmp_path: Path, write_run: Callable[..., Path]
) -> None:
    """Every aggregate must come out of files a finished run already wrote — zero new collection."""
    write_run(
        tmp_path,
        "20260810-000001",
        artifacts={
            "review.json": json.dumps({"verdict": "revise", "findings": [], "requiredChanges": []}),
            "meta.json": json.dumps({"questionId": 7, "memoryArm": "on"}),
            "tool-events.jsonl": "\n".join(
                [
                    json.dumps({"tool": "arxiv_search", "newCount": 3, "deduplicated": False}),
                    json.dumps({"tool": "arxiv_search", "newCount": 0, "deduplicated": True}),
                    json.dumps({"tool": "memory_search", "hitCount": 2}),
                    "{ truncated",
                ]
            ),
        },
    )
    write_run(
        tmp_path,
        "20260810-000002",
        passed=False,
        artifacts={
            "review.json": json.dumps({"verdict": "pass", "findings": [], "requiredChanges": []}),
            "meta.json": json.dumps({"questionId": 7, "memoryArm": "off"}),
            "exit.json": json.dumps({"exitCode": 1, "classification": "infra_timeout"}),
        },
    )

    report = evaluate_runs(tmp_path)
    statistics = report["statistics"]

    assert report["runs"] == 2
    assert statistics["delivery"]["rate"] == 0.5
    assert statistics["delivery"]["excludingInfrastructure"] == {"runs": 1, "deliverable": 1, "rate": 1.0, "se": 0.0}
    assert statistics["passSquared"] == {"pairs": 1, "both": 0, "rate": 0.0, "se": 0.0}
    assert statistics["revision"]["revised"] == 1 and statistics["revision"]["reviewed"] == 2
    assert statistics["searchHealth"]["searches"] == 2  # memory_search is not a literature search.
    assert statistics["searchHealth"]["deduplicatedRate"] == 0.5
    assert statistics["searchHealth"]["newInformationRate"] == 0.5
    assert statistics["failureClasses"]["infrastructure"]["byClass"] == {"infra_timeout": 1}
    assert report["pairedComparison"]["memoryArms"]["b"] == 1  # memory on passed where memory off failed


def test_the_statistics_say_which_code_version_produced_them(
    tmp_path: Path, write_run: Callable[..., Path]
) -> None:
    """Derived, not declared: the cohort is read off the runs, so no doc can claim the wrong one."""
    write_run(
        tmp_path,
        "20260810-000001",
        artifacts={
            "exit.json": json.dumps(
                {"exitCode": 0, "sourceIdentity": {"gitCommit": "abc123", "treeDirty": False}}
            )
        },
    )
    write_run(
        tmp_path,
        "20260810-000002",
        question_id=8,
        passed=False,
        artifacts={
            "exit.json": json.dumps(
                {"exitCode": 1, "sourceIdentity": {"gitCommit": "abc123", "treeDirty": True}}
            )
        },
    )
    # The committed pre-2026-08-10 runs have no exit.json at all — that is what "unknown" is for.
    write_run(tmp_path, "20260810-000003", question_id=9, artifacts={"exit.json": None})

    cohorts = evaluate_runs(tmp_path)["statistics"]["sourceIdentity"]

    assert set(cohorts) == {"abc123", "abc123+dirty", "unknown"}
    assert cohorts["abc123"]["runs"] == 1 and cohorts["abc123"]["deliverable"] == 1
    assert cohorts["abc123+dirty"]["deliverable"] == 0
    assert cohorts["unknown"]["runs"] == 1


def test_a_free_form_run_counts_in_the_campaign_rates_but_not_in_the_pairings(
    tmp_path: Path, write_run: Callable[..., Path]
) -> None:
    """OOD runs have no question id, so they can be summed but never compared version-to-version."""
    write_run(tmp_path, "20260810-000001")
    write_run(tmp_path, "20260810-000002")
    write_run(tmp_path, "20260810-000003", question_id=None, passed=False)

    report = evaluate_runs(tmp_path)

    assert report["runs"] == 3
    assert report["statistics"]["delivery"]["runs"] == 3
    assert [row["runId"] for row in report["versions"]["7"]["ranked"]] == ["20260810-000001", "20260810-000002"]
    assert len(report["versions"]) == 1
    assert report["pairedComparison"]["firstVsLatest"]["questions"] == [
        {
            "questionId": 7,
            "earlier": "20260810-000001",
            "later": "20260810-000002",
            "earlierPass": True,
            "laterPass": True,
        }
    ]


def test_evaluation_cli_writes_the_same_report_it_prints(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], write_run: Callable[..., Path]
) -> None:
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
