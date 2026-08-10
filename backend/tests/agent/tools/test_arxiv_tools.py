from __future__ import annotations

import asyncio
import json
from collections.abc import Sequence
from pathlib import Path
from typing import cast

import httpx
import pytest

from app.agent.specialists import backfill_reference_metadata
from app.agent.tools.arxiv import ArxivClient, ArxivError, ArxivGate, ArxivPaper, build_search_query
from app.agent.tools.runtime import LuupTools, ReviewerSearchRequiredError, SearchIntentLimitError
from app.agent.verifier import FileReferenceVerifier
from app.domain.contracts import Evidence, Proposal, ScientistOutput
from app.domain.references import PaperCard

ATOM = """<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2401.12345v2</id><updated>2024-01-20T00:00:00Z</updated><published>2024-01-10T00:00:00Z</published>
    <title>Observed Mechanism</title><summary>A real abstract sentence used as the deterministic index summary.</summary>
    <author><name>Ada Lovelace</name></author><category term="astro-ph.SR"/><arxiv:primary_category term="astro-ph.SR"/>
  </entry>
</feed>"""


class FakeHttp:
    def __init__(self, responses: list[object]) -> None:
        self.responses = responses
        self.urls: list[str] = []

    async def get_text(self, url: str) -> str:
        self.urls.append(url)
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return cast(str, response)


def no_wait_gate() -> ArxivGate:
    return ArxivGate(min_interval=0)


def test_plain_language_search_uses_token_and_not_an_overly_strict_phrase() -> None:
    assert build_search_query("electron capture supernova") == "all:electron AND all:capture AND all:supernova"


async def test_arxiv_retries_one_transient_error_then_parses_authoritative_atom() -> None:
    http = FakeHttp([httpx.ReadTimeout("temporary"), ATOM])
    client = ArxivClient(http, no_wait_gate())

    papers = await client.search("stellar mechanism")

    assert len(http.urls) == 2
    assert papers[0].arxiv_id == "2401.12345"
    assert papers[0].version == "v2"
    assert papers[0].authors == ("Ada Lovelace",)
    assert papers[0].title == "Observed Mechanism"


async def test_gate_enforces_three_seconds_between_all_external_requests_without_real_sleep() -> None:
    now = [10.0]
    sleeps: list[float] = []

    async def sleep(seconds: float) -> None:
        sleeps.append(seconds)
        now[0] += seconds

    gate = ArxivGate(clock=lambda: now[0], sleeper=sleep)

    assert await gate.run(lambda: _value("first")) == "first"
    assert await gate.run(lambda: _value("second")) == "second"
    assert sleeps == [3.0]


async def test_scientist_search_has_two_unique_intents_and_same_run_deduplication(tmp_path: Path) -> None:
    http = FakeHttp([ATOM, ATOM])
    tools = LuupTools(tmp_path / "run", tmp_path / "memory", ArxivClient(http, no_wait_gate()))

    async with tools.scientist_scope():
        first = await tools.search("stellar mechanism")
        duplicate = await tools.search("  STELLAR   mechanism ")
        await tools.search("different mechanism")
        with pytest.raises(SearchIntentLimitError):
            await tools.search("third mechanism")

    async with tools.scientist_scope():
        await tools.search("stellar mechanism")

    assert first["deduplicated"] is False
    assert duplicate["deduplicated"] is True
    assert len(http.urls) == 2


async def test_reviewer_must_make_at_least_one_new_search(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    tools = LuupTools(run_dir, tmp_path / "memory", ArxivClient(FakeHttp([ATOM]), no_wait_gate()))

    with pytest.raises(ReviewerSearchRequiredError):
        async with tools.reviewer_scope():
            pass

    async with tools.reviewer_scope():
        await tools.search("independent counterevidence")

    event = json.loads((run_dir / "tool-events.jsonl").read_text(encoding="utf-8"))
    assert event["agent"] == "reviewer"
    assert event["tool"] == "arxiv_search"
    assert event["deduplicated"] is False


async def test_failed_reviewer_search_does_not_satisfy_independent_search_requirement(tmp_path: Path) -> None:
    tools = LuupTools(
        tmp_path / "run",
        tmp_path / "memory",
        ArxivClient(FakeHttp([httpx.ReadTimeout("first"), httpx.ReadTimeout("retry")]), no_wait_gate()),
    )

    with pytest.raises(ReviewerSearchRequiredError):
        async with tools.reviewer_scope():
            with pytest.raises(ArxivError):
                await tools.search("failed counterevidence")


async def test_reviewer_search_must_return_information_not_seen_by_scientist(tmp_path: Path) -> None:
    tools = LuupTools(tmp_path / "run", tmp_path / "memory", ArxivClient(FakeHttp([ATOM, ATOM]), no_wait_gate()))

    async with tools.scientist_scope():
        await tools.search("scientist evidence")

    with pytest.raises(ReviewerSearchRequiredError):
        async with tools.reviewer_scope():
            await tools.search("same paper under a different query")


async def test_reviewer_budget_survives_sdk_style_child_tasks(tmp_path: Path) -> None:
    tools = LuupTools(
        tmp_path / "run",
        tmp_path / "memory",
        ArxivClient(FakeHttp([ATOM, ATOM, ATOM]), no_wait_gate()),
    )

    async with tools.reviewer_scope():
        for index in range(3):
            await asyncio.create_task(tools.search(f"independent query {index}"))
        with pytest.raises(SearchIntentLimitError):
            await asyncio.create_task(tools.search("fourth query"))


async def test_save_index_memory_and_deterministic_verifier_use_only_run_local_cards(tmp_path: Path) -> None:
    paper = ArxivPaper(
        arxiv_id="2401.12345",
        version=None,
        title="Observed Mechanism",
        authors=("Ada Lovelace",),
        summary="A real abstract sentence used as the deterministic index summary.",
        published="2024-01-10T00:00:00Z",
        updated="2024-01-20T00:00:00Z",
        year=2024,
        primary_category="astro-ph.SR",
        categories=("astro-ph.SR",),
        abs_url="https://arxiv.org/abs/2401.12345",
    )
    fake = FakeArxiv([paper])
    run_dir = tmp_path / "run"
    (tmp_path / "memory").mkdir()
    (tmp_path / "memory" / "lessons.md").write_text("stellar mechanism was useful\n", encoding="utf-8")
    tools = LuupTools(run_dir, tmp_path / "memory", cast(ArxivClient, fake))

    saved = await tools.save(["arXiv:2401.12345v2", "bad-id"])
    memory = tools.read_memory("stellar")
    proposal = _proposal()
    verification = await FileReferenceVerifier(cast(ArxivClient, fake)).verify(proposal, run_dir)

    assert saved["savedCount"] == 1
    assert saved["rejectedIds"] == ["bad-id"]
    assert "2401.12345" in tools.read_index()["index"]
    assert "deterministic index summary" in tools.read_index()["index"]
    assert memory["hitCount"] == 1
    assert verification["ok"] is False  # Four proposal references are not in this run's saved cards.
    assert "B1.2401.12346" in verification["failed"]


def test_saved_card_backfill_overrides_model_metadata_but_leaves_unknown_id_for_b1() -> None:
    proposal = _proposal()
    first = proposal.references[0].model_copy(
        update={"title": "invented title", "authors": ["Invented Author"], "year": 1999}
    )
    proposal = proposal.model_copy(update={"references": [first, *proposal.references[1:]]})
    output = ScientistOutput(
        evidence=[
            Evidence(claim=f"claim {index}", arxivId=f"2401.1234{index}", relevance="evidence") for index in range(5)
        ],
        proposal=proposal,
    )

    backfilled = backfill_reference_metadata(
        output,
        {
            "2401.12345": PaperCard(
                arxiv_id="2401.12345", title="Observed Mechanism", authors=["Ada Lovelace"], year=2024
            )
        },
    )

    assert backfilled.proposal.references[0].title == "Observed Mechanism"
    assert backfilled.proposal.references[0].authors == ["Ada Lovelace"]
    assert backfilled.proposal.references[0].year == 2024
    assert backfilled.proposal.references[1] == proposal.references[1]


async def _value(value: str) -> str:
    await asyncio.sleep(0)
    return value


class FakeArxiv:
    def __init__(self, papers: Sequence[ArxivPaper]) -> None:
        self.papers = list(papers)

    async def search(self, query: str, max_results: int = 10, sort_by: str = "relevance") -> list[ArxivPaper]:
        return self.papers[:max_results]

    async def get_many(self, raw_ids: Sequence[str]) -> list[ArxivPaper]:
        wanted = set(raw_ids)
        return [paper for paper in self.papers if paper.arxiv_id in wanted]


def _proposal() -> Proposal:
    refs = [
        {
            "arxivId": f"2401.1234{i}",
            "title": "Observed Mechanism",
            "authors": ["Ada Lovelace"],
            "year": 2024,
            "relevance": "supports the test",
        }
        for i in range(5, 10)
    ]
    return Proposal.model_validate(
        {
            "problemStatement": "A specific unresolved observational limitation is described for this deterministic test fixture.",
            "rationale": "A long enough causal chain connects the saved evidence to a falsifiable hypothesis and an observable prediction for the test.",
            "technicalDetails": "A calibrated telescope pipeline and a registered statistical comparison test the proposed mechanism.",
            "datasets": {
                "source": "A documented public astronomical survey dataset.",
                "target": "New observations with cadence and sensitivity constraints.",
            },
            "paperTitle": "A Falsifiable Test Plan",
            "paperAbstract": "This sufficiently long abstract includes scientific background, the proposed method, expected outcomes, and an explicit validation plan for the offline fixture.",
            "methods": "Prepare the data, fit the mechanism, compare against controls, and apply a predetermined falsification rule to held-out observations.",
            "experiments": {
                "baselines": ["baseline"],
                "metrics": ["metric"],
                "design": "Compare the mechanism with a negative control in a held-out observational sample.",
            },
            "results": "A measurable positive result supports the mechanism, while a null result refutes it under the stated observation sensitivity assumptions.",
            "references": refs,
        }
    )
