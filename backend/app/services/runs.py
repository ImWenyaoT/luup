"""从既有 `runs/<id>/` 工件派生只读 API 视图。

这里不拥有运行状态：没有数据库、缓存或后台任务；一次请求只读取一次目录快照。
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import TypedDict

from app.domain.runs import is_run_id, run_dir, runs_dir, stamp_to_ms

_NESTED_DIRECTORIES = {"memory", "memory/papers"}
# 每个节点一行：key、mark、label、主工件名、可接受的别名。
_NODES = (
    ("scientist", "S", "Scientist", "proposal.json", ("evidence.md",)),
    ("reviewer", "R", "Reviewer", "review.json", ()),
    ("verify", "✓", "Verify", "verification-report.md", ("verification.json",)),
)
_SOURCE_LINE = re.compile(r"第\s*([0-9]+)\s*题[，,]\s*([^。\n]+)。")
_ASKED_LINE = re.compile(r"问题[:：]\s*(.+)")
_RESULT_LINE = re.compile(r"结果:\s*(.+)")
_ALL_PASS = re.compile(r"结果:\s*ALL PASS")


@dataclass(frozen=True)
class Scan:
    identifier: str
    directory: Path
    files: dict[str, int]


class Outcome(TypedDict):
    phase: str
    started: int | None
    finished: int | None


def _finite_number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return float(value)


def _parse_timestamp(value: object) -> int | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return int(parsed.timestamp() * 1000)


def _iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _read_json(scan: Scan, relative: str) -> object | None:
    text = _read_text(scan, relative)
    if text is None:
        return None
    try:
        value: object = json.loads(text)
        return value
    except json.JSONDecodeError:
        return None


def _read_text(scan: Scan, relative: str) -> str | None:
    if relative not in scan.files:
        return None
    try:
        return (scan.directory / relative).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None


def _split_table_row(line: str) -> list[str] | None:
    if not line.lstrip().startswith("|"):
        return None
    cells: list[str] = []
    current: list[str] = []
    escaped = False
    for char in line.strip()[1:]:
        if escaped:
            current.append(char)
            escaped = False
        elif char == "\\":
            escaped = True
        elif char == "|":
            cells.append("".join(current).strip())
            current = []
        else:
            current.append(char)
    if current or not line.rstrip().endswith("|"):
        cells.append("".join(current).strip())
    return cells


def _table_rows(text: str, columns: int) -> list[list[str]]:
    rows: list[list[str]] = []
    for line in text.splitlines():
        cells = _split_table_row(line)
        if cells is None or len(cells) != columns:
            continue
        if all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells):
            continue
        rows.append(cells)
    return rows


class RunService:
    def __init__(self, root: Path | None = None) -> None:
        self._root = root or runs_dir()

    @property
    def runs_root(self) -> Path:
        return self._root

    @property
    def active_run_id(self) -> str | None:
        # Import locally to keep the read model independent from the launcher at
        # module import time while sharing the same PID-aware lock semantics.
        from app.services.launch import FileRunLock

        return FileRunLock(self._root).active_run_id()

    def list_ids(self) -> list[str]:
        try:
            entries = [
                entry.name
                for entry in self._root.iterdir()
                if entry.is_dir() and not entry.is_symlink() and is_run_id(entry.name)
            ]
        except OSError:
            return []
        return sorted(entries, reverse=True)

    def scan(self, identifier: str) -> Scan | None:
        directory = run_dir(identifier, self._root)
        if not directory.is_dir() or directory.is_symlink():
            return None
        files: dict[str, int] = {}

        def walk(relative: str) -> None:
            current = directory / relative if relative else directory
            try:
                entries = list(current.iterdir())
            except OSError:
                return
            for entry in entries:
                child = f"{relative}/{entry.name}" if relative else entry.name
                try:
                    if entry.is_dir() and not entry.is_symlink():
                        if child in _NESTED_DIRECTORIES:
                            walk(child)
                    elif entry.is_file() and not entry.is_symlink():
                        files[child] = int(entry.stat().st_mtime * 1000)
                except OSError:
                    continue

        walk("")
        return Scan(identifier=identifier, directory=directory, files=files)

    def list_runs(self, limit: int) -> list[dict[str, object]]:
        summaries: list[dict[str, object]] = []
        for identifier in self.list_ids():
            if len(summaries) >= limit:
                break
            scan = self.scan(identifier)
            if scan is not None:
                summaries.append(self._summary(scan))
        return summaries

    def status(self, identifier: str) -> dict[str, object] | None:
        scan = self.scan(identifier)
        return self._status_view(scan) if scan is not None else None

    def detail(self, identifier: str) -> dict[str, object] | None:
        scan = self.scan(identifier)
        if scan is None:
            return None
        status = self._status_view(scan)
        question = self._question(_read_text(scan, "question.md"))
        outcome = self._outcome(scan)
        proposal = _read_json(scan, "proposal.json")
        current_proposal = proposal if isinstance(proposal, dict) else None
        return {
            **status,
            "questionText": question["full"],
            "domain": question["domain"],
            "science125Id": self._question_id(scan, question),
            "startedAt": _iso(outcome["started"] or 0),
            "finishedAt": _iso(outcome["finished"]) if outcome["finished"] is not None else None,
            "durationSec": self._duration(outcome),
            "proposal": current_proposal,
            "verify": self._verify_report(_read_text(scan, "verification-report.md")),
            "papers": self._papers(_read_text(scan, "memory/index.md")),
            "failedText": _read_text(scan, "FAILED.md"),
            "artifactNames": sorted(scan.files),
        }

    def artifact(self, identifier: str, name: str) -> str | None:
        scan = self.scan(identifier)
        if scan is None:
            return None
        return _read_text(scan, name)

    def _summary(self, scan: Scan) -> dict[str, object]:
        outcome = self._outcome(scan)
        status = self._status(scan, outcome)
        question = self._question(_read_text(scan, "question.md"))
        proposal = _read_json(scan, "proposal.json")
        references = proposal.get("references") if isinstance(proposal, dict) else None
        verify = self._verify_report(_read_text(scan, "verification-report.md"))
        exit_fact = _read_json(scan, "exit.json")
        exit_data = exit_fact if isinstance(exit_fact, dict) else {}
        return {
            "id": scan.identifier,
            "startedAt": _iso(outcome["started"] or 0),
            "finishedAt": _iso(outcome["finished"]) if outcome["finished"] is not None else None,
            "status": status,
            "question": question["short"],
            "domain": question["domain"],
            "science125Id": self._question_id(scan, question),
            "refs": len(references) if isinstance(references, list) else None,
            "verify": "pass" if verify and verify["pass"] else "fail" if verify else None,
            "durationSec": self._duration(outcome),
            "classification": self._classification(exit_data),
            "sourceIdentity": self._source_identity(exit_data),
            "nodes": self._summary_nodes(scan, status),
        }

    @staticmethod
    def _classification(exit_data: dict[str, object]) -> str | None:
        """终态自报的失败分类；旧 run 的 `exit.json` 没有这个键，缺席就是 `None`。"""
        value = exit_data.get("classification")
        return value if isinstance(value, str) and value else None

    @staticmethod
    def _source_identity(exit_data: dict[str, object]) -> dict[str, object] | None:
        """`app.cli` 写的 cohort 身份。git 不可用时它写的就是 `null`，不能编一个假 commit 出来。"""
        source = exit_data.get("sourceIdentity")
        if not isinstance(source, dict):
            return None
        commit = source.get("gitCommit")
        if not isinstance(commit, str) or not commit:
            return None
        dirty = source.get("treeDirty")
        return {"gitCommit": commit, "treeDirty": dirty if isinstance(dirty, bool) else None}

    def _status_view(self, scan: Scan) -> dict[str, object]:
        outcome = self._outcome(scan)
        status = self._status(scan, outcome)
        states = self._node_states(scan, status)
        previous = outcome["started"]
        nodes: list[dict[str, object]] = []
        for (key, mark, label, artifact, aliases), state in zip(_NODES, states):
            found = next((name for name in (artifact, *aliases) if name in scan.files), None)
            at = scan.files.get(found) if found else None
            nodes.append(
                {
                    "key": key,
                    "mark": mark,
                    "label": label,
                    "artifact": found or artifact,
                    "state": state,
                    "at": _iso(at) if at is not None else None,
                    "elapsedSec": self._round_seconds(at - previous)
                    if at is not None and previous is not None
                    else None,
                }
            )
            if at is not None:
                previous = at
        return {
            "id": scan.identifier,
            "status": status,
            "updatedAt": _iso(int(datetime.now(UTC).timestamp() * 1000)),
            "nodes": nodes,
        }

    def _outcome(self, scan: Scan) -> Outcome:
        meta = _read_json(scan, "meta.json")
        exit_fact = _read_json(scan, "exit.json")
        meta_data = meta if isinstance(meta, dict) else None
        exit_data = exit_fact if isinstance(exit_fact, dict) else None
        meta_exit = _finite_number(meta_data.get("exitCode")) if meta_data else None
        exit_code = _finite_number(exit_data.get("exitCode")) if exit_data else None
        failed_exit = (meta_exit is not None and meta_exit != 0) or (exit_code is not None and exit_code != 0)
        report = _read_text(scan, "verification-report.md")
        if "FAILED.md" in scan.files or failed_exit:
            phase = "failed"
        elif "proposal.md" in scan.files:
            phase = "verified" if self._verified(scan, report) else "rendered"
        else:
            phase = "unsettled"
        started = (
            (_parse_timestamp(meta_data.get("startedAt")) if meta_data else None)
            or stamp_to_ms(scan.identifier)
            or scan.files.get("question.md")
        )
        meta_finished = _parse_timestamp(meta_data.get("finishedAt")) if meta_data else None
        exit_finished = _parse_timestamp(exit_data.get("endedAt")) if exit_data else None
        meta_settled = meta_data is not None and (meta_finished is not None or meta_exit is not None)
        exit_settled = exit_data is not None and (exit_finished is not None or exit_code is not None)
        terminal = (
            "FAILED.md" in scan.files
            or report is not None
            or "proposal.md" in scan.files
            or meta_settled
            or exit_settled
        )
        top_level_times = [time for name, time in scan.files.items() if "/" not in name]
        newest = max(top_level_times) if top_level_times else None
        return {
            "phase": phase,
            "started": started,
            "finished": (meta_finished or exit_finished or newest) if terminal else None,
        }

    @staticmethod
    def _verified(scan: Scan, report: str | None) -> bool:
        """验收结论取自结构化事实 `verification.json.ok`，正则只兜没有它的旧 run。

        `ok` 与报告里那行 `结果: ALL PASS` 是同一个判定的两种写法，但只有前者是 verifier
        原样落盘的字段，后者是渲染出来的文案。把 markdown 当结构化状态载体，等价于让报告
        模板的任何一次改动去改运行的成败——评分器 bug 把正确答案判为失败正是这么发生的。
        所以只要 `verification.json` 里有布尔 `ok`，它就是权威，哪怕报告文本与它矛盾。
        兜底只服务 2026-08-10 之前那批没写 `verification.json` 的已提交 run。
        """
        verification = _read_json(scan, "verification.json")
        if isinstance(verification, dict) and isinstance(verification.get("ok"), bool):
            return verification["ok"] is True
        return report is not None and _ALL_PASS.search(report) is not None

    def _status(self, scan: Scan, outcome: Outcome) -> str:
        if self.active_run_id == scan.identifier:
            return "working"
        return "passed" if outcome["phase"] == "verified" else "failed"

    @staticmethod
    def _node_states(scan: Scan, status: str) -> list[str]:
        active_taken = status != "working"
        states: list[str] = []
        for _key, _, _, artifact, aliases in _NODES:
            if any(name in scan.files for name in (artifact, *aliases)):
                states.append("done")
            elif not active_taken:
                states.append("active")
                active_taken = True
            else:
                states.append("pending")
        return states

    def _summary_nodes(self, scan: Scan, status: str) -> object:
        return [
            {
                "key": key,
                "mark": mark,
                "label": label,
                "artifact": artifact,
                "state": state,
                "at": None,
                "elapsedSec": None,
            }
            for (key, mark, label, artifact, _aliases), state in zip(_NODES, self._node_states(scan, status))
        ]

    @staticmethod
    def _question(text: str | None) -> dict[str, object]:
        full = (text or "").strip()
        source = _SOURCE_LINE.search(full)
        asked = _ASKED_LINE.search(full)
        first_body = next(
            (line.strip() for line in full.splitlines() if line.strip() and not line.strip().startswith(("#", "来源"))),
            None,
        )
        return {
            "full": full,
            "short": ((asked.group(1).strip() if asked else first_body) or "(无问题原文)")[:160],
            "domain": source.group(2).strip() if source else None,
            "science125Id": int(source.group(1)) if source else None,
        }

    @staticmethod
    def _question_id(scan: Scan, question: dict[str, object]) -> int | None:
        meta = _read_json(scan, "meta.json")
        if isinstance(meta, dict):
            identifier = _finite_number(meta.get("questionId"))
            if identifier is not None:
                return int(identifier)
        return question["science125Id"] if isinstance(question["science125Id"], int) else None

    @staticmethod
    def _duration(outcome: Outcome) -> int | None:
        started, finished = outcome["started"], outcome["finished"]
        if not isinstance(started, int) or not isinstance(finished, int):
            return None
        return RunService._round_seconds(finished - started)

    @staticmethod
    def _round_seconds(milliseconds: int) -> int:
        return math.floor(milliseconds / 1000 + 0.5)

    @staticmethod
    def _verify_report(text: str | None) -> dict[str, object] | None:
        if not text:
            return None
        result = _RESULT_LINE.search(text)
        checks: list[dict[str, object]] = []
        for cells in _table_rows(text, 3):
            if cells[0] == "检查项" or not ("✅" in cells[1] or "❌" in cells[1]):
                continue
            checks.append(
                {"id": cells[0], "group": cells[0].split(".", 1)[0], "pass": "✅" in cells[1], "detail": cells[2]}
            )
        return {
            "result": result.group(1).strip() if result else "UNKNOWN",
            "pass": bool(_ALL_PASS.search(text)),
            "checks": checks,
        }

    @staticmethod
    def _papers(text: str | None) -> list[dict[str, str]]:
        """Committed runs carry a 4-column index; runs after the 第一作者 column carry 5."""
        if not text:
            return []
        papers: list[dict[str, str]] = []
        for width in (5, 4):
            for cells in _table_rows(text, width):
                if cells[0] == "arXiv id":
                    continue
                title, oneline = (cells[3], cells[4]) if width == 5 else (cells[2], cells[3])
                papers.append(
                    {
                        "arxivId": cells[0],
                        "year": cells[1],
                        "title": title,
                        "oneline": oneline,
                        "file": f"memory/papers/{cells[0].replace('/', '__')}.md",
                    }
                )
            if papers:
                break
        return papers
