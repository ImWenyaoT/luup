from __future__ import annotations

import asyncio
import json
from collections.abc import Sequence
from pathlib import Path
from typing import cast

import httpx
import pytest
from agents.tool_context import ToolContext

from app.agent.specialists import backfill_reference_metadata
from app.agent.tools.arxiv import ArxivClient, ArxivError, ArxivGate, ArxivPaper, build_search_query
from app.agent.tools.runtime import (
    LuupTools,
    ReviewerSearchRequiredError,
    SearchIntentLimitError,
    tool_error_message,
)
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


def test_every_tool_hands_the_model_a_description_and_documented_arguments(tmp_path: Path) -> None:
    """An empty tool description is the single biggest measured error source in ch4."""
    tools = LuupTools(tmp_path / "run", tmp_path / "memory")

    exposed = {
        tool.name: tool
        for tool in (tools.memory_search, tools.arxiv_search, tools.arxiv_save, tools.paper_index_read)
    }

    assert set(exposed) == {"memory_search", "arxiv_search", "arxiv_save", "paper_index_read"}
    for name, tool in exposed.items():
        assert len(tool.description.strip()) >= 40, name
    assert "arXiv" in exposed["arxiv_search"].description
    search_properties = exposed["arxiv_search"].params_json_schema["properties"]
    assert all(search_properties[argument].get("description") for argument in ("query", "max_results", "sort_by"))
    assert "2401.12345" in exposed["arxiv_save"].params_json_schema["properties"]["arxiv_ids"]["description"]


async def test_search_reports_the_rewritten_query_the_new_count_and_the_remaining_budget(tmp_path: Path) -> None:
    """The model cannot correct a silent AND rewrite, or ration a budget, it cannot see."""
    http = FakeHttp([ATOM])
    tools = LuupTools(tmp_path / "run", tmp_path / "memory", ArxivClient(http, no_wait_gate()))

    async with tools.scientist_scope():
        first = await tools.search("electron capture supernova")
        cached = await tools.search("electron   capture supernova")

    assert first["arxivQuery"] == "all:electron AND all:capture AND all:supernova"
    assert first["newCount"] == 1
    assert first["searchIntentsUsed"] == 1
    assert first["searchIntentsMax"] == 2
    assert "hint" not in first
    assert cached["deduplicated"] is True
    assert cached["arxivQuery"] == first["arxivQuery"]
    assert cached["searchIntentsUsed"] == 1


async def test_a_search_that_returns_only_known_papers_says_so_instead_of_looking_successful(
    tmp_path: Path,
) -> None:
    """`newCount` used to reach only the log, while the Reviewer was judged on it."""
    tools = LuupTools(tmp_path / "run", tmp_path / "memory", ArxivClient(FakeHttp([ATOM, ATOM]), no_wait_gate()))

    async with tools.scientist_scope():
        await tools.search("first angle")
        repeated = await tools.search("second angle onto the same paper")

    assert repeated["newCount"] == 0
    assert "换角度" in str(repeated["hint"])


def test_a_budget_error_tells_the_model_to_stop_searching_rather_than_try_again() -> None:
    """The SDK default ends a terminal budget error with "Please try again", which burns turns."""
    budget = tool_error_message(None, SearchIntentLimitError("Scientist 单次运行最多 2 个检索意图。"))
    outage = tool_error_message(None, ArxivError("arXiv transient failure after 2 attempts"))

    assert "预算已尽" in budget
    assert "不要再调用检索" in budget
    assert "Please try again" not in budget
    assert "不要原样重试" in outage


async def test_the_budget_error_message_is_what_the_sdk_hands_back_to_the_model(tmp_path: Path) -> None:
    tools = LuupTools(tmp_path / "run", tmp_path / "memory", ArxivClient(FakeHttp([ATOM, ATOM]), no_wait_gate()))

    arguments = json.dumps({"query": "a third angle"})

    async with tools.scientist_scope():
        await tools.search("first angle")
        await tools.search("second angle")
        answer = await tools.arxiv_search.on_invoke_tool(
            ToolContext(
                context=None, tool_name="arxiv_search", tool_call_id="call-1", tool_arguments=arguments
            ),
            arguments,
        )

    assert "预算已尽" in answer


async def test_each_of_the_four_tools_leaves_one_tool_event(tmp_path: Path) -> None:
    """`memory_search` used to leave zero trace, so nobody could tell whether it ran."""
    run_dir = tmp_path / "run"
    (tmp_path / "memory").mkdir()
    (tmp_path / "memory" / "lessons.md").write_text("stellar mechanism was useful\n", encoding="utf-8")
    tools = LuupTools(run_dir, tmp_path / "memory", ArxivClient(FakeHttp([ATOM, ATOM]), no_wait_gate()))

    async with tools.scientist_scope():
        await tools.search("stellar mechanism")
        await tools.save(["2401.12345", "bad-id"])
        tools.read_index()
        tools.read_memory("stellar")

    events = [json.loads(line) for line in (run_dir / "tool-events.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [event["tool"] for event in events] == [
        "arxiv_search",
        "arxiv_save",
        "paper_index_read",
        "memory_search",
    ]
    assert all(event["agent"] == "scientist" for event in events)
    assert events[1]["savedCount"] == 1 and events[1]["rejectedCount"] == 1
    assert events[3]["hitCount"] == 1 and events[3]["enabled"] is True


async def test_the_memory_off_arm_disables_the_tool_without_a_missing_directory(tmp_path: Path) -> None:
    """The ablation arm must be a switch, not a deleted directory."""
    (tmp_path / "memory").mkdir()
    (tmp_path / "memory" / "lessons.md").write_text("stellar mechanism was useful\n", encoding="utf-8")
    tools = LuupTools(tmp_path / "run", None, ArxivClient(FakeHttp([]), no_wait_gate()))

    result = tools.read_memory("stellar")

    assert result == {
        "enabled": False,
        "hitCount": 0,
        "hits": [],
        "hint": "长期记忆未启用；这不是错误，照常走 arxiv_search。",
    }


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
    index = str(tools.read_index()["index"])
    assert "| arXiv id | 年份 | 第一作者 | 标题 | 一句话摘要 |" in index  # B4 是按第一作者判的。
    assert "| 2401.12345 | 2024 | Ada Lovelace | Observed Mechanism |" in index
    assert "deterministic index summary" in index
    assert memory["hitCount"] == 1
    assert verification["ok"] is False  # Four proposal references are not in this run's saved cards.
    assert "B1.2401.12346" in verification["failed"]


async def test_an_arxiv_outage_during_verification_is_flagged_as_infrastructure_not_bad_references(
    tmp_path: Path,
) -> None:
    """B2.resolve failing because arXiv is down is not the same evidence as a fabricated title."""

    class OfflineArxiv:
        async def get_many(self, raw_ids: Sequence[str]) -> list[ArxivPaper]:
            raise ArxivError("arXiv transient failure after 2 attempts")

    verification = await FileReferenceVerifier(cast(ArxivClient, OfflineArxiv())).verify(_proposal(), tmp_path / "run")

    assert verification["ok"] is False
    assert verification["infraError"] is True
    assert "B2.resolve" in verification["failed"]


async def test_a_complete_offline_verification_reports_no_infrastructure_error(tmp_path: Path) -> None:
    verification = await FileReferenceVerifier(cast(ArxivClient, FakeArxiv([]))).verify(_proposal(), tmp_path / "run")

    assert verification["infraError"] is False


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


def test_a_silent_backfill_overwrite_is_reported_as_a_mismatch() -> None:
    """ch5 log_mismatch: the override that saves the run is also the signal the model drifted."""
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
    recorded: list[dict[str, object]] = []

    backfill_reference_metadata(
        output,
        {
            "2401.12345": PaperCard(
                arxiv_id="2401.12345", title="Observed Mechanism", authors=["Ada Lovelace"], year=2024
            )
        },
        on_mismatch=recorded.append,
    )

    assert len(recorded) == 1
    assert recorded[0]["arxivId"] == "2401.12345"
    assert recorded[0]["fields"] == ["title", "authors", "year"]
    assert recorded[0]["before"] == {"title": "invented title", "authors": ["Invented Author"], "year": 1999}
    assert recorded[0]["after"] == {"title": "Observed Mechanism", "authors": ["Ada Lovelace"], "year": 2024}


def test_a_backfill_that_changes_nothing_reports_no_mismatch() -> None:
    output = ScientistOutput(
        evidence=[
            Evidence(claim=f"claim {index}", arxivId=f"2401.1234{index}", relevance="evidence") for index in range(5)
        ],
        proposal=_proposal(),
    )
    recorded: list[dict[str, object]] = []

    backfill_reference_metadata(
        output,
        {
            "2401.12345": PaperCard(
                arxiv_id="2401.12345", title="Observed Mechanism", authors=["Ada Lovelace"], year=2024
            )
        },
        on_mismatch=recorded.append,
    )

    assert recorded == []


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
