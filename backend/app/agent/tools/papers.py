"""Run-local arXiv paper cards. Models never receive a writable path."""

from __future__ import annotations

import json
import os
from pathlib import Path
from tempfile import NamedTemporaryFile

from app.domain.references import PaperCard

from .arxiv import ArxivPaper


def paper_filename(arxiv_id: str) -> str:
    return f"{arxiv_id.replace('/', '__')}.md"


def arxiv_id_from_filename(filename: str) -> str:
    return filename.removesuffix(".md").replace("__", "/")


class RunPaperStore:
    def __init__(self, run_dir: Path) -> None:
        self.run_dir = run_dir.resolve()
        self.papers_dir = self.run_dir / "memory" / "papers"
        self.index_path = self.run_dir / "memory" / "index.md"

    def save(self, paper: ArxivPaper) -> bool:
        target = self.papers_dir / paper_filename(paper.arxiv_id)
        created = not target.exists()
        card = {
            "arxivId": paper.arxiv_id,
            "year": paper.year,
            "title": paper.title,
            "authors": list(paper.authors),
            "published": paper.published,
            "updated": paper.updated,
            "primaryCategory": paper.primary_category,
            "categories": list(paper.categories),
            "url": paper.abs_url,
            "oneline": _first_sentence(paper.summary),
        }
        content = "\n".join(
            [
                "---",
                *[f"{key}: {json.dumps(value, ensure_ascii=False)}" for key, value in card.items()],
                "---",
                "",
                f"# {paper.title or paper.arxiv_id}",
                "",
                f"- **arXiv**: [{paper.arxiv_id}]({paper.abs_url})",
                f"- **Authors**: {', '.join(paper.authors) or '(unknown)'}",
                "",
                "## Abstract",
                "",
                paper.summary or "(arXiv 未提供摘要)",
                "",
            ]
        )
        self._atomic_replace(target, content)
        self.rebuild_index()
        return created

    def cards(self) -> dict[str, PaperCard]:
        if not self.papers_dir.exists():
            return {}
        cards: dict[str, PaperCard] = {}
        for file in sorted(self.papers_dir.glob("*.md")):
            parsed = self._read_card(file)
            if parsed is not None:
                card, _ = parsed
                cards[card.arxiv_id] = card
        return cards

    def ids(self) -> list[str]:
        return sorted(self.cards())

    def read_index(self) -> str:
        if not self.index_path.exists():
            self.rebuild_index()
        return self.index_path.read_text(encoding="utf-8")

    def rebuild_index(self) -> None:
        cards = self._cards_with_onelines()
        lines = [
            "# 文献索引",
            "",
            "由 Python Harness 从 memory/papers/ 自动重建，请勿手改。",
            "",
            # 第一作者在表内：B4 按第一作者姓氏判，模型没有它就只能凭记忆填。
            "| arXiv id | 年份 | 第一作者 | 标题 | 一句话摘要 |",
            "| --- | --- | --- | --- | --- |",
            *[
                f"| {card.arxiv_id} | {card.year or '?'} | {_cell(_first_author(card))} "
                f"| {_cell(card.title)} | {_cell(oneline)} |"
                for card, oneline in cards
            ],
            "",
        ]
        self._atomic_replace(self.index_path, "\n".join(lines))

    def _cards_with_onelines(self) -> list[tuple[PaperCard, str]]:
        if not self.papers_dir.exists():
            return []
        return [
            parsed for file in sorted(self.papers_dir.glob("*.md")) if (parsed := self._read_card(file)) is not None
        ]

    def _read_card(self, file: Path) -> tuple[PaperCard, str] | None:
        raw = file.read_text(encoding="utf-8")
        if not raw.startswith("---\n"):
            return None
        closing = raw.find("\n---", 4)
        if closing < 0:
            return None
        fields: dict[str, object] = {}
        for line in raw[4:closing].splitlines():
            key, separator, value = line.partition(":")
            if not separator:
                continue
            try:
                fields[key.strip()] = json.loads(value.strip())
            except json.JSONDecodeError:
                continue
        arxiv_id = fields.get("arxivId")
        if not isinstance(arxiv_id, str):
            return None
        year = fields.get("year")
        title = fields.get("title")
        authors = fields.get("authors")
        card = PaperCard(
            arxiv_id=arxiv_id,
            year=year if isinstance(year, int) else 0,
            title=title if isinstance(title, str) else "",
            authors=authors if isinstance(authors, list) and all(isinstance(author, str) for author in authors) else [],
        )
        oneline = fields.get("oneline")
        return card, oneline if isinstance(oneline, str) else card.title

    @staticmethod
    def _atomic_replace(target: Path, content: str) -> None:
        target.parent.mkdir(parents=True, exist_ok=True)
        with NamedTemporaryFile("w", encoding="utf-8", dir=target.parent, delete=False) as handle:
            handle.write(content)
            temporary = handle.name
        os.replace(temporary, target)


def _first_sentence(summary: str) -> str:
    text = " ".join(summary.split())
    if len(text) <= 240:
        return text
    return text[:239].rstrip() + "…"


def _first_author(card: PaperCard) -> str:
    return card.authors[0] if card.authors else "(unknown)"


def _cell(value: str) -> str:
    return value.replace("|", "\\|").replace("\n", " ")
