from __future__ import annotations

import pytest

from app.domain.contracts import Reference
from app.domain.references import (
    PaperCard,
    normalize_title,
    surname_of,
    title_overlap,
    verify_offline_references,
    verify_resolved_titles,
)


def ref(identifier: str, *, authors: list[str] | None = None, year: int = 2024) -> Reference:
    return Reference(
        arxivId=identifier,
        title="The García Method: An Approach",
        authors=authors or ["J. Garcia"],
        year=year,
        relevance="Supports the method.",
    )


def cards() -> dict[str, PaperCard]:
    return {
        f"2401.{index:05d}": PaperCard(
            arxiv_id=f"2401.{index:05d}",
            year=2024,
            title="The García Method: An Approach",
            authors=["García, José", "Ada Lovelace"],
        )
        for index in range(1, 6)
    }


def test_title_normalization_overlap_and_surname_tolerate_punctuation_and_diacritics() -> None:
    assert normalize_title("The García Method: An Approach!") == "the garc a method an approach"
    assert title_overlap("The García Method: An Approach!", "the garcía method an approach") == 1
    assert surname_of("García, José") == "garcia"
    assert surname_of("J. Garcia") == "garcia"


def test_offline_reference_verification_checks_count_membership_and_author_facts() -> None:
    result = verify_offline_references([ref(f"2401.{index:05d}") for index in range(1, 6)], cards())

    assert result.ok
    assert result.failed == []
    assert result.reference_count == 5
    assert result.papers_in_run == 5
    assert result.model_dump(by_alias=True)["checks"][0]["pass"]


def test_offline_reference_verification_reports_b1_b3_and_b4_without_network() -> None:
    result = verify_offline_references([ref("2401.00001", authors=["Wrong Author"]), ref("2401.00099")], cards())

    assert not result.ok
    assert {"B1.2401.00099", "B3.count", "B4.2401.00001"}.issubset(result.failed)


def test_author_first_position_and_year_are_verified() -> None:
    result = verify_offline_references(
        [ref(f"2401.{index:05d}", authors=["Ada Lovelace", "J. Garcia"], year=2023) for index in range(1, 6)],
        cards(),
    )

    assert all(f"B4.2401.{index:05d}" in result.failed for index in range(1, 6))


def test_missing_authority_authors_fail_closed() -> None:
    authority_cards = cards()
    authority_cards["2401.00001"] = authority_cards["2401.00001"].model_copy(update={"authors": []})

    result = verify_offline_references(
        [ref(f"2401.{index:05d}") for index in range(1, 6)],
        authority_cards,
    )

    assert "B4.2401.00001" in result.failed


def test_resolved_title_check_is_pure_and_uses_the_shared_threshold() -> None:
    checks = verify_resolved_titles(
        [ref("2401.00001"), ref("2401.00002")],
        {"2401.00001": "The García Method: An Approach"},
    )

    assert checks[0].passed
    assert checks[1].id == "B2.2401.00002"
    assert not checks[1].passed


@pytest.mark.parametrize("a,b,expected", [("one two", "one three", 0.5), ("", "one", 0)])
def test_title_overlap_handles_empty_and_partial_titles(a: str, b: str, expected: float) -> None:
    assert title_overlap(a, b) == expected
