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

from .arxiv import ArxivClient, ArxivError, ArxivPaper, build_search_query, normalize_arxiv_id
from .memory import search_memory
from .papers import RunPaperStore

MAX_SCIENTIST_SEARCH_INTENTS = 2
MAX_REVIEWER_SEARCH_INTENTS = 3
NO_NEW_PAPER_HINT = "本次未带来新论文，需换角度：改用不同术语、相邻子领域或反例方向，不要原样重试。"
MEMORY_DISABLED_HINT = "长期记忆未启用；这不是错误，照常走 arxiv_search。"
MEMORY_ENABLED_HINT = "长期记忆是线索；任何引用仍必须经 arxiv_save 在本 run 实检落盘。"


class SearchIntentLimitError(RuntimeError):
    pass


class RepeatedFailedQueryError(RuntimeError):
    pass


class ReviewerSearchRequiredError(RuntimeError):
    pass


def tool_error_message(context: Any, error: Exception) -> str:
    """Terminal errors must speak terminally.

    The SDK default ends every tool failure with "Please try again", which sends the
    model back into a budget it has already spent. Each branch here names the one
    action that can still make progress.
    """
    if isinstance(error, SearchIntentLimitError):
        return f"{error} 预算已尽，基于已有结果直接产出，不要再调用检索。"
    if isinstance(error, RepeatedFailedQueryError):
        return f"{error} 换一个检索角度，或基于已有结果直接产出。"
    if isinstance(error, ArxivError):
        return f"arXiv 检索失败：{error}。不要原样重试；换一个检索角度，或基于已有结果直接产出。"
    if isinstance(error, ValueError):
        return f"参数不合法：{error}。修正参数后再调用，不要重复同一调用。"
    return f"工具调用失败：{type(error).__name__}: {error}。不要重试同一调用；改换参数或基于已有结果产出。"


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

    def __init__(
        self, run_dir: Path, campaign_memory_dir: Path | None, arxiv: ArxivClient | None = None
    ) -> None:
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
        key = " ".join(query.lower().split())
        if key in self._search_cache:
            cached = self._search_cache[key]
            self.append_tool_event(
                tool="arxiv_search",
                query=query,
                arxivQuery=build_search_query(query),
                count=len(cached),
                newCount=0,
                deduplicated=True,
            )
            return self._search_payload(query, cached, new_count=0, deduplicated=True)
        if key in self._failed_queries:
            raise RepeatedFailedQueryError("同一 run 内该 arXiv 查询已经失败；为避免重复外部请求，不能原样重试。")
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
        # The rewritten AND query is what arXiv actually answered; a zero-hit line is
        # unreadable without it, and the model-facing payload alone leaves no artifact.
        self.append_tool_event(
            tool="arxiv_search",
            query=query,
            arxivQuery=build_search_query(query),
            count=len(results),
            newCount=new_count,
            deduplicated=False,
        )
        return self._search_payload(query, results, new_count=new_count, deduplicated=False)

    def _search_payload(
        self, query: str, results: list[dict[str, object]], *, new_count: int, deduplicated: bool
    ) -> dict[str, object]:
        """Everything the model needs to steer: the real query, the yield, and the budget left."""
        used, limit = self._search_budget()
        payload: dict[str, object] = {
            "query": query,
            "arxivQuery": build_search_query(query),
            "count": len(results),
            "newCount": new_count,
            "searchIntentsUsed": used,
            "searchIntentsMax": limit,
            "deduplicated": deduplicated,
            "results": results,
        }
        if new_count == 0:
            payload["hint"] = NO_NEW_PAPER_HINT
        return payload

    def _search_budget(self) -> tuple[int, int]:
        scientist = self._budget.get()
        if scientist is not None:
            return scientist.used, MAX_SCIENTIST_SEARCH_INTENTS
        reviewer = self._reviewer_budget.get()
        if reviewer is not None:
            return reviewer.attempts, MAX_REVIEWER_SEARCH_INTENTS
        return 0, 0

    def append_tool_event(self, *, tool: str, **fields: object) -> None:
        """One append-only line per tool call, including the ones nobody used to see."""
        path = self.store.run_dir / "tool-events.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        row = {
            "at": datetime.now(UTC).isoformat(),
            "agent": self._actor.get() or "unknown",
            "tool": tool,
            **fields,
        }
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row, ensure_ascii=False, default=str) + "\n")

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
        not_found = [item for item in normalized if item not in found]
        self.append_tool_event(
            tool="arxiv_save",
            requested=len(arxiv_ids),
            savedCount=len(saved),
            rejectedCount=len(rejected),
            notFoundCount=len(not_found),
            totalPapersInRun=len(self.store.ids()),
        )
        return {
            "saved": saved,
            "savedCount": len(saved),
            "rejectedIds": rejected,
            "notFoundIds": not_found,
            "totalPapersInRun": len(self.store.ids()),
        }

    def read_index(self) -> dict[str, object]:
        ids = self.store.ids()
        self.append_tool_event(tool="paper_index_read", count=len(ids))
        return {"count": len(ids), "arxivIds": ids, "index": self.store.read_index()}

    def saved_paper_cards(self) -> Mapping[str, PaperCard]:
        """Narrow metadata view for the Scientist adapter's mandatory backfill."""
        return self.store.cards()

    def read_memory(self, query: str, limit: int = 20) -> dict[str, object]:
        result = search_memory(self._campaign_memory_dir, query, limit)
        result["hint"] = MEMORY_ENABLED_HINT if result["enabled"] else MEMORY_DISABLED_HINT
        self.append_tool_event(
            tool="memory_search", query=query, enabled=result["enabled"], hitCount=result["hitCount"]
        )
        return result

    def _arxiv_search_tool(self) -> Any:
        @function_tool(name_override="arxiv_search", failure_error_function=tool_error_message)
        async def invoke(
            query: str,
            max_results: int = 10,
            sort_by: Literal["relevance", "lastUpdatedDate", "submittedDate"] = "relevance",
        ) -> dict[str, object]:
            """检索 arXiv 的论文元数据（标题、作者、年份、摘要），不检索全文，也不检索 arXiv 之外的任何来源。

            多个词会被组合成 AND 查询式（`all:词1 AND all:词2 …`），词越多命中越少：建议 3-6 个具体术语，
            返回值里的 `arxivQuery` 就是实际发出的查询式，命中为 0 时先看它。同一 run 内相同 query 由
            Harness 去重、不重复发外部请求；每次真实外部请求至少间隔 3 秒，检索意图数有硬上限。

            Args:
                query: 自然语言关键词；也接受 arXiv 字段前缀式（`ti:`/`au:`/`abs:`/`cat:` 等），
                    带前缀时原样发出、不再改写。
                max_results: 返回条数上限，取值 1-50，默认 10。
                sort_by: 排序方式，`relevance`（默认）、`lastUpdatedDate` 或 `submittedDate`。

            Returns:
                `arxivQuery` 实际查询式、`count` 命中数、`newCount` 本次新出现的论文数、
                `searchIntentsUsed`/`searchIntentsMax` 检索预算、`deduplicated` 是否命中同 run 缓存、
                `results[]`（`arxivId`/`title`/`year`/`authors`/`primaryCategory`/`summary`/`url`）。
                `newCount` 为 0 时另有 `hint`。检索结果尚未落盘，要引用必须再调 `arxiv_save`。
            """
            return await self.search(query, max_results=max_results, sort_by=sort_by)

        return invoke

    def _arxiv_save_tool(self) -> Any:
        @function_tool(name_override="arxiv_save", failure_error_function=tool_error_message)
        async def invoke(arxiv_ids: list[str]) -> dict[str, object]:
            """把 arXiv 论文实检落盘为本 run 的文献卡；这是引用的唯一合法来源。

            只有在这里保存成功、能在 `paper_index_read` 里看到的论文，才允许进入 `references[]`。
            元数据由工具直接取自 arXiv，模型改不动。一次可传多个 id，重复 id 自动去重；
            每个未缓存的 id 都要付一次外部请求（≥3 秒间隔）。

            Args:
                arxiv_ids: arXiv id 列表，例如 `["2401.12345", "2401.12345v2", "astro-ph/0601001",
                    "arXiv:2401.12345", "https://arxiv.org/abs/2401.12345"]`；版本号与 URL 前缀会被
                    归一化，DOI、纯标题等非 arXiv id 会进 `rejectedIds`。

            Returns:
                `saved[]`（`arxivId`/`title`/`year`/`authors`/`created`）、`savedCount`、
                `rejectedIds`（不是合法 arXiv id）、`notFoundIds`（arXiv 查无此 id）、
                `totalPapersInRun` 本 run 累计落盘篇数。
            """
            return await self.save(arxiv_ids)

        return invoke

    def _paper_index_tool(self) -> Any:
        @function_tool(name_override="paper_index_read", failure_error_function=tool_error_message)
        def invoke() -> dict[str, object]:
            """读取本 run 已落盘论文的索引表，用来逐字核对将要写进 `references[]` 的元数据。

            只读，不发外部请求，没有等待代价。索引由 Harness 从 `arxiv_save` 写下的文献卡确定性重建，
            拿不准某篇的标题或第一作者时以这里为准；这里没有的论文一律不得引用。

            Returns:
                `count` 本 run 已保存篇数、`arxivIds[]` 全部 id、
                `index` 索引表 Markdown（arXiv id / 年份 / 第一作者 / 标题 / 一句话摘要）。
            """
            return self.read_index()

        return invoke

    def _memory_search_tool(self) -> Any:
        @function_tool(name_override="memory_search", failure_error_function=tool_error_message)
        def invoke(query: str, limit: int = 20) -> dict[str, object]:
            """在跨 run 的战役记忆里做确定性关键词匹配，拿检索线索与历史死路。

            命中只是线索、不是证据：任何要进 `references[]` 的论文仍必须经 `arxiv_save` 在本 run 实检落盘。
            检索面按优先级是题页与教训（`questions/**`、`lessons.md`）、其次全局文献索引；
            文献卡正文不在检索面内。只读本地文件，不发外部请求。

            Args:
                query: 关键词，至少含一个两字符以上的词；任一词命中某行即算命中该行。
                limit: 返回命中行数上限，默认 20。

            Returns:
                `enabled`（仓库没有 memory/ 或本 run 关闭了记忆臂时为 false，这不是错误）、
                `hitCount`、`hits[]`（`path`/`line`/`text`）、`hint`。
            """
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
