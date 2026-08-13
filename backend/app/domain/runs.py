"""run id 与文件路径的单一边界。"""

from __future__ import annotations

import os
import re
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any, Literal

RUN_ID_RE = re.compile(r"^([0-9]{4})([0-9]{2})([0-9]{2})-([0-9]{2})([0-9]{2})([0-9]{2})$")

FailureClass = Literal[
    "reviewer_no_new_evidence",
    "verifier_refs",
    "revision_no_change",
    "contract_violation",
    "agent_budget_exhausted",
    "infra_timeout",
    "infra_error",
]
"""M4 需要区分环境性失败与质量性失败，所以终态工件必须自报分类，而不是让读者猜文案。

`agent_budget_exhausted`（SDK 的 max turns 用尽）是**质量性**的：实测 run 20260810-164417
一次检索都不发、连打 8 次 arxiv_save 把 22 轮耗光——这是 agent 行为失败，不是环境故障。
把它留在 `infra_error` 兜底里会虚高环境性一档，正好抹掉 M4 刚分出来的那条线。
"""


class BoundaryError(ValueError):
    def __init__(self, attempted: str) -> None:
        super().__init__(f"path escapes sandbox: {attempted}")
        self.attempted = attempted


def is_run_id(value: Any) -> bool:
    return isinstance(value, str) and RUN_ID_RE.fullmatch(value) is not None


def utc_stamp(point: datetime | None = None) -> str:
    value = point or datetime.now(UTC)
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    value = value.astimezone(UTC)
    return value.strftime("%Y%m%d-%H%M%S")


def stamp_to_ms(value: Any) -> int | None:
    """按 JavaScript `Date.UTC` 的月/日溢出规则解析 run id。"""
    if not isinstance(value, str):
        return None
    match = RUN_ID_RE.fullmatch(value)
    if not match:
        return None
    year, month, day, hour, minute, second = (int(part) for part in match.groups())
    # Date.UTC 的 0..99 年会映射到 1900..1999。
    if 0 <= year <= 99:
        year += 1900
    year += (month - 1) // 12
    month = (month - 1) % 12 + 1
    try:
        instant = datetime(year, month, 1, tzinfo=UTC) + timedelta(
            days=day - 1, hours=hour, minutes=minute, seconds=second
        )
    except (OverflowError, ValueError):
        return None
    return int(instant.timestamp() * 1000)


def repo_root() -> Path:
    # 这里必须直读 os.getenv，不能走 QwenSettings 那套 pydantic-settings：仓根是**找到 `.env`
    # 的前提**，而 `.env` 又要靠仓根才能定位。让它走 Settings 就成了环。
    override = os.getenv("LUUP_REPO_ROOT")
    return Path(override).resolve() if override else Path(__file__).resolve().parents[3]


def runs_dir(root: Path | None = None) -> Path:
    return (root or repo_root()) / "runs"


def safe_join(base: Path, *parts: str) -> Path:
    resolved_base = base.resolve()
    target = resolved_base.joinpath(*parts).resolve()
    if target != resolved_base and resolved_base not in target.parents:
        raise BoundaryError("/".join(parts))
    return target


def replace_text(path: Path, content: str) -> None:
    """run 目录里每一次覆写的唯一原子写点：写临时文件再 `os.replace`。

    `runs/<id>/` 在运行中被 HTTP 读模型并发读取；就地 `write_text` 会先把目标文件截断，
    于是并发读者可能读到半个 JSON。原子替换让读者要么看到旧的完整字节，要么看到新的。
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        handle.write(content)
        temp_name = handle.name
    os.replace(temp_name, path)


def render_failed(failures: Sequence[str], classification: str | None) -> str:
    """FAILED.md 的唯一渲染点：Harness 与 HTTP 启动器都从这里出同一种形状。"""
    detail = "\n".join(f"- {item}" for item in failures) or "- 未知失败"
    label = f"分类：{classification}\n\n" if classification else ""
    return f"# Luup run failed\n\n{label}{detail}\n"


def run_dir(identifier: str, base_runs_dir: Path | None = None) -> Path:
    if not is_run_id(identifier):
        raise BoundaryError(identifier)
    return safe_join(base_runs_dir or runs_dir(), identifier)
