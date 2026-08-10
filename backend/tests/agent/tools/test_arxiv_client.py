"""arXiv client behavior below the tool layer: transport errors, retry policy, Atom parsing, id batching."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, cast
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from app.agent.tools import arxiv as arxiv_module
from app.agent.tools.arxiv import (
    MAX_ATTEMPTS,
    USER_AGENT,
    ArxivClient,
    ArxivError,
    ArxivGate,
    ArxivTransientError,
    HttpxArxivHttp,
    build_search_query,
    normalize_arxiv_id,
)

ENTRY = """
  <entry>
    <id>http://arxiv.org/abs/{id}v2</id><updated>2024-01-20T00:00:00Z</updated><published>2024-01-10T00:00:00Z</published>
    <title>Observed Mechanism</title><summary>A real abstract sentence.</summary>
    <author><name>Ada Lovelace</name></author><category term="astro-ph.SR"/><arxiv:primary_category term="astro-ph.SR"/>
  </entry>"""


def atom(*entries: str) -> str:
    body = "".join(entries)
    return (
        '<?xml version="1.0"?>\n<feed xmlns="http://www.w3.org/2005/Atom" '
        f'xmlns:arxiv="http://arxiv.org/schemas/atom">{body}\n</feed>'
    )


def entries_for(*ids: str) -> str:
    return "".join(ENTRY.format(id=item) for item in ids)


class RecordingHttp:
    """Mock at the `ArxivHttp` protocol seam: counts calls and replays queued bodies or errors."""

    def __init__(self, responses: list[Any]) -> None:
        self.responses = list(responses)
        self.urls: list[str] = []

    async def get_text(self, url: str) -> str:
        self.urls.append(url)
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return cast(str, response)


def client_for(http: RecordingHttp) -> ArxivClient:
    return ArxivClient(http, ArxivGate(min_interval=0))


def query_of(url: str) -> dict[str, list[str]]:
    return parse_qs(urlparse(url).query)


class ClientFactory:
    """Replaces `httpx.AsyncClient` so the constructor arguments are observable and no socket is opened."""

    def __init__(self, handler: Callable[[httpx.Request], httpx.Response]) -> None:
        self._real = httpx.AsyncClient
        self._handler = handler
        self.kwargs: list[dict[str, Any]] = []

    def __call__(self, **kwargs: Any) -> httpx.AsyncClient:
        self.kwargs.append(kwargs)
        return self._real(transport=httpx.MockTransport(self._handler), **kwargs)


def install_transport(
    monkeypatch: pytest.MonkeyPatch, handler: Callable[[httpx.Request], httpx.Response]
) -> tuple[HttpxArxivHttp, ClientFactory]:
    factory = ClientFactory(handler)
    monkeypatch.setattr(arxiv_module.httpx, "AsyncClient", factory)
    return HttpxArxivHttp(), factory


async def test_production_transport_identifies_luup_and_asks_for_atom(monkeypatch: pytest.MonkeyPatch) -> None:
    """arXiv requires a real user-agent; the request must also ask for Atom, not the HTML page."""
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, text=atom(entries_for("2401.12345")))

    http, factory = install_transport(monkeypatch, handler)

    body = await http.get_text("https://export.arxiv.org/api/query?id_list=2401.12345")

    assert len(factory.kwargs) == 1
    assert factory.kwargs[0]["headers"] == {"user-agent": USER_AGENT}
    assert factory.kwargs[0]["timeout"].read == 30.0
    assert len(seen) == 1
    assert seen[0].headers["accept"] == "application/atom+xml"
    assert seen[0].headers["user-agent"] == USER_AGENT
    assert "2401.12345" in body


@pytest.mark.parametrize("status", [429, 500, 503])
async def test_throttling_and_server_errors_are_retryable(monkeypatch: pytest.MonkeyPatch, status: int) -> None:
    """429 and 5xx are the transient class the one retry exists for."""
    http, _ = install_transport(monkeypatch, lambda request: httpx.Response(status, text="busy"))

    with pytest.raises(ArxivTransientError, match=str(status)):
        await http.get_text("https://export.arxiv.org/api/query?id_list=2401.12345")


@pytest.mark.parametrize("status", [400, 404])
async def test_client_errors_are_not_retryable(monkeypatch: pytest.MonkeyPatch, status: int) -> None:
    """A malformed query must fail immediately instead of burning the retry budget."""
    http, _ = install_transport(monkeypatch, lambda request: httpx.Response(status, text="bad"))

    with pytest.raises(ArxivError) as raised:
        await http.get_text("https://export.arxiv.org/api/query?id_list=2401.12345")

    assert not isinstance(raised.value, ArxivTransientError)


@pytest.mark.parametrize(
    "failure",
    [httpx.ConnectError("dns"), httpx.ReadTimeout("slow"), httpx.ConnectTimeout("handshake")],
    ids=["connect-error", "read-timeout", "connect-timeout"],
)
async def test_transport_failures_are_translated_into_the_typed_transient_error(
    monkeypatch: pytest.MonkeyPatch, failure: Exception
) -> None:
    """No raw httpx exception may escape the client; callers only handle ArxivError."""

    def handler(request: httpx.Request) -> httpx.Response:
        raise failure

    http, _ = install_transport(monkeypatch, handler)

    with pytest.raises(ArxivTransientError) as raised:
        await http.get_text("https://export.arxiv.org/api/query?id_list=2401.12345")

    assert raised.value.__cause__ is failure


async def test_transient_failures_are_retried_exactly_once_then_reported_with_the_cause() -> None:
    http = RecordingHttp([ArxivTransientError("HTTP 429"), ArxivTransientError("HTTP 429")])

    with pytest.raises(ArxivError, match=f"after {MAX_ATTEMPTS} attempts") as raised:
        await client_for(http).search("stellar mechanism")

    assert len(http.urls) == MAX_ATTEMPTS
    assert not isinstance(raised.value, ArxivTransientError)
    assert "429" in str(raised.value)


async def test_a_non_transient_arxiv_error_is_not_retried() -> None:
    """A 4xx already spent the polite-request budget; retrying it only delays the failure."""
    http = RecordingHttp([ArxivError("arXiv API HTTP 404")])

    with pytest.raises(ArxivError, match="404"):
        await client_for(http).search("stellar mechanism")

    assert len(http.urls) == 1


async def test_an_unparsable_body_fails_immediately_rather_than_retrying() -> None:
    """A truncated or HTML error page is a permanent answer, not a transient one."""
    http = RecordingHttp(["<html><body>503 service unavailable"])

    with pytest.raises(ArxivError, match="非 Atom XML"):
        await client_for(http).search("stellar mechanism")

    assert len(http.urls) == 1


async def test_search_sends_the_capped_and_sorted_query_the_api_expects() -> None:
    http = RecordingHttp([atom(entries_for("2401.12345", "2401.12346"))])

    papers = await client_for(http).search("stellar mechanism", max_results=1, sort_by="submittedDate")

    assert query_of(http.urls[0]) == {
        "search_query": ["all:stellar AND all:mechanism"],
        "start": ["0"],
        "max_results": ["1"],
        "sortBy": ["submittedDate"],
        "sortOrder": ["descending"],
    }
    assert [paper.arxiv_id for paper in papers] == ["2401.12345"]


@pytest.mark.parametrize("requested,expected", [(0, "1"), (-5, "1"), (999, "50")])
async def test_max_results_is_clamped_to_the_arxiv_page_limits(requested: int, expected: str) -> None:
    http = RecordingHttp([atom(entries_for("2401.12345"))])

    await client_for(http).search("stellar mechanism", max_results=requested)

    assert query_of(http.urls[0])["max_results"] == [expected]


@pytest.mark.parametrize("query", ["", "   ", "\n\t"])
def test_an_empty_search_term_is_rejected_before_any_request(query: str) -> None:
    with pytest.raises(ArxivError, match="检索词为空"):
        build_search_query(query)


@pytest.mark.parametrize("query", ["!!! ???", "AND OR NOT", "，。；"])
def test_a_search_term_without_a_usable_token_is_rejected(query: str) -> None:
    """Boolean operators alone would become an empty arXiv query that silently matches everything."""
    with pytest.raises(ArxivError, match="没有可用 token"):
        build_search_query(query)


def test_an_explicit_field_prefixed_query_is_passed_through_untouched() -> None:
    assert build_search_query(' ti:"stellar mechanism" AND au:lovelace ') == 'ti:"stellar mechanism" AND au:lovelace'


def test_a_long_question_is_truncated_to_ten_terms() -> None:
    query = build_search_query(" ".join(f"term{index}" for index in range(15)))

    assert query.count(" AND ") == 9
    assert "term10" not in query


@pytest.mark.parametrize(
    "raw",
    [
        "arXiv:2401.12345v2",
        "https://arxiv.org/abs/2401.12345",
        "https://export.arxiv.org/pdf/2401.12345v3.pdf",
        " 2401.12345 ",
    ],
)
def test_every_citation_style_normalizes_to_the_same_canonical_id(raw: str) -> None:
    assert normalize_arxiv_id(raw) == "2401.12345"


@pytest.mark.parametrize("raw", ["", "not-an-id", "2401.123", "10.1000/journal"])
def test_an_unrecognized_id_is_rejected_rather_than_guessed(raw: str) -> None:
    assert normalize_arxiv_id(raw) is None


async def test_error_entries_and_unusable_ids_are_dropped_from_the_feed() -> None:
    """arXiv answers a bad id with an entry whose id points at api/errors; it is not a paper."""
    feed = atom(
        """
  <entry><id>http://arxiv.org/api/errors#incorrect_id_format</id><title>Error</title>
    <summary>incorrect id format</summary></entry>""",
        """
  <entry><id>http://arxiv.org/abs/not-an-id</id><title>Unusable</title></entry>""",
        """
  <entry><id></id><title>No id at all</title></entry>""",
        entries_for("2401.12345"),
    )
    http = RecordingHttp([feed])

    papers = await client_for(http).search("stellar mechanism")

    assert [paper.arxiv_id for paper in papers] == ["2401.12345"]


async def test_missing_dates_and_primary_category_fall_back_instead_of_failing() -> None:
    """A sparse entry still has to produce a card; year 0 makes the gap visible to the verifier."""
    feed = atom(
        """
  <entry><id>http://arxiv.org/abs/2401.12345</id><title>Sparse Entry</title>
    <category term="astro-ph.SR"/><category term="astro-ph.HE"/></entry>"""
    )
    http = RecordingHttp([feed])

    papers = await client_for(http).search("stellar mechanism")

    assert papers[0].year == 0
    assert papers[0].published == "" and papers[0].updated == ""
    assert papers[0].version is None
    assert papers[0].authors == ()
    assert papers[0].primary_category == "astro-ph.SR"
    assert papers[0].categories == ("astro-ph.SR", "astro-ph.HE")
    assert papers[0].abs_url == "https://arxiv.org/abs/2401.12345"


async def test_get_many_deduplicates_citations_and_preserves_the_requested_order() -> None:
    http = RecordingHttp([atom(entries_for("2401.12346", "2401.12345"))])

    papers = await client_for(http).get_many(
        ["arXiv:2401.12345v2", "https://arxiv.org/abs/2401.12345", "2401.12346", "bad-id"]
    )

    assert len(http.urls) == 1
    assert query_of(http.urls[0]) == {"id_list": ["2401.12345,2401.12346"], "max_results": ["2"]}
    assert [paper.arxiv_id for paper in papers] == ["2401.12345", "2401.12346"]


async def test_get_many_drops_ids_arxiv_did_not_return() -> None:
    """B1 owns the missing-reference failure; the client must not invent a placeholder card."""
    http = RecordingHttp([atom(entries_for("2401.12345"))])

    papers = await client_for(http).get_many(["2401.12345", "2401.12399"])

    assert [paper.arxiv_id for paper in papers] == ["2401.12345"]


async def test_get_many_without_a_single_valid_id_makes_no_request() -> None:
    http = RecordingHttp([])

    assert await client_for(http).get_many(["bad-id", ""]) == []
    assert http.urls == []


async def test_get_many_batches_more_than_fifty_ids_into_separate_requests() -> None:
    """The arXiv id_list endpoint is paged; a 51-reference proposal must still resolve fully."""
    ids = [f"2401.{10000 + index}" for index in range(51)]
    http = RecordingHttp([atom(entries_for(*ids[:50])), atom(entries_for(*ids[50:]))])

    papers = await client_for(http).get_many(ids)

    assert len(http.urls) == 2
    assert len(query_of(http.urls[0])["id_list"][0].split(",")) == 50
    assert query_of(http.urls[1]) == {"id_list": [ids[50]], "max_results": ["1"]}
    assert [paper.arxiv_id for paper in papers] == ids
