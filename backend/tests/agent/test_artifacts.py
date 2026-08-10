"""usage.jsonl is delivery evidence: it must survive real SDK objects and stay parseable."""

from __future__ import annotations

import json
from pathlib import Path

from agents.usage import Usage

from app.agent.artifacts import RunArtifacts
from app.agent.specialists import _usage_of


def test_append_usage_writes_the_projected_sdk_usage_without_a_typeerror(tmp_path: Path) -> None:
    """`Usage` nests `InputTokensDetails`/`OutputTokensDetails`; `json.dumps` on them raises."""
    result = type("R", (), {})()
    result.context_wrapper = type("C", (), {})()
    result.context_wrapper.usage = Usage(requests=2, input_tokens=11, output_tokens=13, total_tokens=24)

    RunArtifacts(tmp_path / "run").append_usage(agent="scientist", thinking=False, usage=_usage_of(result))

    rows = [json.loads(line) for line in (tmp_path / "run" / "usage.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 1
    assert rows[0]["agent"] == "scientist"
    assert rows[0]["thinking"] is False
    assert rows[0]["usage"]["total_tokens"] == 24
    assert rows[0]["usage"]["input_tokens_details"] == {"cache_write_tokens": 0, "cached_tokens": 0}


def test_append_usage_degrades_an_unserializable_value_instead_of_killing_the_run(tmp_path: Path) -> None:
    """Accounting is never worth aborting a finished run for."""
    RunArtifacts(tmp_path / "run").append_usage(agent="reviewer", thinking=True, usage={"detail": object()})

    row = json.loads((tmp_path / "run" / "usage.jsonl").read_text(encoding="utf-8"))
    assert row["thinking"] is True
    assert isinstance(row["usage"]["detail"], str)


def test_append_usage_writes_nothing_when_the_sdk_reported_no_usage(tmp_path: Path) -> None:
    RunArtifacts(tmp_path / "run").append_usage(agent="scientist", thinking=False, usage=None)

    assert not (tmp_path / "run" / "usage.jsonl").exists()
