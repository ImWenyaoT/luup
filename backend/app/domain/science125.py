"""Science-125 的只读题库边界。"""

from __future__ import annotations

import json
from collections import OrderedDict
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class Science125Question(BaseModel):
    id: int
    domain: str
    question: str


class Science125Domain(BaseModel):
    domain: str
    count: int
    questions: list[Science125Question]


class Science125(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    source: str
    retrieved_at: str = Field(validation_alias="retrievedAt", serialization_alias="retrievedAt")
    total: int
    domains: list[Science125Domain]


def default_science125_path() -> Path:
    """读取与 Python 实现共置的冻结题库。"""
    return Path(__file__).resolve().parents[1] / "data" / "science125.json"


def _read_raw(path: Path) -> dict[str, Any] | None:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    return raw if isinstance(raw, dict) else None


def read_science125(path: Path | None = None) -> Science125 | None:
    raw = _read_raw(path or default_science125_path())
    if raw is None:
        return None
    questions = raw.get("questions")
    if not isinstance(questions, list) or not questions:
        return None

    grouped: OrderedDict[str, list[Science125Question]] = OrderedDict()
    for item in questions:
        if not isinstance(item, dict):
            continue
        identifier, question = item.get("id"), item.get("question")
        # JavaScript 的 typeof number 不把 boolean 当 number；Python bool 是 int 的子类。
        if not isinstance(identifier, int) or isinstance(identifier, bool) or not isinstance(question, str):
            continue
        raw_domain = item.get("domain")
        domain: str = raw_domain if isinstance(raw_domain, str) and raw_domain else "(未分类)"
        grouped.setdefault(domain, []).append(Science125Question(id=identifier, domain=domain, question=question))

    raw_source = raw.get("source")
    raw_retrieved_at = raw.get("retrievedAt")
    return Science125(
        source=raw_source if isinstance(raw_source, str) else "",
        retrieved_at=raw_retrieved_at if isinstance(raw_retrieved_at, str) else "",
        total=len(questions),
        domains=[
            Science125Domain(domain=domain, count=len(items), questions=items) for domain, items in grouped.items()
        ],
    )


def find_question(identifier: int, path: Path | None = None) -> Science125Question | None:
    raw = _read_raw(path or default_science125_path())
    questions = raw.get("questions") if raw else None
    if not isinstance(questions, list):
        return None
    for item in questions:
        if not isinstance(item, dict) or item.get("id") != identifier:
            continue
        question, domain = item.get("question"), item.get("domain")
        if isinstance(question, str) and isinstance(domain, str):
            return Science125Question(id=identifier, domain=domain, question=question)
    return None
