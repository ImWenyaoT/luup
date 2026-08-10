"""Campaign-memory write-back and dispatch injection: deterministic, append-only, zero LLM.

The write side of `memory/` was lost with the TypeScript stack, so every run since then
read a memory nothing was still filling. Both directions live here and neither passes
through a model: the run's own artifacts are the only input.
"""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from tempfile import NamedTemporaryFile

PRIOR_ATTEMPT_LIMIT = 3
ENTRY_PREFIX = "- ["
"""每条确定性记录一行，前缀固定 ⇒ 读取端是 grep，不是解析器。"""


def record_run(
    memory_dir: Path | None,
    *,
    run_dir: Path,
    question_id: int | None,
    status: str,
    classification: str | None,
) -> None:
    """Append this run's verdict to `log.md`, and to `questions/q<id>.md` when it has an id."""
    if memory_dir is None or not memory_dir.exists():
        return
    verdict = "SUCCESS" if status == "passed" else "FAILED"
    title, references = _proposal_facts(run_dir)
    summary = title or (f"分类：{classification}" if classification else "未产出 proposal")
    refs = f"｜引用 {', '.join(references)}" if references else ""
    now = datetime.now(UTC)
    stamp = now.isoformat(timespec="seconds").replace("+00:00", "Z")
    label = f"q{question_id}" if question_id is not None else "q-"
    _append(
        memory_dir / "log.md",
        f"\n## [{now.date().isoformat()}] run | {label} | {verdict}\n- {run_dir}｜{summary}{refs}\n",
    )
    if question_id is None:
        return
    page = memory_dir / "questions" / f"q{question_id}.md"
    _append(
        page,
        f"{ENTRY_PREFIX}{stamp}] {verdict} | run {run_dir.name} | {summary}{refs}\n",
        seed=_page_seed(question_id),
    )


def read_prior_attempts(
    memory_dir: Path | None, question_id: int | None, limit: int = PRIOR_ATTEMPT_LIMIT
) -> tuple[str, ...]:
    """The last few deterministic entries for this question, for the opening dispatch."""
    if memory_dir is None or question_id is None:
        return ()
    page = memory_dir / "questions" / f"q{question_id}.md"
    if not page.is_file():
        return ()
    entries = [line.strip() for line in page.read_text(encoding="utf-8").splitlines() if line.startswith(ENTRY_PREFIX)]
    return tuple(entries[-limit:])


def _proposal_facts(run_dir: Path) -> tuple[str | None, list[str]]:
    try:
        raw = json.loads((run_dir / "proposal.json").read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None, []
    if not isinstance(raw, dict):
        return None, []
    title = raw.get("paperTitle")
    references = raw.get("references")
    ids = (
        [item["arxivId"] for item in references if isinstance(item, dict) and isinstance(item.get("arxivId"), str)]
        if isinstance(references, list)
        else []
    )
    return (title if isinstance(title, str) and title else None), ids


def _page_seed(question_id: int) -> str:
    return (
        f"# q{question_id}\n\n"
        f"Science-125 第 {question_id} 题的跨 run 战役页。**append-only**：由 Harness 在 run 收尾时"
        "确定性追加一行，旧记录不改写、不删除。\n"
    )


def _append(path: Path, block: str, seed: str = "") -> None:
    """Read-modify-atomic-replace: a concurrent reader never observes a half-written page."""
    existing = path.read_text(encoding="utf-8") if path.is_file() else seed
    if existing and not existing.endswith("\n"):
        existing += "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        handle.write(existing + block)
        temporary = handle.name
    os.replace(temporary, path)
