from __future__ import annotations

import json
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest
from agents.usage import Usage
from pydantic import BaseModel

from app.agent import specialists as specialists_module
from app.agent.model import QWEN_THINKING_ENABLED, QwenSettings
from app.agent.specialists import (
    REVIEWER_MAX_TURNS,
    SCIENTIST_MAX_TURNS,
    AgentsSdkSpecialistRunner,
    RevisionRequest,
)
from app.agent.tools.runtime import ReviewerSearchRequiredError
from app.domain.contracts import Evidence, Proposal, Review, ReviewFinding, ScientistOutput
from app.domain.references import PaperCard

OFFLINE_SETTINGS = QwenSettings(base_url="https://dashscope.invalid/compatible-mode/v1", api_key="offline-test-key")
_ABSENT = object()


class SpyTools:
    """Mock at the `ToolOwnership` seam: records scope order, never touches arXiv or disk.

    The four tool attributes are sentinels — the specialists module only forwards
    them to `Agent(tools=...)`, so identity is exactly what the ownership
    boundary is made of.
    """

    def __init__(
        self, cards: Mapping[str, PaperCard] | None = None, *, reviewer_scope_error: Exception | None = None
    ) -> None:
        self.memory_search = "tool:memory_search"
        self.arxiv_search = "tool:arxiv_search"
        self.arxiv_save = "tool:arxiv_save"
        self.paper_index_read = "tool:paper_index_read"
        self.events: list[str] = []
        self.tool_events: list[dict[str, Any]] = []
        self.cards_calls = 0
        self._cards = dict(cards or {})
        self._reviewer_scope_error = reviewer_scope_error

    @asynccontextmanager
    async def scientist_scope(self) -> AsyncIterator[None]:
        self.events.append("enter:scientist")
        try:
            yield
        finally:
            self.events.append("exit:scientist")

    @asynccontextmanager
    async def reviewer_scope(self) -> AsyncIterator[None]:
        self.events.append("enter:reviewer")
        try:
            yield
            if self._reviewer_scope_error is not None:
                raise self._reviewer_scope_error
        finally:
            self.events.append("exit:reviewer")

    def saved_paper_cards(self) -> Mapping[str, PaperCard]:
        self.cards_calls += 1
        return self._cards

    def append_tool_event(self, *, tool: str, **fields: Any) -> None:
        self.tool_events.append({"tool": tool, **fields})


def _sdk_result(final_output: Any, usage: Any = _ABSENT) -> SimpleNamespace:
    """`RunResult` carries token accounting on `context_wrapper.usage`, never on the result itself.

    `_ABSENT` reproduces the shape the adapter used to read by mistake: a result object
    with no `usage` attribute at all, which is why usage.jsonl came out empty.
    """
    result = SimpleNamespace(final_output=final_output, context_wrapper=SimpleNamespace(usage=None))
    if usage is not _ABSENT:
        result.context_wrapper.usage = usage
    else:
        result.usage = "a decoy that must never be read"
    return result


def _install_runner(
    monkeypatch: pytest.MonkeyPatch,
    tools: SpyTools,
    *,
    final_output: Any,
    usage: Any = _ABSENT,
    prompt_dir: Path | None = None,
) -> tuple[AgentsSdkSpecialistRunner, AsyncMock]:
    async def _run(agent: Any, payload: str, *, max_turns: int) -> Any:
        tools.events.append("run")
        return _sdk_result(final_output, usage)

    sdk_run = AsyncMock(side_effect=_run)
    monkeypatch.setattr(specialists_module.Runner, "run", sdk_run)
    return AgentsSdkSpecialistRunner(OFFLINE_SETTINGS, tools, prompt_dir), sdk_run


def _await_args(sdk_run: AsyncMock) -> tuple[tuple[Any, ...], dict[str, Any]]:
    call = sdk_run.await_args
    assert call is not None
    return call.args, call.kwargs


def _reference(index: int, **overrides: Any) -> dict[str, Any]:
    return {
        "arxivId": f"2401.1234{index}",
        "title": "Observed Mechanism",
        "authors": ["Ada Lovelace"],
        "year": 2024,
        "relevance": "supports the falsification plan",
        **overrides,
    }


def _proposal_payload(**overrides: Any) -> dict[str, Any]:
    return {
        "problemStatement": "A specific unresolved observational limitation is described for this deterministic test.",
        "rationale": "A long enough causal chain connects the saved evidence to a falsifiable hypothesis and to an "
        "observable prediction that this offline fixture can assert on.",
        "technicalDetails": "A calibrated telescope pipeline and a registered statistical comparison are described.",
        "datasets": {
            "source": "A documented public astronomical survey dataset.",
            "target": "New observations with cadence and sensitivity constraints.",
        },
        "paperTitle": "A Falsifiable Test Plan",
        "paperAbstract": "This sufficiently long abstract includes scientific background, the proposed method, the "
        "expected outcomes, and an explicit validation plan for the offline fixture used by these tests.",
        "methods": "Prepare the data, fit the mechanism, compare against controls, and apply a predetermined "
        "falsification rule to held-out observations.",
        "experiments": {
            "baselines": ["baseline"],
            "metrics": ["metric"],
            "design": "Compare the mechanism with a negative control in a held-out observational sample.",
        },
        "results": "A measurable positive result supports the mechanism, while a null result refutes it under the "
        "stated observation sensitivity assumptions.",
        "references": [_reference(index) for index in range(5)],
        **overrides,
    }


def _scientist_payload(**overrides: Any) -> dict[str, Any]:
    return {
        "evidence": [
            {"claim": f"claim {index}", "arxivId": f"2401.1234{index}", "relevance": "evidence"} for index in range(5)
        ],
        "proposal": _proposal_payload(),
        **overrides,
    }


def _review_payload() -> dict[str, Any]:
    return {
        "verdict": "pass",
        "findings": [{"issue": "no blocking issue", "checkedWith": "an independent arXiv search"}],
        "requiredChanges": [],
    }


def test_parse_accepts_sdk_validated_model_instance() -> None:
    output = ScientistOutput.model_construct()

    parsed = AgentsSdkSpecialistRunner._parse(output, ScientistOutput)

    assert parsed is output


def test_parse_accepts_bailian_preface_and_markdown_fence() -> None:
    output = Review(
        verdict="pass",
        findings=[ReviewFinding(issue="no blocking issue", checkedWith="arXiv search returned a new paper")],
        requiredChanges=[],
    )
    payload = output.model_dump_json()

    parsed = AgentsSdkSpecialistRunner._parse(f"I have completed the tools.\n```json\n{payload}\n```", Review)

    assert parsed == output


async def test_scientist_run_happens_inside_the_scientist_scope_and_backfills_saved_cards(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The model call is bracketed by the tool scope, and only arxiv_save cards may author metadata."""
    tools = SpyTools({"2401.12340": PaperCard(arxiv_id="2401.12340", title="Card Title", authors=["G. Hopper"], year=2020)})
    runner, sdk_run = _install_runner(monkeypatch, tools, final_output=json.dumps(_scientist_payload()))

    result = await runner.run_scientist("why do some stars explode?")

    assert sdk_run.await_count == 1
    (agent, payload), kwargs = _await_args(sdk_run)
    assert kwargs == {"max_turns": SCIENTIST_MAX_TURNS}
    assert agent.name == "scientist"
    assert json.loads(payload) == {"question": "why do some stars explode?"}
    assert tools.events == ["enter:scientist", "run", "exit:scientist"]
    assert tools.cards_calls == 1
    assert isinstance(result.output, ScientistOutput)
    assert result.output.proposal.references[0].title == "Card Title"
    assert result.output.proposal.references[0].authors == ["G. Hopper"]
    assert result.output.proposal.references[1].title == "Observed Mechanism"


async def test_a_metadata_override_during_backfill_reaches_the_tool_event_log(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The override rescues the run; the record is what tells a reviewer the model drifted."""
    tools = SpyTools({"2401.12340": PaperCard(arxiv_id="2401.12340", title="Card Title", authors=["G. Hopper"], year=2020)})
    runner, _ = _install_runner(monkeypatch, tools, final_output=json.dumps(_scientist_payload()))

    await runner.run_scientist("why do some stars explode?")

    assert len(tools.tool_events) == 1
    event = tools.tool_events[0]
    assert event["tool"] == "reference_backfill"
    assert event["arxivId"] == "2401.12340"
    assert event["fields"] == ["title", "authors", "year"]
    assert event["before"]["title"] == "Observed Mechanism"
    assert event["after"]["title"] == "Card Title"


async def test_revision_request_is_sent_as_previous_proposal_and_required_changes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A second scientist round must carry the rejected proposal, not just the question again."""
    tools = SpyTools()
    runner, sdk_run = _install_runner(monkeypatch, tools, final_output=json.dumps(_scientist_payload()))
    revision = RevisionRequest(
        proposal=Proposal.model_validate(_proposal_payload()),
        required_changes=("add a negative control", "cite one 2024 observation"),
        findings=(ReviewFinding(issue="no negative control", checkedWith="arXiv search: control designs"),),
    )

    await runner.run_scientist("why do some stars explode?", revision)

    assert sdk_run.await_count == 1
    message = json.loads(_await_args(sdk_run)[0][1])
    assert set(message) == {"question", "previousProposal", "requiredChanges", "findings"}
    assert message["requiredChanges"] == ["add a negative control", "cite one 2024 observation"]
    assert message["previousProposal"]["paperTitle"] == "A Falsifiable Test Plan"
    assert message["findings"] == [{"issue": "no negative control", "checkedWith": "arXiv search: control designs"}]


async def test_scientist_agent_owns_its_prompt_and_all_four_tools(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Agent wiring is a contract: the scientist prompt file and the write-capable tool set."""
    (tmp_path / "scientist.md").write_text("SCIENTIST PROMPT\n", encoding="utf-8")
    (tmp_path / "reviewer.md").write_text("REVIEWER PROMPT\n", encoding="utf-8")
    tools = SpyTools()
    runner, sdk_run = _install_runner(
        monkeypatch, tools, final_output=json.dumps(_scientist_payload()), prompt_dir=tmp_path
    )

    await runner.run_scientist("why do some stars explode?")

    agent = _await_args(sdk_run)[0][0]
    assert agent.instructions == "SCIENTIST PROMPT\n"
    assert agent.tools == [tools.memory_search, tools.arxiv_search, tools.arxiv_save, tools.paper_index_read]


async def test_reviewer_agent_owns_its_prompt_and_cannot_reach_the_write_tools(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """The reviewer may search and read the index, but never save papers or read campaign memory."""
    (tmp_path / "scientist.md").write_text("SCIENTIST PROMPT\n", encoding="utf-8")
    (tmp_path / "reviewer.md").write_text("REVIEWER PROMPT\n", encoding="utf-8")
    tools = SpyTools()
    runner, sdk_run = _install_runner(monkeypatch, tools, final_output=json.dumps(_review_payload()), prompt_dir=tmp_path)
    proposal = Proposal.model_validate(_proposal_payload())
    evidence = [Evidence(claim="a claim", arxivId="2401.12340", relevance="evidence")]

    result = await runner.run_reviewer("why do some stars explode?", evidence, proposal)

    assert sdk_run.await_count == 1
    (agent, payload), kwargs = _await_args(sdk_run)
    assert kwargs == {"max_turns": REVIEWER_MAX_TURNS}
    assert agent.name == "reviewer"
    assert agent.instructions == "REVIEWER PROMPT\n"
    assert agent.tools == [tools.arxiv_search, tools.paper_index_read]
    assert tools.arxiv_save not in agent.tools and tools.memory_search not in agent.tools
    message = json.loads(payload)
    assert message["evidence"] == [{"claim": "a claim", "arxivId": "2401.12340", "relevance": "evidence"}]
    assert message["proposal"]["paperTitle"] == "A Falsifiable Test Plan"
    assert tools.events == ["enter:reviewer", "run", "exit:reviewer"]
    assert isinstance(result.output, Review) and result.output.verdict == "pass"


async def test_reviewer_scope_failure_after_the_model_returns_is_not_swallowed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Fail-closed: a review whose scope never made an independent search must not become a result."""
    tools = SpyTools(reviewer_scope_error=ReviewerSearchRequiredError("Reviewer 必须执行至少一次独立的新 arXiv 检索。"))
    runner, sdk_run = _install_runner(monkeypatch, tools, final_output=json.dumps(_review_payload()))
    proposal = Proposal.model_validate(_proposal_payload())

    with pytest.raises(ReviewerSearchRequiredError):
        await runner.run_reviewer("why do some stars explode?", [], proposal)

    assert sdk_run.await_count == 1
    assert tools.events == ["enter:reviewer", "run", "exit:reviewer"]


async def test_uncontracted_model_output_fails_closed_without_a_silent_retry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A contract violation is a typed error to the Harness — the adapter never retries behind its back."""
    tools = SpyTools()
    runner, sdk_run = _install_runner(
        monkeypatch, tools, final_output=json.dumps({"evidence": [], "proposal": {}}, ensure_ascii=False)
    )

    with pytest.raises(RuntimeError, match="契约校验"):
        await runner.run_scientist("why do some stars explode?")

    assert sdk_run.await_count == 1
    assert tools.cards_calls == 0


async def test_structured_sdk_output_is_serialized_before_contract_validation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Bailian may return a parsed object rather than text; the same contract still gates it."""
    tools = SpyTools()
    runner, _ = _install_runner(monkeypatch, tools, final_output=_review_payload())
    proposal = Proposal.model_validate(_proposal_payload())

    result = await runner.run_reviewer("why do some stars explode?", [], proposal)

    assert isinstance(result.output, Review)
    assert result.output.findings[0].checked_with == "an independent arXiv search"


class _PydanticUsage(BaseModel):
    total_tokens: int


@pytest.mark.parametrize(
    ("usage", "expected"),
    [
        pytest.param(_ABSENT, None, id="context-wrapper-without-usage"),
        pytest.param(None, None, id="explicit-none"),
        pytest.param(_PydanticUsage(total_tokens=7), {"total_tokens": 7}, id="pydantic-usage-is-dumped"),
        pytest.param("41 tokens", {"value": "41 tokens"}, id="unknown-shape-is-stringified"),
    ],
)
async def test_usage_is_normalized_for_the_usage_jsonl_artifact(
    monkeypatch: pytest.MonkeyPatch, usage: Any, expected: Mapping[str, Any] | None
) -> None:
    """Token accounting is evidence: whatever the SDK hands back must survive as a mapping or be None."""
    tools = SpyTools()
    runner, _ = _install_runner(monkeypatch, tools, final_output=json.dumps(_review_payload()), usage=usage)
    proposal = Proposal.model_validate(_proposal_payload())

    result = await runner.run_reviewer("why do some stars explode?", [], proposal)

    assert result.usage == expected


async def test_usage_comes_from_the_run_context_wrapper_and_stays_json_serializable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`agents.usage.Usage` nests detail dataclasses; usage.jsonl needs plain JSON, not a repr."""
    tools = SpyTools()
    runner, _ = _install_runner(
        monkeypatch,
        tools,
        final_output=json.dumps(_review_payload()),
        usage=Usage(requests=1, input_tokens=40, output_tokens=59, total_tokens=99),
    )
    proposal = Proposal.model_validate(_proposal_payload())

    result = await runner.run_reviewer("why do some stars explode?", [], proposal)

    assert result.usage is not None
    assert result.usage["requests"] == 1
    assert result.usage["input_tokens"] == 40
    assert result.usage["output_tokens"] == 59
    assert result.usage["total_tokens"] == 99
    assert result.usage["output_tokens_details"] == {"reasoning_tokens": 0}
    assert json.loads(json.dumps(dict(result.usage)))["total_tokens"] == 99


async def test_the_reported_thinking_flag_is_the_one_actually_sent_to_bailian(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """One truth for `enable_thinking`: the same constant reaches ModelSettings and usage.jsonl."""
    tools = SpyTools()
    runner, sdk_run = _install_runner(monkeypatch, tools, final_output=json.dumps(_review_payload()))
    proposal = Proposal.model_validate(_proposal_payload())

    result = await runner.run_reviewer("why do some stars explode?", [], proposal)

    agent = _await_args(sdk_run)[0][0]
    assert agent.model_settings.extra_body == {"enable_thinking": QWEN_THINKING_ENABLED}
    assert result.thinking is QWEN_THINKING_ENABLED
