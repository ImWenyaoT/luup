"""The two LLM specialists and their narrow tool ownership boundaries."""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, cast

from agents import Agent, Runner
from pydantic import ValidationError

from app.domain.contracts import Evidence, Proposal, Reference, Review, ScientistOutput
from app.domain.references import PaperCard

from .model import QwenSettings, qwen_model, qwen_model_settings

SCIENTIST_MAX_TURNS = 22
REVIEWER_MAX_TURNS = 19


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


@dataclass(frozen=True)
class RevisionRequest:
    proposal: Proposal
    required_changes: tuple[str, ...]


@dataclass(frozen=True)
class SpecialistResult:
    output: ScientistOutput | Review
    usage: Mapping[str, Any] | None


class SpecialistRunner(Protocol):
    async def run_scientist(self, question: str, revision: RevisionRequest | None = None) -> SpecialistResult: ...

    async def run_reviewer(
        self, question: str, evidence: Sequence[Evidence], proposal: Proposal
    ) -> SpecialistResult: ...


class AgentsSdkSpecialistRunner:
    """Real SDK adapter; tests inject a fake `SpecialistRunner` instead.

    It deliberately does not set Agent.output_type because Bailian's Responses
    endpoint does not reliably honor response_format. The Harness parses and
    validates normal text with the same Pydantic contracts that own artifacts.
    """

    def __init__(self, settings: QwenSettings, tools: ToolOwnership, prompt_dir: Path | None = None) -> None:
        self._tools = tools
        self._prompt_dir = prompt_dir or Path(__file__).with_name("prompts")
        model = qwen_model(settings)
        self._scientist = Agent(
            name="scientist",
            instructions=self._read_prompt("scientist.md"),
            model=model,
            model_settings=qwen_model_settings(thinking=True),
            tools=[tools.memory_search, tools.arxiv_search, tools.arxiv_save, tools.paper_index_read],
        )
        self._reviewer = Agent(
            name="reviewer",
            instructions=self._read_prompt("reviewer.md"),
            model=model,
            model_settings=qwen_model_settings(thinking=True),
            tools=[tools.arxiv_search, tools.paper_index_read],
        )

    async def run_scientist(self, question: str, revision: RevisionRequest | None = None) -> SpecialistResult:
        message: dict[str, Any] = {"question": question}
        if revision is not None:
            message["previousProposal"] = revision.proposal.model_dump(by_alias=True)
            message["requiredChanges"] = list(revision.required_changes)
        async with self._tools.scientist_scope():
            result = await Runner.run(
                self._scientist,
                json.dumps(message, ensure_ascii=False),
                max_turns=SCIENTIST_MAX_TURNS,
            )
        parsed = self._parse(result.final_output, ScientistOutput)
        assert isinstance(parsed, ScientistOutput)
        return SpecialistResult(
            output=backfill_reference_metadata(parsed, self._tools.saved_paper_cards()),
            usage=_usage_of(result),
        )

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
        return SpecialistResult(output=self._parse(result.final_output, Review), usage=_usage_of(result))

    def _read_prompt(self, name: str) -> str:
        return (self._prompt_dir / name).read_text(encoding="utf-8")

    @staticmethod
    def _parse(value: Any, model_type: type[ScientistOutput] | type[Review]) -> ScientistOutput | Review:
        if not isinstance(value, str):
            value = json.dumps(value, ensure_ascii=False)
        stripped = value.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        try:
            return model_type.model_validate_json(stripped)
        except ValidationError as exc:
            raise RuntimeError(f"模型返回未通过契约校验：{exc}") from exc


def _usage_of(result: Any) -> Mapping[str, Any] | None:
    """SDK Usage and raw Responses usage are both serializable enough for evidence."""
    usage = getattr(result, "usage", None)
    if usage is None:
        return None
    if hasattr(usage, "model_dump"):
        return cast(Mapping[str, Any], usage.model_dump(mode="json"))
    if hasattr(usage, "__dict__"):
        return dict(usage.__dict__)
    return {"value": str(usage)}


def backfill_reference_metadata(output: ScientistOutput, cards: Mapping[str, PaperCard]) -> ScientistOutput:
    """Only arxiv_save-owned cards may author reference metadata.

    Preserve unknown ids unchanged: B1 owns that failure and must be able to see
    it. For a saved id, the model may choose relevance but cannot reconstruct a
    title, author list, or year from memory and accidentally pass a fake B2/B4.
    """
    references: list[Reference] = []
    for reference in output.proposal.references:
        card = cards.get(reference.arxiv_id)
        if card is None:
            references.append(reference)
            continue
        references.append(
            Reference.model_validate(
                {
                    **reference.model_dump(by_alias=True),
                    "title": card.title,
                    "authors": card.authors,
                    "year": card.year or reference.year,
                }
            )
        )
    return output.model_copy(update={"proposal": output.proposal.model_copy(update={"references": references})})
