from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.domain.runs import (
    BoundaryError,
    is_run_id,
    run_dir,
    safe_join,
    stamp_to_ms,
    utc_stamp,
)


def test_run_id_generation_validation_and_parsing_are_compatible() -> None:
    point = datetime(2026, 8, 8, 6, 28, 29, tzinfo=UTC)
    run_id = utc_stamp(point)

    assert run_id == "20260808-062829"
    assert is_run_id(run_id)
    assert stamp_to_ms(run_id) == int(point.timestamp() * 1000)


@pytest.mark.parametrize("value", ["20260808_062829", "２０２６０８０８-０６２８２９", "index.json", 42, None])
def test_invalid_run_ids_are_rejected(value: object) -> None:
    assert not is_run_id(value)
    assert stamp_to_ms(value) is None


def test_safe_join_and_run_dir_block_path_escape(tmp_path: Path) -> None:
    base = tmp_path / "runs"
    base.mkdir()

    assert safe_join(base, "20260808-062829", "proposal.json") == base / "20260808-062829" / "proposal.json"
    assert run_dir("20260808-062829", base) == base / "20260808-062829"
    with pytest.raises(BoundaryError, match="path escapes sandbox: ../outside"):
        safe_join(base, "../outside")
    with pytest.raises(BoundaryError, match="path escapes sandbox: index.json"):
        run_dir("index.json", base)
