"""引用验真的无网络字符串规则与本地事实核验。"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Collection, Mapping

from pydantic import BaseModel, ConfigDict, Field

from .contracts import Reference

TITLE_OVERLAP_THRESHOLD = 0.8
_TITLE_NOISE = re.compile(r"[^a-z0-9\u4e00-\u9fff]+")
_AUTHOR_NOISE = re.compile(r"[^a-z0-9\u4e00-\u9fff'\-]+")


def normalize_title(value: str) -> str:
    return _TITLE_NOISE.sub(" ", value.lower()).strip()


def title_overlap(left: str, right: str) -> float:
    left_tokens = set(filter(None, normalize_title(left).split(" ")))
    right_tokens = set(filter(None, normalize_title(right).split(" ")))
    if not left_tokens or not right_tokens:
        return 0
    return len(left_tokens & right_tokens) / max(len(left_tokens), len(right_tokens))


def _fold_diacritics(value: str) -> str:
    return "".join(char for char in unicodedata.normalize("NFD", value) if not unicodedata.combining(char)).lower()


def surname_of(author: str) -> str:
    raw = str(author or "").strip()
    if not raw:
        return ""
    comma = raw.find(",")
    head = raw[:comma] if comma > 0 else raw
    tokens = [
        token
        for token in _AUTHOR_NOISE.sub(" ", _fold_diacritics(head)).split()
        if re.search(r"[a-z0-9\u4e00-\u9fff]", token)
    ]
    return tokens[-1] if tokens else ""


class PaperCard(BaseModel):
    arxiv_id: str
    year: int = 0
    title: str = ""
    authors: list[str] = Field(default_factory=list)


class ReferenceCheck(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    passed: bool = Field(validation_alias="pass", serialization_alias="pass")
    detail: str


class ReferenceVerification(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    ok: bool
    reference_count: int = Field(validation_alias="referenceCount", serialization_alias="referenceCount")
    papers_in_run: int = Field(validation_alias="papersInRun", serialization_alias="papersInRun")
    checks: list[ReferenceCheck]
    failed: list[str]


def verify_resolved_titles(refs: Collection[Reference], resolved_titles: Mapping[str, str]) -> list[ReferenceCheck]:
    """B2 的纯比较部分；调用方负责以独立 arXiv 通路取得 `resolved_titles`。"""
    checks: list[ReferenceCheck] = []
    for reference in refs:
        remote = resolved_titles.get(reference.arxiv_id)
        if remote is None:
            checks.append(
                ReferenceCheck(
                    id=f"B2.{reference.arxiv_id}",
                    passed=False,
                    detail="arXiv 反查无结果（id 不存在或网络失败）",
                )
            )
            continue
        score = title_overlap(reference.title, remote)
        checks.append(
            ReferenceCheck(
                id=f"B2.{reference.arxiv_id}",
                passed=score >= TITLE_OVERLAP_THRESHOLD,
                detail=(
                    f"标题重合度 {score:.2f}（阈值 {TITLE_OVERLAP_THRESHOLD}）"
                    f"｜产物「{reference.title}」｜arXiv「{remote}」"
                ),
            )
        )
    return checks


def verify_offline_references(
    refs: Collection[Reference],
    cards: Mapping[str, PaperCard],
    known_ids: Collection[str] | None = None,
) -> ReferenceVerification:
    """核验 B1、B3、B4；完全基于本 run 已保存的 arXiv 卡片，不发网络请求。"""
    known = set(known_ids) if known_ids is not None else set(cards)
    checks = [
        ReferenceCheck(
            id="B3.count",
            passed=len(refs) >= 5,
            detail=f"references = {len(refs)}（要求 ≥5）",
        )
    ]
    for reference in refs:
        hit = reference.arxiv_id in known
        checks.append(
            ReferenceCheck(
                id=f"B1.{reference.arxiv_id}",
                passed=hit,
                detail="在本次运行 memory/papers/ 中"
                if hit
                else f"未在本次运行实检命中（papers/ 共 {len(known)} 篇）——必须先 arxiv_save",
            )
        )

    for reference in refs:
        card = cards.get(reference.arxiv_id)
        if card is None:
            continue  # B1 已报告；损坏卡不伪造 B4 事实。
        problems: list[str] = []
        if not card.authors:
            problems.append("本 run 文献卡缺少作者，无法执行 B4")
        if card.year and reference.year != card.year:
            problems.append(f"年份不符（产物 {reference.year}，arXiv {card.year}）")
        truth = {surname_of(author) for author in card.authors if surname_of(author)}
        if card.authors and not truth:
            problems.append("本 run 文献卡作者无法解析，无法执行 B4")
        claimed = [surname_of(author) for author in reference.authors if surname_of(author)]
        bogus = [name for name in claimed if name not in truth]
        if truth and bogus:
            problems.append(f"作者不符：{', '.join(bogus)} 不在该文献作者中（arXiv: {', '.join(card.authors)}）")
        first_truth = surname_of(card.authors[0]) if card.authors else ""
        first_claimed = surname_of(reference.authors[0]) if reference.authors else ""
        if first_truth and first_claimed != first_truth:
            problems.append(
                "第一作者不符（"
                f"产物「{reference.authors[0] if reference.authors else ''}」，"
                f"arXiv「{card.authors[0]}」）"
            )
        checks.append(
            ReferenceCheck(
                id=f"B4.{reference.arxiv_id}",
                passed=not problems,
                detail="作者与年份与本 run 落盘卡片一致，第一作者一致"
                if not problems
                else f"{'；'.join(problems)} —— 必须照抄 memory/papers/ 中的元数据，不得凭记忆填写",
            )
        )
    failed = [check.id for check in checks if not check.passed]
    return ReferenceVerification(
        ok=not failed,
        reference_count=len(refs),
        papers_in_run=len(known),
        checks=checks,
        failed=failed,
    )
