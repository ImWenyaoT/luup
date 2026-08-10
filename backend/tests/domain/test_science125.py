from __future__ import annotations

import json
from pathlib import Path

from app.domain.science125 import find_question, read_science125


def test_default_bank_exposes_the_frozen_125_questions() -> None:
    bank = read_science125()

    assert bank is not None
    assert bank.total == 125
    assert sum(domain.count for domain in bank.domains) == 125
    assert find_question(1) is not None


def test_read_science125_groups_in_first_seen_domain_order(tmp_path: Path) -> None:
    source = tmp_path / "science125.json"
    source.write_text(
        json.dumps(
            {
                "source": "https://example.test/science",
                "retrievedAt": "2026-08-08",
                "questions": [
                    {"id": 1, "domain": "Chemistry", "question": "Q1"},
                    {"id": 2, "domain": "Physics", "question": "Q2"},
                    {"id": 3, "domain": "Chemistry", "question": "Q3"},
                    {"id": 4, "question": "Q4"},
                    {"id": "bad", "domain": "Skip", "question": "Q5"},
                ],
            }
        ),
        encoding="utf-8",
    )

    bank = read_science125(source)

    assert bank.total == 5
    assert bank.model_dump(by_alias=True)["retrievedAt"] == "2026-08-08"
    assert [domain.domain for domain in bank.domains] == [
        "Chemistry",
        "Physics",
        "(未分类)",
    ]
    assert [question.id for question in bank.domains[0].questions] == [1, 3]


def test_read_science125_returns_none_for_missing_or_empty_data(tmp_path: Path) -> None:
    assert read_science125(tmp_path / "missing.json") is None
    empty = tmp_path / "empty.json"
    empty.write_text('{"questions": []}', encoding="utf-8")
    assert read_science125(empty) is None


def test_find_question_returns_exact_entry_or_none(tmp_path: Path) -> None:
    source = tmp_path / "science125.json"
    source.write_text('{"questions":[{"id":7,"domain":"Math","question":"What?"}]}', encoding="utf-8")

    assert find_question(7, source).model_dump(by_alias=True) == {
        "id": 7,
        "domain": "Math",
        "question": "What?",
    }
    assert find_question(8, source) is None
