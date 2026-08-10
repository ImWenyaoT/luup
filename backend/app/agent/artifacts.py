"""File-backed run artifacts owned by the Harness, never by a model."""

from __future__ import annotations

import json
import os
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any

from app.domain.contracts import Proposal, Review, ScientistOutput


class RunArtifacts:
    """The minimal source of truth for one run.

    Writes are atomically replaced so a query process never observes a partial JSON
    artifact. The only non-replace file is usage.jsonl, matching the existing
    append-only accounting semantics.
    """

    def __init__(self, run_dir: Path) -> None:
        self.run_dir = run_dir.resolve()

    def write_scientist_output(self, output: ScientistOutput, question: str) -> None:
        self._replace_text("evidence.md", self._render_evidence(output))
        self._replace_text("proposal.json", output.proposal.model_dump_json(by_alias=True, indent=2) + "\n")
        self._replace_text("proposal.md", self._render_proposal(output.proposal, question))

    def write_review(self, review: Review) -> None:
        self._replace_text("review.json", review.model_dump_json(by_alias=True, indent=2) + "\n")

    def write_verification(self, verification: Mapping[str, Any]) -> None:
        self._replace_text("verification.json", json.dumps(verification, ensure_ascii=False, indent=2) + "\n")
        self._replace_text("verification-report.md", self._render_verification(verification))

    def append_usage(self, *, agent: str, thinking: bool, usage: Mapping[str, Any] | None) -> None:
        if usage is None:
            return
        self.run_dir.mkdir(parents=True, exist_ok=True)
        row = {
            "at": datetime.now(UTC).isoformat(),
            "agent": agent,
            "thinking": thinking,
            "usage": dict(usage),
        }
        with (self.run_dir / "usage.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    def append_trace(self, *, agent: str, phase: str, payload: Mapping[str, Any]) -> None:
        self.run_dir.mkdir(parents=True, exist_ok=True)
        row = {
            "at": datetime.now(UTC).isoformat(),
            "agent": agent,
            "phase": phase,
            "payload": dict(payload),
        }
        with (self.run_dir / "trace.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    def write_failed(self, failures: Sequence[str]) -> None:
        detail = "\n".join(f"- {item}" for item in failures) or "- 未知失败"
        self._replace_text("FAILED.md", f"# Luup run failed\n\n{detail}\n")

    def _replace_text(self, relative: str, content: str) -> None:
        target = self.run_dir / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        with NamedTemporaryFile("w", encoding="utf-8", dir=target.parent, delete=False) as handle:
            handle.write(content)
            temp_name = handle.name
        os.replace(temp_name, target)

    @staticmethod
    def _render_evidence(output: ScientistOutput) -> str:
        lines = ["# Evidence", ""]
        for evidence in output.evidence:
            lines.extend(
                [
                    f"## {evidence.arxiv_id}",
                    "",
                    f"- Claim: {evidence.claim}",
                    f"- Relevance: {evidence.relevance}",
                    "",
                ]
            )
        return "\n".join(lines)

    @staticmethod
    def _render_proposal(proposal: Proposal, question: str) -> str:
        references = [
            f"| {ref.arxiv_id} | {ref.year} | {_cell(ref.title)} | {_cell(ref.relevance)} |"
            for ref in proposal.references
        ]
        return "\n".join(
            [
                f"# {proposal.paper_title}",
                "",
                "## 1. 研究问题",
                "",
                question.strip(),
                "",
                "## 2. 问题陈述",
                "",
                proposal.problem_statement,
                "",
                "## 3. 研究依据",
                "",
                proposal.rationale,
                "",
                "## 4. 技术细节",
                "",
                proposal.technical_details,
                "",
                "## 5. 数据集",
                "",
                f"- 来源：{proposal.datasets.source}",
                f"- 目标：{proposal.datasets.target}",
                "",
                "## 6. 论文摘要",
                "",
                proposal.paper_abstract,
                "",
                "## 7. 方法",
                "",
                proposal.methods,
                "",
                "## 8. 实验",
                "",
                f"- 基线：{'; '.join(proposal.experiments.baselines)}",
                f"- 指标：{'; '.join(proposal.experiments.metrics)}",
                f"- 设计：{proposal.experiments.design}",
                "",
                "## 9. 预期结果与证伪条件",
                "",
                proposal.results,
                "",
                "## 10. 参考文献",
                "",
                "| arXiv id | 年份 | 标题 | 与方案的关系 |",
                "| --- | --- | --- | --- |",
                *references,
                "",
            ]
        )

    @staticmethod
    def _render_verification(verification: Mapping[str, Any]) -> str:
        raw_checks = verification.get("checks")
        checks: list[tuple[str, bool, str]] = []
        if isinstance(raw_checks, list):
            for raw in raw_checks:
                if not isinstance(raw, Mapping):
                    continue
                identifier = raw.get("id")
                passed = raw.get("pass")
                detail = raw.get("detail")
                if isinstance(identifier, str) and isinstance(passed, bool):
                    checks.append((identifier, passed, detail if isinstance(detail, str) else ""))
        failed = verification.get("failed")
        failed_ids = [item for item in failed if isinstance(item, str)] if isinstance(failed, list) else []
        known = {identifier for identifier, _, _ in checks}
        checks.extend((identifier, False, "确定性检查失败") for identifier in failed_ids if identifier not in known)
        ok = verification.get("ok") is True
        if not checks and not ok:
            checks.append(("verifier", False, "确定性 verifier 未提供检查明细"))
        failed_count = sum(not passed for _, passed, _ in checks)
        result = "ALL PASS" if ok else f"{max(failed_count, 1)}/{max(len(checks), 1)} FAILED"
        rows = [
            f"| {_cell(identifier)} | {'✅ PASS' if passed else '❌ FAIL'} | {_cell(detail)} |"
            for identifier, passed, detail in checks
        ]
        return "\n".join(
            [
                "# 验收报告（确定性检查）",
                "",
                f"结果: {result}",
                "",
                "| 检查项 | 结果 | 说明 |",
                "| --- | --- | --- |",
                *rows,
                "",
            ]
        )


def _cell(value: str) -> str:
    return value.replace("|", "\\|").replace("\n", " ")
