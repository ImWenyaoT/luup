"""Campaign-memory search: optional by design, deterministic, and bounded."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.agent.tools.memory import search_memory


def paths_of(result: dict[str, object]) -> list[object]:
    hits = result["hits"]
    assert isinstance(hits, list)
    return [hit["path"] for hit in hits]


def test_a_repository_without_campaign_memory_reports_disabled_instead_of_failing(tmp_path: Path) -> None:
    """Memory is a hint layer; a fresh checkout has none and the run must still proceed."""
    result = search_memory(tmp_path / "memory", "stellar mechanism")

    assert result == {"enabled": False, "hitCount": 0, "hits": []}


@pytest.mark.parametrize("query", ["", "   ", "a", "a b c", "!!!"])
def test_a_query_without_a_two_character_token_is_rejected(tmp_path: Path, query: str) -> None:
    """A one-character query would match nearly every line and drown the model in noise."""
    tmp_path.mkdir(exist_ok=True)
    (tmp_path / "lessons.md").write_text("a stellar mechanism lesson\n", encoding="utf-8")

    with pytest.raises(ValueError, match="至少包含一个两字符关键词"):
        search_memory(tmp_path, query)


def test_any_token_matches_and_hits_carry_a_relative_path_and_line_number(tmp_path: Path) -> None:
    (tmp_path / "notes").mkdir()
    (tmp_path / "notes" / "lessons.md").write_text(
        "irrelevant first line\n  A Stellar collapse lesson  \nanother miss\nneutrino counts\n", encoding="utf-8"
    )
    (tmp_path / "ignored.txt").write_text("stellar but not markdown\n", encoding="utf-8")

    result = search_memory(tmp_path, "STELLAR neutrino")

    assert result["enabled"] is True
    assert result["hitCount"] == 2
    assert result["hits"] == [
        {"path": "notes/lessons.md", "line": 2, "text": "A Stellar collapse lesson"},
        {"path": "notes/lessons.md", "line": 4, "text": "neutrino counts"},
    ]


def test_results_are_capped_at_the_limit(tmp_path: Path) -> None:
    """The tool result goes straight into the model context, so the cap is a budget guarantee."""
    (tmp_path / "a.md").write_text("".join(f"stellar line {index}\n" for index in range(10)), encoding="utf-8")
    (tmp_path / "b.md").write_text("stellar line from the second file\n", encoding="utf-8")

    result = search_memory(tmp_path, "stellar", limit=3)

    assert result["hitCount"] == 3
    assert paths_of(result) == ["a.md", "a.md", "a.md"]


def test_a_directory_named_like_a_markdown_file_is_skipped(tmp_path: Path) -> None:
    (tmp_path / "archive.md").mkdir()
    (tmp_path / "archive.md" / "inner.md").write_text("stellar inner note\n", encoding="utf-8")

    result = search_memory(tmp_path, "stellar")

    assert paths_of(result) == ["archive.md/inner.md"]


def test_undecodable_bytes_do_not_abort_the_search(tmp_path: Path) -> None:
    """Memory files are hand-edited fact data; one broken byte must not kill the whole run."""
    (tmp_path / "broken.md").write_bytes(b"stellar \xff\xfe mechanism\n")

    result = search_memory(tmp_path, "stellar")

    assert result["hitCount"] == 1
