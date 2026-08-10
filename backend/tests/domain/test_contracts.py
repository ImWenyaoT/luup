from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.domain.contracts import Proposal, Reference, Review, ScientistOutput


def proposal_payload() -> dict[str, object]:
    refs = [
        {
            "arxivId": f"2401.{index:05d}",
            "title": "A verified reference",
            "authors": ["Ada Lovelace"],
            "year": 2024,
            "relevance": "Supports the proposed mechanism.",
        }
        for index in range(1, 6)
    ]
    return {
        "problemStatement": "p" * 50,
        "rationale": "r" * 100,
        "technicalDetails": "t" * 50,
        "datasets": {"source": "s" * 20, "target": "t" * 20},
        "paperTitle": "A valid paper title",
        "paperAbstract": "a" * 150,
        "methods": "m" * 100,
        "experiments": {
            "baselines": ["baseline"],
            "metrics": ["accuracy"],
            "design": "d" * 50,
        },
        "results": "r" * 100,
        "references": refs,
    }


def test_proposal_preserves_the_ten_field_contract() -> None:
    proposal = Proposal.model_validate(proposal_payload())

    assert len(proposal.references) == 5
    assert proposal.datasets.source == "s" * 20


@pytest.mark.parametrize("arxiv_id", ["2401.12345", "2401.12345v2", "astro-ph/0601001"])
def test_reference_accepts_both_arxiv_identifier_forms(arxiv_id: str) -> None:
    reference = Reference(
        arxivId=arxiv_id,
        title="title",
        authors=["Ada Lovelace"],
        year=2024,
        relevance="why",
    )

    assert reference.arxiv_id == arxiv_id


def test_proposal_rejects_too_few_references() -> None:
    payload = proposal_payload()
    payload["references"] = payload["references"][:4]  # type: ignore[index]

    with pytest.raises(ValidationError):
        Proposal.model_validate(payload)


def test_reference_rejects_non_ascii_digits_in_an_arxiv_identifier() -> None:
    with pytest.raises(ValidationError):
        Reference(
            arxivId="２４０１.１２３４５",
            title="title",
            authors=["Ada Lovelace"],
            year=2024,
            relevance="why",
        )


def test_scientist_and_reviewer_outputs_keep_structured_handoffs() -> None:
    scientist = ScientistOutput.model_validate(
        {
            "evidence": [{"claim": "c", "arxivId": f"2401.{index:05d}", "relevance": "r"} for index in range(1, 6)],
            "proposal": proposal_payload(),
        }
    )
    review = Review.model_validate(
        {
            "verdict": "revise",
            "findings": [{"issue": "missing control", "checkedWith": "arXiv 2401.00001"}],
            "requiredChanges": ["add a control"],
        }
    )

    assert scientist.evidence[0].arxiv_id == "2401.00001"
    assert review.verdict == "revise"


@pytest.mark.parametrize(
    ("verdict", "required_changes"),
    [("pass", ["should be empty"]), ("revise", [])],
)
def test_review_verdict_and_required_changes_cannot_contradict(
    verdict: str, required_changes: list[str]
) -> None:
    with pytest.raises(ValidationError):
        Review.model_validate(
            {
                "verdict": verdict,
                "findings": [{"issue": "finding", "checkedWith": "arxiv_search: query"}],
                "requiredChanges": required_changes,
            }
        )
