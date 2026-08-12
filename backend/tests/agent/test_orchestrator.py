from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from agents import MaxTurnsExceeded
from agents.usage import Usage

from app.agent.orchestrator import Harness
from app.agent.specialists import ContractViolationError, RevisionRequest, SpecialistResult
from app.agent.tools.runtime import ReviewerSearchRequiredError
from app.domain.contracts import Evidence, Proposal, Review, ReviewFinding, ScientistOutput
from app.services.runs import RunService


def proposal(title: str = "A falsifiable astronomy plan") -> Proposal:
    return Proposal.model_validate(
        {
            "problemStatement": "A concrete and currently unresolved observational limitation in this target scientific domain.",
            "rationale": "A sufficiently detailed causal chain links the saved evidence to a falsifiable hypothesis and its predicted observation.",
            "technicalDetails": "A specific telescope, calibrated data pipeline, and statistical test are required for verification.",
            "datasets": {
                "source": "A real public archival survey with documented observations.",
                "target": "New observations with stated cadence, sensitivity, and selection criteria.",
            },
            "paperTitle": title,
            "paperAbstract": (
                "This abstract explains the background, proposed method, expected result, validation boundary, "
                "and reproducible observation sequence in enough detail to satisfy the artifact contract for this offline test."
            ),
            "methods": "First prepare controls, then calibrate the observation pipeline, fit the mechanism, and evaluate the falsification criterion in a reproducible sequence.",
            "experiments": {
                "baselines": ["baseline"],
                "metrics": ["metric"],
                "design": "Compare the proposed mechanism against a pre-registered baseline across held-out observations.",
            },
            "results": "The analysis specifies a measurable effect, a null outcome that refutes the hypothesis, and a feasibility argument for collecting enough data.",
            "references": [
                {
                    "arxivId": f"2401.1234{i}",
                    "title": f"Paper {i}",
                    "authors": [f"Author {i}"],
                    "year": 2024,
                    "relevance": "supports the causal premise",
                }
                for i in range(5)
            ],
        }
    )


def scientist(title: str = "A falsifiable astronomy plan") -> ScientistOutput:
    return ScientistOutput(
        evidence=[
            Evidence(claim=f"Claim {i}", arxivId=f"2401.1234{i}", relevance="supports the plan") for i in range(5)
        ],
        proposal=proposal(title),
    )


class FakeSpecialists:
    def __init__(self, outputs: Sequence[ScientistOutput], review: Review, *, thinking: bool = False) -> None:
        self.outputs = list(outputs)
        self.review = review
        self.thinking = thinking
        self.revisions: list[RevisionRequest | None] = []
        self.prior_attempts: list[Sequence[str]] = []
        self.reviewer_inputs: list[tuple[str, Sequence[Evidence], Proposal]] = []

    async def run_scientist(
        self, question: str, revision: RevisionRequest | None = None, prior_attempts: Sequence[str] = ()
    ) -> SpecialistResult:
        self.revisions.append(revision)
        self.prior_attempts.append(tuple(prior_attempts))
        return SpecialistResult(output=self.outputs.pop(0), usage={"total_tokens": 12}, thinking=self.thinking)

    async def run_reviewer(self, question: str, evidence: Sequence[Evidence], proposal: Proposal) -> SpecialistResult:
        self.reviewer_inputs.append((question, evidence, proposal))
        return SpecialistResult(output=self.review, usage={"total_tokens": 8}, thinking=self.thinking)


class FakeVerifier:
    def __init__(self, ok: bool, *, infra_error: bool = False) -> None:
        self.ok = ok
        self.infra_error = infra_error
        self.proposals: list[Proposal] = []

    async def verify(self, current: Proposal, run_dir: Path) -> Mapping[str, Any]:
        self.proposals.append(current)
        return {
            "ok": self.ok,
            "failed": [] if self.ok else ["B4.2401.12340"],
            "infraError": self.infra_error,
        }


class ExplodingSpecialists:
    def __init__(self, error: Exception) -> None:
        self.error = error

    async def run_scientist(
        self, question: str, revision: RevisionRequest | None = None, prior_attempts: Sequence[str] = ()
    ) -> SpecialistResult:
        raise self.error

    async def run_reviewer(self, question: str, evidence: Sequence[Evidence], proposal: Proposal) -> SpecialistResult:
        raise self.error


class ReviewerOutage(FakeSpecialists):
    """The Scientist answers; the Reviewer burns its budget and raises."""

    def __init__(self, outputs: Sequence[ScientistOutput], review: Review, error: Exception) -> None:
        super().__init__(outputs, review)
        self.error = error

    async def run_reviewer(self, question: str, evidence: Sequence[Evidence], proposal: Proposal) -> SpecialistResult:
        raise self.error


def passing_review() -> Review:
    return Review(
        verdict="pass", findings=[ReviewFinding(issue="checked", checkedWith="arXiv search")], requiredChanges=[]
    )


async def test_a_specialist_that_raised_still_books_the_tokens_it_burned(tmp_path: Path) -> None:
    """Two of five OOD runs settled with no usage.jsonl at all; the money was spent either way."""
    error = MaxTurnsExceeded("Max turns (19) exceeded")
    error.run_data = SimpleNamespace(  # type: ignore[assignment]
        context_wrapper=SimpleNamespace(usage=Usage(requests=1, input_tokens=40, output_tokens=24, total_tokens=64))
    )
    specialists = ReviewerOutage([scientist()], passing_review(), error)

    outcome = await Harness(specialists, FakeVerifier(ok=True)).run("question", tmp_path / "run")

    assert outcome.status == "failed"
    rows = [json.loads(line) for line in (outcome.run_dir / "usage.jsonl").read_text().splitlines()]
    assert [row["agent"] for row in rows] == ["scientist", "reviewer"]
    assert rows[1]["usage"]["total_tokens"] == 64


async def test_a_rejected_model_answer_is_booked_against_the_specialist_that_produced_it(tmp_path: Path) -> None:
    """A contract violation happens after the tokens are already spent, not instead of spending them."""
    specialists = ExplodingSpecialists(ContractViolationError("模型返回未通过契约校验：...", {"total_tokens": 31}))

    outcome = await Harness(specialists, FakeVerifier(ok=True)).run("question", tmp_path / "run")

    rows = [json.loads(line) for line in (outcome.run_dir / "usage.jsonl").read_text().splitlines()]
    assert rows == [
        {"at": rows[0]["at"], "agent": "scientist", "thinking": rows[0]["thinking"], "usage": {"total_tokens": 31}}
    ]


async def test_a_failure_that_burned_nothing_writes_no_usage_row(tmp_path: Path) -> None:
    """Accounting records what happened; it must not invent a zero-token call."""
    outcome = await Harness(ExplodingSpecialists(RuntimeError("arXiv down")), FakeVerifier(ok=True)).run(
        "question", tmp_path / "run"
    )

    assert not (outcome.run_dir / "usage.jsonl").exists()


async def test_pass_writes_handoff_artifacts_and_never_repairs(tmp_path: Path) -> None:
    review = Review(
        verdict="pass",
        findings=[ReviewFinding(issue="checked", checkedWith="arXiv search: 2401.12340")],
        requiredChanges=[],
    )
    specialists = FakeSpecialists([scientist()], review)
    verifier = FakeVerifier(ok=True)

    outcome = await Harness(specialists, verifier).run("question", tmp_path / "run")

    assert outcome.status == "passed"
    assert specialists.revisions == [None]
    assert len(specialists.reviewer_inputs) == 1
    assert json.loads((outcome.run_dir / "proposal.json").read_text())["paperTitle"] == "A falsifiable astronomy plan"
    assert (outcome.run_dir / "evidence.md").is_file()
    assert (outcome.run_dir / "review.json").is_file()
    assert (outcome.run_dir / "verification.json").is_file()
    assert "# A falsifiable astronomy plan" in (outcome.run_dir / "proposal.md").read_text()
    assert "结果: ALL PASS" in (outcome.run_dir / "verification-report.md").read_text()
    assert not (outcome.run_dir / "FAILED.md").exists()
    assert len((outcome.run_dir / "usage.jsonl").read_text().splitlines()) == 2


async def test_revise_allows_exactly_one_directed_repair_then_verifies_repaired_plan(tmp_path: Path) -> None:
    review = Review(
        verdict="revise",
        findings=[ReviewFinding(issue="missing control", checkedWith="arXiv search: counterexample")],
        requiredChanges=["add a negative control"],
    )
    specialists = FakeSpecialists([scientist("before repair"), scientist("after repair")], review)
    verifier = FakeVerifier(ok=True)

    outcome = await Harness(specialists, verifier).run("question", tmp_path / "run")

    assert outcome.status == "passed"
    assert len(specialists.revisions) == 2
    assert specialists.revisions[0] is None
    assert specialists.revisions[1] is not None
    assert specialists.revisions[1].required_changes == ("add a negative control",)
    assert len(specialists.reviewer_inputs) == 1
    assert verifier.proposals[0].paper_title == "after repair"
    assert json.loads((outcome.run_dir / "proposal.json").read_text())["paperTitle"] == "after repair"
    assert len((outcome.run_dir / "usage.jsonl").read_text().splitlines()) == 3


@pytest.mark.parametrize("thinking", [False, True], ids=["thinking-off", "thinking-on"])
async def test_usage_rows_record_the_thinking_flag_the_specialists_actually_used(
    tmp_path: Path, thinking: bool
) -> None:
    """The Harness may not assert `thinking=True` while the model settings say otherwise."""
    review = Review(
        verdict="pass", findings=[ReviewFinding(issue="checked", checkedWith="arXiv search")], requiredChanges=[]
    )
    specialists = FakeSpecialists([scientist()], review, thinking=thinking)

    outcome = await Harness(specialists, FakeVerifier(ok=True)).run("question", tmp_path / "run")

    rows = [json.loads(line) for line in (outcome.run_dir / "usage.jsonl").read_text().splitlines()]
    assert [row["agent"] for row in rows] == ["scientist", "reviewer"]
    assert all(row["thinking"] is thinking for row in rows)


async def test_verifier_rejection_is_honest_failure_without_a_second_review_or_repair(tmp_path: Path) -> None:
    review = Review(
        verdict="pass", findings=[ReviewFinding(issue="checked", checkedWith="arXiv search")], requiredChanges=[]
    )
    specialists = FakeSpecialists([scientist()], review)

    outcome = await Harness(specialists, FakeVerifier(ok=False)).run("question", tmp_path / "run")

    assert outcome.status == "failed"
    assert outcome.failures == ("B4.2401.12340",)
    assert specialists.revisions == [None]
    assert len(specialists.reviewer_inputs) == 1
    assert "B4.2401.12340" in (outcome.run_dir / "FAILED.md").read_text()
    assert "结果: 1/1 FAILED" in (outcome.run_dir / "verification-report.md").read_text()


async def test_prior_campaign_attempts_are_injected_into_the_opening_scientist_message(tmp_path: Path) -> None:
    """The cross-run dead ends only stop repeating if the first dispatch carries them."""
    review = Review(
        verdict="pass", findings=[ReviewFinding(issue="checked", checkedWith="arXiv search")], requiredChanges=[]
    )
    specialists = FakeSpecialists([scientist()], review)
    attempts = ("[2026-08-10] FAILED | 四通道混合模型 | B2 标题重合度不足",)

    outcome = await Harness(specialists, FakeVerifier(ok=True)).run(
        "question", tmp_path / "run", prior_attempts=attempts
    )

    assert specialists.prior_attempts == [attempts]
    traced = [json.loads(line) for line in (outcome.run_dir / "trace.jsonl").read_text().splitlines()]
    assert traced[0]["payload"]["priorAttempts"] == list(attempts)


async def test_a_repair_that_changes_nothing_fails_closed_instead_of_shipping(tmp_path: Path) -> None:
    """Nobody verified `requiredChanges` were applied; an unchanged proposal is a silent no-op."""
    review = Review(
        verdict="revise",
        findings=[ReviewFinding(issue="missing control", checkedWith="arXiv search: counterexample")],
        requiredChanges=["add a negative control"],
    )
    specialists = FakeSpecialists([scientist("an unchanged plan"), scientist("an unchanged plan")], review)
    verifier = FakeVerifier(ok=True)

    outcome = await Harness(specialists, verifier).run("question", tmp_path / "run")

    assert outcome.status == "failed"
    assert outcome.classification == "revision_no_change"
    assert verifier.proposals == []  # A no-op repair never reaches the deterministic verifier.
    assert "revision_no_change" in (outcome.run_dir / "FAILED.md").read_text(encoding="utf-8")


async def test_the_repair_request_carries_the_reviewer_findings_not_only_the_demands(tmp_path: Path) -> None:
    """`requiredChanges` says what to do; `findings` says what was checked and why it fails."""
    review = Review(
        verdict="revise",
        findings=[ReviewFinding(issue="no negative control", checkedWith="arXiv search: control designs")],
        requiredChanges=["add a negative control"],
    )
    specialists = FakeSpecialists([scientist("before repair"), scientist("after repair")], review)

    outcome = await Harness(specialists, FakeVerifier(ok=True)).run("question", tmp_path / "run")

    assert outcome.status == "passed"
    repair = specialists.revisions[1]
    assert repair is not None
    assert repair.findings == tuple(review.findings)
    traced = [json.loads(line) for line in (outcome.run_dir / "trace.jsonl").read_text().splitlines()]
    revision_input = next(row for row in traced if row["phase"] == "revision_input")
    assert revision_input["payload"]["findings"] == [
        {"issue": "no negative control", "checkedWith": "arXiv search: control designs"}
    ]


async def test_a_reference_rejection_is_classified_apart_from_an_arxiv_outage(tmp_path: Path) -> None:
    """M4 cannot separate environmental from quality failures unless the artifact says which it was."""
    review = Review(
        verdict="pass", findings=[ReviewFinding(issue="checked", checkedWith="arXiv search")], requiredChanges=[]
    )

    quality = await Harness(FakeSpecialists([scientist()], review), FakeVerifier(ok=False)).run(
        "question", tmp_path / "quality"
    )
    outage = await Harness(
        FakeSpecialists([scientist()], review), FakeVerifier(ok=False, infra_error=True)
    ).run("question", tmp_path / "outage")

    assert quality.classification == "verifier_refs"
    assert "verifier_refs" in (quality.run_dir / "FAILED.md").read_text(encoding="utf-8")
    assert outage.classification == "infra_error"
    assert "infra_error" in (outage.run_dir / "FAILED.md").read_text(encoding="utf-8")


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        pytest.param(
            ReviewerSearchRequiredError("Reviewer 必须执行至少一次独立的新 arXiv 检索。"),
            "reviewer_no_new_evidence",
            id="reviewer-brought-no-new-evidence",
        ),
        pytest.param(
            ContractViolationError("模型返回未通过契约校验：..."), "contract_violation", id="uncontracted-model-output"
        ),
        pytest.param(
            MaxTurnsExceeded("Max turns (22) exceeded"), "agent_budget_exhausted", id="agent-burned-its-turn-budget"
        ),
        pytest.param(RuntimeError("arXiv transient failure"), "infra_error", id="anything-else-is-environmental"),
    ],
)
async def test_a_failing_specialist_is_classified_by_its_typed_error(
    tmp_path: Path, error: Exception, expected: str
) -> None:
    outcome = await Harness(ExplodingSpecialists(error), FakeVerifier(ok=True)).run("question", tmp_path / "run")

    assert outcome.status == "failed"
    assert outcome.classification == expected
    assert expected in (outcome.run_dir / "FAILED.md").read_text(encoding="utf-8")


async def test_run_service_recognizes_harness_pass_and_failure(tmp_path: Path) -> None:
    review = Review(
        verdict="pass", findings=[ReviewFinding(issue="checked", checkedWith="arXiv search")], requiredChanges=[]
    )
    passed_id = "20260810-010203"
    failed_id = "20260810-010204"

    await Harness(FakeSpecialists([scientist()], review), FakeVerifier(ok=True)).run(
        "question", tmp_path / passed_id
    )
    await Harness(FakeSpecialists([scientist()], review), FakeVerifier(ok=False)).run(
        "question", tmp_path / failed_id
    )

    service = RunService(tmp_path)
    passed_status = service.status(passed_id)
    failed_status = service.status(failed_id)
    assert passed_status is not None and passed_status["status"] == "passed"
    assert failed_status is not None and failed_status["status"] == "failed"
