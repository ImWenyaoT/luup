"""Read-only deterministic campaign-memory search; no vector database."""

from __future__ import annotations

import re
from collections.abc import Iterator
from pathlib import Path

PRIORITY_GLOBS = ("lessons.md", "questions/**/*.md")
"""跨 run 的判断先扫：题页与教训是「上次为什么没走通」的唯一载体。"""

SECONDARY_GLOBS = ("library/index.md",)
"""全局文献索引次之：它是线索表，不是判断。"""

EXCLUDED_PREFIX = "library/papers/"
"""文献卡正文排除出检索面：上百篇卡片会把一条题页命中挤出 limit。"""


def search_memory(root: Path | None, query: str, limit: int = 20) -> dict[str, object]:
    if root is None or not root.exists():
        return {"enabled": False, "hitCount": 0, "hits": []}
    tokens = [token for token in re.findall(r"[\w\-]{2,}", query.lower()) if token]
    if not tokens:
        raise ValueError("memory_search query 至少包含一个两字符关键词")
    hits: list[dict[str, object]] = []
    for file in _search_surface(root):
        for number, line in enumerate(file.read_text(encoding="utf-8", errors="replace").splitlines(), start=1):
            lower = line.lower()
            if any(token in lower for token in tokens):
                hits.append({"path": _relative(root, file), "line": number, "text": line.strip()})
                if len(hits) >= limit:
                    return {"enabled": True, "hitCount": len(hits), "hits": hits}
    return {"enabled": True, "hitCount": len(hits), "hits": hits}


def _search_surface(root: Path) -> Iterator[Path]:
    """Priority buckets are scanned first, so a full result page never starves them."""
    seen: set[Path] = set()
    for pattern in (*PRIORITY_GLOBS, *SECONDARY_GLOBS):
        for file in sorted(root.glob(pattern)):
            if file.is_file() and file not in seen:
                seen.add(file)
                yield file
    for file in sorted(root.rglob("*.md")):
        if file.is_file() and file not in seen and not _relative(root, file).startswith(EXCLUDED_PREFIX):
            seen.add(file)
            yield file


def _relative(root: Path, file: Path) -> str:
    return file.relative_to(root).as_posix()
