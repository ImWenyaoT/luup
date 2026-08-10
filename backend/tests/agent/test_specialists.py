from __future__ import annotations

from app.agent.specialists import AgentsSdkSpecialistRunner
from app.domain.contracts import Review, ReviewFinding, ScientistOutput


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
