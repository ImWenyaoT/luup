from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from app.agent.orchestrator import Harness
from app.agent.specialists import RevisionRequest, SpecialistResult
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
    def __init__(self, outputs: Sequence[ScientistOutput], review: Review) -> None:
        self.outputs = list(outputs)
        self.review = review
        self.revisions: list[RevisionRequest | None] = []
        self.reviewer_inputs: list[tuple[str, Sequence[Evidence], Proposal]] = []

    async def run_scientist(self, question: str, revision: RevisionRequest | None = None) -> SpecialistResult:
        self.revisions.append(revision)
        return SpecialistResult(output=self.outputs.pop(0), usage={"total_tokens": 12})

    async def run_reviewer(self, question: str, evidence: Sequence[Evidence], proposal: Proposal) -> SpecialistResult:
        self.reviewer_inputs.append((question, evidence, proposal))
        return SpecialistResult(output=self.review, usage={"total_tokens": 8})


class FakeVerifier:
    def __init__(self, ok: bool) -> None:
        self.ok = ok
        self.proposals: list[Proposal] = []

    async def verify(self, current: Proposal, run_dir: Path) -> Mapping[str, Any]:
        self.proposals.append(current)
        return {"ok": self.ok, "failed": [] if self.ok else ["B4.2401.12340"]}


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
