"""The two LLM specialists and their narrow tool ownership boundaries."""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, cast

from agents import Agent, Runner
from pydantic import ValidationError

from app.domain.contracts import Evidence, Proposal, Reference, Review, ReviewFinding, ScientistOutput
from app.domain.references import PaperCard

from .model import QWEN_THINKING_ENABLED, QwenSettings, qwen_model, qwen_model_settings

SCIENTIST_MAX_TURNS = 22
REVIEWER_MAX_TURNS = 19
_USAGE_TOKEN_FIELDS = ("requests", "input_tokens", "output_tokens", "total_tokens")
_USAGE_DETAIL_FIELDS = ("input_tokens_details", "output_tokens_details")


class ContractViolationError(RuntimeError):
    """模型输出没过 Pydantic 契约。是质量性失败，不是环境性失败。

    被丢弃的那次回答已经付过钱了，所以它带着自己的 usage 一起抛。
    """

    def __init__(self, message: str, usage: Mapping[str, Any] | None = None) -> None:
        super().__init__(message)
        self.usage = usage


class ToolOwnership(Protocol):
    """Concrete local tools will be migrated separately; ownership is fixed now."""

    @property
    def memory_search(self) -> Any: ...

    @property
    def arxiv_search(self) -> Any: ...

    @property
    def arxiv_save(self) -> Any: ...

    @property
    def paper_index_read(self) -> Any: ...

    def scientist_scope(self) -> AbstractAsyncContextManager[None]: ...

    def reviewer_scope(self) -> AbstractAsyncContextManager[None]: ...

    def saved_paper_cards(self) -> Mapping[str, PaperCard]: ...

    def append_tool_event(self, *, tool: str, **fields: Any) -> None: ...


@dataclass(frozen=True)
class RevisionRequest:
    proposal: Proposal
    required_changes: tuple[str, ...]
    findings: tuple[ReviewFinding, ...] = ()
    """`requiredChanges` 只说要做什么；`findings` 带上「查了什么、为什么不通过」。"""


@dataclass(frozen=True)
class SpecialistResult:
    output: ScientistOutput | Review
    usage: Mapping[str, Any] | None
    thinking: bool = QWEN_THINKING_ENABLED


class SpecialistRunner(Protocol):
    async def run_scientist(
        self, question: str, revision: RevisionRequest | None = None, prior_attempts: Sequence[str] = ()
    ) -> SpecialistResult: ...

    async def run_reviewer(
        self, question: str, evidence: Sequence[Evidence], proposal: Proposal
    ) -> SpecialistResult: ...


class AgentsSdkSpecialistRunner:
    """Real SDK adapter; tests inject a fake `SpecialistRunner` instead.

    Bailian may wrap valid JSON in a short preface or Markdown fence even when
    instructed otherwise. The Harness extracts one JSON object and validates
    it with the same Pydantic contracts that own persisted artifacts.
    """

    def __init__(self, settings: QwenSettings, tools: ToolOwnership, prompt_dir: Path | None = None) -> None:
        self._tools = tools
        self._prompt_dir = prompt_dir or Path(__file__).with_name("prompts")
        model = qwen_model(settings)
        self._scientist = Agent(
            name="scientist",
            instructions=self._read_prompt("scientist.md"),
            model=model,
            model_settings=qwen_model_settings(thinking=QWEN_THINKING_ENABLED),
            tools=[tools.memory_search, tools.arxiv_search, tools.arxiv_save, tools.paper_index_read],
        )
        self._reviewer = Agent(
            name="reviewer",
            instructions=self._read_prompt("reviewer.md"),
            model=model,
            model_settings=qwen_model_settings(thinking=QWEN_THINKING_ENABLED),
            tools=[tools.arxiv_search, tools.paper_index_read],
        )

    async def run_scientist(
        self, question: str, revision: RevisionRequest | None = None, prior_attempts: Sequence[str] = ()
    ) -> SpecialistResult:
        message: dict[str, Any] = {"question": question}
        if prior_attempts:
            message["priorAttempts"] = list(prior_attempts)
        if revision is not None:
            message["previousProposal"] = revision.proposal.model_dump(by_alias=True)
            message["requiredChanges"] = list(revision.required_changes)
            message["findings"] = [finding.model_dump(by_alias=True) for finding in revision.findings]
        async with self._tools.scientist_scope():
            result = await Runner.run(
                self._scientist,
                json.dumps(message, ensure_ascii=False),
                max_turns=SCIENTIST_MAX_TURNS,
            )
        usage = _usage_of(result)
        parsed = self._parse(result.final_output, ScientistOutput, usage)
        assert isinstance(parsed, ScientistOutput)
        return SpecialistResult(
            output=backfill_reference_metadata(parsed, self._tools.saved_paper_cards(), self._record_mismatch),
            usage=usage,
            thinking=QWEN_THINKING_ENABLED,
        )

    def _record_mismatch(self, row: dict[str, Any]) -> None:
        self._tools.append_tool_event(tool="reference_backfill", **row)

    async def run_reviewer(self, question: str, evidence: Sequence[Evidence], proposal: Proposal) -> SpecialistResult:
        message = {
            "question": question,
            "evidence": [item.model_dump(by_alias=True) for item in evidence],
            "proposal": proposal.model_dump(by_alias=True),
        }
        async with self._tools.reviewer_scope():
            result = await Runner.run(
                self._reviewer,
                json.dumps(message, ensure_ascii=False),
                max_turns=REVIEWER_MAX_TURNS,
            )
        usage = _usage_of(result)
        return SpecialistResult(
            output=self._parse(result.final_output, Review, usage),
            usage=usage,
            thinking=QWEN_THINKING_ENABLED,
        )

    def _read_prompt(self, name: str) -> str:
        return (self._prompt_dir / name).read_text(encoding="utf-8")

    @staticmethod
    def _parse(
        value: Any, model_type: type[ScientistOutput] | type[Review], usage: Mapping[str, Any] | None = None
    ) -> ScientistOutput | Review:
        if isinstance(value, model_type):
            return value
        if not isinstance(value, str):
            value = json.dumps(value, ensure_ascii=False)
        stripped = value.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        if not stripped.startswith("{") or not stripped.endswith("}"):
            start = stripped.find("{")
            end = stripped.rfind("}")
            if start >= 0 and end > start:
                stripped = stripped[start : end + 1]
        try:
            return model_type.model_validate_json(stripped)
        except ValidationError as exc:
            raise ContractViolationError(f"模型返回未通过契约校验：{exc}", usage) from exc


def usage_of_failure(exc: Exception) -> Mapping[str, Any] | None:
    """What a raised specialist call had already burned.

    The SDK hangs the partial run on the exception (`run_data`); a rejected-but-paid-for
    answer carries its own. Either way the Harness, not the model, keeps the books.
    """
    return _usage_of(getattr(exc, "run_data", None)) or getattr(exc, "usage", None)


def _usage_of(result: Any) -> Mapping[str, Any] | None:
    """Token accounting lives on `RunResult.context_wrapper.usage`, not on the result.

    `agents.usage.Usage` is a dataclass whose `*_details` members are themselves
    dataclasses, so neither `__dict__` nor `json.dumps` survives it. Every field is
    projected into plain JSON here because usage.jsonl is delivery evidence.
    """
    usage = getattr(getattr(result, "context_wrapper", None), "usage", None)
    if usage is None:
        return None
    if all(hasattr(usage, field) for field in _USAGE_TOKEN_FIELDS):
        row: dict[str, Any] = {field: getattr(usage, field) for field in _USAGE_TOKEN_FIELDS}
        for field in _USAGE_DETAIL_FIELDS:
            details = getattr(usage, field, None)
            if details is not None:
                row[field] = _usage_details_of(details)
        return row
    if hasattr(usage, "model_dump"):
        return cast(Mapping[str, Any], usage.model_dump(mode="json"))
    return {"value": str(usage)}


def _usage_details_of(details: Any) -> Mapping[str, Any]:
    fields = getattr(details, "__dict__", None)
    if not isinstance(fields, dict):
        return {"value": str(details)}
    return {key: value for key, value in fields.items() if isinstance(value, (bool, int, float, str))}


def backfill_reference_metadata(
    output: ScientistOutput,
    cards: Mapping[str, PaperCard],
    on_mismatch: Callable[[dict[str, Any]], None] | None = None,
) -> ScientistOutput:
    """Only arxiv_save-owned cards may author reference metadata.

    Preserve unknown ids unchanged: B1 owns that failure and must be able to see
    it. For a saved id, the model may choose relevance but cannot reconstruct a
    title, author list, or year from memory and accidentally pass a fake B2/B4.

    An override rescues the run, which is exactly why it must not be silent: every
    field this replaces is reported to `on_mismatch` as evidence the model drifted.
    """
    references: list[Reference] = []
    for reference in output.proposal.references:
        card = cards.get(reference.arxiv_id)
        if card is None:
            references.append(reference)
            continue
        authored = {"title": card.title, "authors": card.authors, "year": card.year or reference.year}
        if on_mismatch is not None:
            before = {"title": reference.title, "authors": list(reference.authors), "year": reference.year}
            changed = [field for field, value in authored.items() if before[field] != value]
            if changed:
                on_mismatch(
                    {
                        "arxivId": reference.arxiv_id,
                        "fields": changed,
                        "before": {field: before[field] for field in changed},
                        "after": {field: authored[field] for field in changed},
                    }
                )
        references.append(Reference.model_validate({**reference.model_dump(by_alias=True), **authored}))
    return output.model_copy(update={"proposal": output.proposal.model_copy(update={"references": references})})
