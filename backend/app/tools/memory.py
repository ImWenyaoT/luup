"""Read-only deterministic campaign-memory search; no vector database."""

from __future__ import annotations

import re
from pathlib import Path


def search_memory(root: Path, query: str, limit: int = 20) -> dict[str, object]:
    if not root.exists():
        return {"enabled": False, "hitCount": 0, "hits": []}
    tokens = [token for token in re.findall(r"[\w\-]{2,}", query.lower()) if token]
    if not tokens:
        raise ValueError("memory_search query 至少包含一个两字符关键词")
    hits: list[dict[str, object]] = []
    for file in sorted(root.rglob("*.md")):
        if not file.is_file():
            continue
        for number, line in enumerate(file.read_text(encoding="utf-8", errors="replace").splitlines(), start=1):
            lower = line.lower()
            if any(token in lower for token in tokens):
                hits.append({"path": str(file.relative_to(root)), "line": number, "text": line.strip()})
                if len(hits) >= limit:
                    return {"enabled": True, "hitCount": len(hits), "hits": hits}
    return {"enabled": True, "hitCount": len(hits), "hits": hits}
