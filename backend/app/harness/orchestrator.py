"""Deterministic Scientist -> Reviewer -> one repair -> verifier Harness."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Protocol

from app.domain.contracts import Proposal, Review, ScientistOutput

from .artifacts import RunArtifacts
from .specialists import RevisionRequest, SpecialistResult, SpecialistRunner


class DeterministicVerifier(Protocol):
    async def verify(self, proposal: Proposal, run_dir: Path) -> Mapping[str, Any]: ...


@dataclass(frozen=True)
class RunOutcome:
    status: Literal["passed", "failed"]
    run_dir: Path
    failures: tuple[str, ...] = ()


class Harness:
    """Ordinary Python flow control, not an LLM master.

    The review is a single independent information-gathering pass. `revise`
    grants exactly one directed Scientist repair; no path sends a failed or
    truncated specialist response back to the model unchanged.
    """

    def __init__(self, specialists: SpecialistRunner, verifier: DeterministicVerifier) -> None:
        self._specialists = specialists
        self._verifier = verifier

    async def run(self, question: str, run_dir: Path) -> RunOutcome:
        artifacts = RunArtifacts(run_dir)
        try:
            artifacts.append_trace(agent="scientist", phase="input", payload={"question": question})
            scientist = await self._specialists.run_scientist(question)
            output = _as_scientist(scientist)
            artifacts.append_trace(
                agent="scientist", phase="output", payload=output.model_dump(by_alias=True)
            )
            artifacts.append_usage(agent="scientist", thinking=True, usage=scientist.usage)
            artifacts.write_scientist_output(output, question)

            artifacts.append_trace(
                agent="reviewer",
                phase="input",
                payload={
                    "question": question,
                    "evidence": [item.model_dump(by_alias=True) for item in output.evidence],
                    "proposal": output.proposal.model_dump(by_alias=True),
                },
            )
            reviewer = await self._specialists.run_reviewer(question, output.evidence, output.proposal)
            review = _as_review(reviewer)
            artifacts.append_trace(agent="reviewer", phase="output", payload=review.model_dump(by_alias=True))
            artifacts.append_usage(agent="reviewer", thinking=True, usage=reviewer.usage)
            artifacts.write_review(review)

            if review.verdict == "revise":
                artifacts.append_trace(
                    agent="scientist",
                    phase="revision_input",
                    payload={
                        "question": question,
                        "previousProposal": output.proposal.model_dump(by_alias=True),
                        "requiredChanges": list(review.required_changes),
                    },
                )
                repaired = await self._specialists.run_scientist(
                    question,
                    RevisionRequest(proposal=output.proposal, required_changes=tuple(review.required_changes)),
                )
                output = _as_scientist(repaired)
                artifacts.append_trace(
                    agent="scientist", phase="revision_output", payload=output.model_dump(by_alias=True)
                )
                artifacts.append_usage(agent="scientist", thinking=True, usage=repaired.usage)
                artifacts.write_scientist_output(output, question)

            verification = dict(await self._verifier.verify(output.proposal, artifacts.run_dir))
            artifacts.write_verification(verification)
            if verification.get("ok") is not True:
                return self._failed(artifacts, _verification_failures(verification))
            return RunOutcome(status="passed", run_dir=artifacts.run_dir)
        except Exception as exc:
            return self._failed(artifacts, (f"{type(exc).__name__}: {exc}",))

    @staticmethod
    def _failed(artifacts: RunArtifacts, failures: tuple[str, ...]) -> RunOutcome:
        artifacts.write_failed(failures)
        return RunOutcome(status="failed", run_dir=artifacts.run_dir, failures=failures)


def _as_scientist(result: SpecialistResult) -> ScientistOutput:
    if not isinstance(result.output, ScientistOutput):
        raise RuntimeError("Scientist 返回了非 ScientistOutput 的结果")
    return result.output


def _as_review(result: SpecialistResult) -> Review:
    if not isinstance(result.output, Review):
        raise RuntimeError("Reviewer 返回了非 Review 的结果")
    return result.output


def _verification_failures(verification: Mapping[str, Any]) -> tuple[str, ...]:
    failed = verification.get("failed")
    if isinstance(failed, list) and all(isinstance(item, str) for item in failed):
        return tuple(failed) or ("确定性 verifier 返回 ok=false，但未列失败项",)
    return ("确定性 verifier 返回 ok=false",)
