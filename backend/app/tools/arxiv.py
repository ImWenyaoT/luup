"""arXiv API client: process-wide serialization, polite spacing, and one retry."""

from __future__ import annotations

import asyncio
import re
import time
import xml.etree.ElementTree as element_tree
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlencode

import httpx

ARXIV_API_URL = "https://export.arxiv.org/api/query"
MIN_REQUEST_INTERVAL_SECONDS = 3.0
MAX_ATTEMPTS = 2
USER_AGENT = "luup/0.1 (+https://github.com/ImWenyaoT/luup)"
ARXIV_ID_RE = re.compile(r"^(\d{4}\.\d{4,5}(v\d+)?|[a-z-]+(\.[A-Z]{2})?/\d{7}(v\d+)?)$")
FIELD_PREFIX_RE = re.compile(r"\b(all|ti|abs|au|cat|co|jr|rn|id):", re.IGNORECASE)


class ArxivError(RuntimeError):
    """A non-recoverable arXiv response or exhausted transient error."""


class ArxivTransientError(ArxivError):
    """A failure eligible for exactly one retry."""


class ArxivHttp(Protocol):
    async def get_text(self, url: str) -> str: ...


class HttpxArxivHttp:
    """The only production HTTP implementation; tests inject the protocol above."""

    def __init__(self) -> None:
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(30.0), headers={"user-agent": USER_AGENT})

    async def get_text(self, url: str) -> str:
        try:
            response = await self._client.get(url, headers={"accept": "application/atom+xml"})
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            raise ArxivTransientError(f"arXiv transport failure: {exc}") from exc
        if response.status_code == 429 or response.status_code >= 500:
            raise ArxivTransientError(f"arXiv API HTTP {response.status_code}")
        if response.status_code >= 400:
            raise ArxivError(f"arXiv API HTTP {response.status_code}")
        return response.text


class ArxivGate:
    """A process-wide async gate. Every retry passes through the same gate."""

    def __init__(
        self,
        min_interval: float = MIN_REQUEST_INTERVAL_SECONDS,
        *,
        clock: Callable[[], float] = time.monotonic,
        sleeper: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._min_interval = min_interval
        self._clock = clock
        self._sleeper = sleeper
        self._lock = asyncio.Lock()
        self._last_started: float | None = None

    async def run(self, operation: Callable[[], Awaitable[str]]) -> str:
        async with self._lock:
            if self._last_started is not None:
                remaining = self._min_interval - (self._clock() - self._last_started)
                if remaining > 0:
                    await self._sleeper(remaining)
            self._last_started = self._clock()
            return await operation()


GLOBAL_ARXIV_GATE = ArxivGate()


@dataclass(frozen=True)
class ArxivPaper:
    arxiv_id: str
    version: str | None
    title: str
    authors: tuple[str, ...]
    summary: str
    published: str
    updated: str
    year: int
    primary_category: str
    categories: tuple[str, ...]
    abs_url: str


def normalize_arxiv_id(raw: str) -> str | None:
    value = str(raw or "").strip()
    value = re.sub(r"^https?://(?:www\.|export\.)?arxiv\.org/(?:abs|pdf)/", "", value, flags=re.IGNORECASE)
    value = re.sub(r"^arxiv:\s*", "", value, flags=re.IGNORECASE)
    value = re.sub(r"\.pdf$", "", value, flags=re.IGNORECASE)
    value = re.sub(r"v\d+$", "", value, flags=re.IGNORECASE).strip()
    return value if ARXIV_ID_RE.fullmatch(value) else None


def build_search_query(query: str) -> str:
    value = query.strip()
    if not value:
        raise ArxivError("检索词为空")
    if FIELD_PREFIX_RE.search(value):
        return value
    return f'all:"{value.replace(chr(34), " ").strip()}"'


def _tag(element: element_tree.Element, name: str) -> str:
    for child in element:
        if child.tag.rsplit("}", 1)[-1] == name:
            return " ".join((child.text or "").split())
    return ""


def _entries(xml: str) -> list[ArxivPaper]:
    try:
        root = element_tree.fromstring(xml)
    except element_tree.ParseError as exc:
        raise ArxivError("arXiv API 返回非 Atom XML") from exc
    papers: list[ArxivPaper] = []
    for entry in root.iter():
        if entry.tag.rsplit("}", 1)[-1] != "entry":
            continue
        raw_id = _tag(entry, "id")
        if "api/errors" in raw_id:
            continue
        matched = re.search(r"/abs/(.+)$", raw_id)
        tail = matched.group(1) if matched else raw_id
        version_match = re.fullmatch(r"(.+?)(v\d+)?", tail)
        if version_match is None:
            continue
        canonical = normalize_arxiv_id(version_match.group(1))
        if canonical is None:
            continue
        authors = tuple(
            name
            for author in entry
            if author.tag.rsplit("}", 1)[-1] == "author"
            for name in (_tag(author, "name"),)
            if name
        )
        categories = tuple(
            category.attrib.get("term", "").strip()
            for category in entry
            if category.tag.rsplit("}", 1)[-1] == "category" and category.attrib.get("term", "").strip()
        )
        primary = next(
            (
                item.attrib.get("term", "").strip()
                for item in entry
                if item.tag.rsplit("}", 1)[-1] == "primary_category"
            ),
            "",
        ) or (categories[0] if categories else "")
        published = _tag(entry, "published")
        updated = _tag(entry, "updated") or published
        year_match = re.match(r"(\d{4})", published or updated)
        papers.append(
            ArxivPaper(
                arxiv_id=canonical,
                version=(version_match.group(2) or None),
                title=_tag(entry, "title"),
                authors=authors,
                summary=_tag(entry, "summary"),
                published=published,
                updated=updated,
                year=int(year_match.group(1)) if year_match else 0,
                primary_category=primary,
                categories=categories,
                abs_url=f"https://arxiv.org/abs/{canonical}",
            )
        )
    return papers


class ArxivClient:
    def __init__(self, transport: ArxivHttp | None = None, gate: ArxivGate | None = None) -> None:
        self._transport = transport or HttpxArxivHttp()
        self._gate = gate or GLOBAL_ARXIV_GATE

    async def search(self, query: str, max_results: int = 10, sort_by: str = "relevance") -> list[ArxivPaper]:
        capped = max(1, min(50, int(max_results)))
        params = urlencode(
            {
                "search_query": build_search_query(query),
                "start": 0,
                "max_results": capped,
                "sortBy": sort_by,
                "sortOrder": "descending",
            }
        )
        return (await self._fetch(f"{ARXIV_API_URL}?{params}"))[:capped]

    async def get_many(self, raw_ids: Sequence[str]) -> list[ArxivPaper]:
        ids: list[str] = []
        for raw in raw_ids:
            canonical = normalize_arxiv_id(raw)
            if canonical is not None and canonical not in ids:
                ids.append(canonical)
        found: dict[str, ArxivPaper] = {}
        for start in range(0, len(ids), 50):
            chunk = ids[start : start + 50]
            if not chunk:
                continue
            params = urlencode({"id_list": ",".join(chunk), "max_results": len(chunk)})
            for paper in await self._fetch(f"{ARXIV_API_URL}?{params}"):
                found[paper.arxiv_id] = paper
        return [found[item] for item in ids if item in found]

    async def _fetch(self, url: str) -> list[ArxivPaper]:
        last_error: ArxivTransientError | None = None
        for attempt in range(MAX_ATTEMPTS):
            try:
                body = await self._gate.run(lambda: self._transport.get_text(url))
                return _entries(body)
            except (ArxivTransientError, httpx.TimeoutException, httpx.TransportError) as exc:
                last_error = exc if isinstance(exc, ArxivTransientError) else ArxivTransientError(str(exc))
                if attempt + 1 == MAX_ATTEMPTS:
                    break
        raise ArxivError(f"arXiv transient failure after {MAX_ATTEMPTS} attempts: {last_error}") from last_error
