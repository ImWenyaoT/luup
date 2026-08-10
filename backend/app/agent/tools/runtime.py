"""Agents-SDK tool wrappers with Harness-owned search policy."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from agents import function_tool

from app.domain.references import PaperCard

from .arxiv import ArxivClient, ArxivPaper, normalize_arxiv_id
from .memory import search_memory
from .papers import RunPaperStore

MAX_SCIENTIST_SEARCH_INTENTS = 2
MAX_REVIEWER_SEARCH_INTENTS = 3


class SearchIntentLimitError(RuntimeError):
    pass


class ReviewerSearchRequiredError(RuntimeError):
    pass


@dataclass
class _ScientistBudget:
    used: int = 0


@dataclass
class _ReviewerBudget:
    attempts: int = 0
    successful_new_searches: int = 0


class LuupTools:
    """The concrete tool set for a single run.

    The model can choose a query but cannot choose a run directory, bypass the
    per-scientist budget, write paper metadata, or make duplicated requests.
    """

    def __init__(self, run_dir: Path, campaign_memory_dir: Path, arxiv: ArxivClient | None = None) -> None:
        self.store = RunPaperStore(run_dir)
        self._campaign_memory_dir = campaign_memory_dir
        self._arxiv = arxiv or ArxivClient()
        self._budget: ContextVar[_ScientistBudget | None] = ContextVar("luup_scientist_budget", default=None)
        self._reviewer_budget: ContextVar[_ReviewerBudget | None] = ContextVar("luup_reviewer_budget", default=None)
        self._actor: ContextVar[str | None] = ContextVar("luup_tool_actor", default=None)
        self._search_cache: dict[str, list[dict[str, object]]] = {}
        self._failed_queries: set[str] = set()
        self._scientist_seen_ids: set[str] = set()
        self.memory_search = self._memory_search_tool()
        self.arxiv_search = self._arxiv_search_tool()
        self.arxiv_save = self._arxiv_save_tool()
        self.paper_index_read = self._paper_index_tool()

    @asynccontextmanager
    async def scientist_scope(self) -> AsyncIterator[None]:
        token = self._budget.set(_ScientistBudget())
        actor_token = self._actor.set("scientist")
        try:
            yield
        finally:
            self._actor.reset(actor_token)
            self._budget.reset(token)

    @asynccontextmanager
    async def reviewer_scope(self) -> AsyncIterator[None]:
        token = self._reviewer_budget.set(_ReviewerBudget())
        actor_token = self._actor.set("reviewer")
        try:
            yield
            budget = self._reviewer_budget.get()
            if budget is None or budget.successful_new_searches < 1:
                raise ReviewerSearchRequiredError("Reviewer 必须执行至少一次独立的新 arXiv 检索。")
        finally:
            self._actor.reset(actor_token)
            self._reviewer_budget.reset(token)

    async def search(self, query: str, max_results: int = 10, sort_by: str = "relevance") -> dict[str, object]:
        normalized = " ".join(query.lower().split())
        key = normalized
        if key in self._search_cache:
            self._append_tool_event(query=query, count=len(self._search_cache[key]), deduplicated=True)
            return {
                "query": query,
                "count": len(self._search_cache[key]),
                "results": self._search_cache[key],
                "deduplicated": True,
            }
        if key in self._failed_queries:
            raise RuntimeError("同一 run 内该 arXiv 查询已经失败；为避免重复外部请求，不能原样重试。")
        budget = self._budget.get()
        if budget is not None:
            if budget.used >= MAX_SCIENTIST_SEARCH_INTENTS:
                raise SearchIntentLimitError(f"Scientist 单次运行最多 {MAX_SCIENTIST_SEARCH_INTENTS} 个检索意图。")
            budget.used += 1
        reviewer_budget = self._reviewer_budget.get()
        if reviewer_budget is not None:
            if reviewer_budget.attempts >= MAX_REVIEWER_SEARCH_INTENTS:
                raise SearchIntentLimitError(f"Reviewer 单次运行最多 {MAX_REVIEWER_SEARCH_INTENTS} 个检索意图。")
            reviewer_budget.attempts += 1
        try:
            papers = await self._arxiv.search(query, max_results=max_results, sort_by=sort_by)
        except Exception:
            self._failed_queries.add(key)
            raise
        results = [_search_result(paper) for paper in papers]
        result_ids = {str(item["arxivId"]) for item in results}
        actor = self._actor.get()
        new_count = len(result_ids - self._scientist_seen_ids)
        if actor == "scientist":
            self._scientist_seen_ids.update(result_ids)
        if reviewer_budget is not None and new_count > 0:
            reviewer_budget.successful_new_searches += 1
        self._search_cache[key] = results
        self._append_tool_event(query=query, count=len(results), deduplicated=False, new_count=new_count)
        return {"query": query, "count": len(results), "results": results, "deduplicated": False}

    def _append_tool_event(self, *, query: str, count: int, deduplicated: bool, new_count: int = 0) -> None:
        path = self.store.run_dir / "tool-events.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        row = {
            "at": datetime.now(UTC).isoformat(),
            "agent": self._actor.get() or "unknown",
            "tool": "arxiv_search",
            "query": query,
            "count": count,
            "newCount": new_count,
            "deduplicated": deduplicated,
        }
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    async def save(self, arxiv_ids: list[str]) -> dict[str, object]:
        normalized: list[str] = []
        rejected: list[str] = []
        for raw in arxiv_ids:
            canonical = normalize_arxiv_id(raw)
            if canonical is None:
                rejected.append(raw)
            elif canonical not in normalized:
                normalized.append(canonical)
        papers = await self._arxiv.get_many(normalized) if normalized else []
        found = {paper.arxiv_id for paper in papers}
        saved = [
            {
                "arxivId": paper.arxiv_id,
                "title": paper.title,
                "year": paper.year,
                "authors": list(paper.authors),
                "created": self.store.save(paper),
            }
            for paper in papers
        ]
        return {
            "saved": saved,
            "savedCount": len(saved),
            "rejectedIds": rejected,
            "notFoundIds": [item for item in normalized if item not in found],
            "totalPapersInRun": len(self.store.ids()),
        }

    def read_index(self) -> dict[str, object]:
        ids = self.store.ids()
        return {"count": len(ids), "arxivIds": ids, "index": self.store.read_index()}

    def saved_paper_cards(self) -> Mapping[str, PaperCard]:
        """Narrow metadata view for the Scientist adapter's mandatory backfill."""
        return self.store.cards()

    def read_memory(self, query: str, limit: int = 20) -> dict[str, object]:
        result = search_memory(self._campaign_memory_dir, query, limit)
        result["hint"] = (
            "长期记忆是线索；任何引用仍必须经 arxiv_save 在本 run 实检落盘。"
            if result["enabled"]
            else "长期记忆未启用；这不是错误，照常走 arxiv_search。"
        )
        return result

    def _arxiv_search_tool(self) -> Any:
        @function_tool(name_override="arxiv_search")
        async def invoke(
            query: str,
            max_results: int = 10,
            sort_by: Literal["relevance", "lastUpdatedDate", "submittedDate"] = "relevance",
        ) -> dict[str, object]:
            return await self.search(query, max_results=max_results, sort_by=sort_by)

        return invoke

    def _arxiv_save_tool(self) -> Any:
        @function_tool(name_override="arxiv_save")
        async def invoke(arxiv_ids: list[str]) -> dict[str, object]:
            return await self.save(arxiv_ids)

        return invoke

    def _paper_index_tool(self) -> Any:
        @function_tool(name_override="paper_index_read")
        def invoke() -> dict[str, object]:
            return self.read_index()

        return invoke

    def _memory_search_tool(self) -> Any:
        @function_tool(name_override="memory_search")
        def invoke(query: str, limit: int = 20) -> dict[str, object]:
            return self.read_memory(query, limit)

        return invoke


def _search_result(paper: ArxivPaper) -> dict[str, object]:
    summary = paper.summary if len(paper.summary) <= 400 else paper.summary[:400] + "…"
    return {
        "arxivId": paper.arxiv_id,
        "title": paper.title,
        "year": paper.year,
        "authors": list(paper.authors[:6]),
        "primaryCategory": paper.primary_category,
        "summary": summary,
        "url": paper.abs_url,
    }
