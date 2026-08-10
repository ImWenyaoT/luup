"""Offline criteria-H evaluation from immutable ``runs/<id>`` artifacts."""

from __future__ import annotations

import argparse
import json
import math
import re
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from functools import cmp_to_key
from pathlib import Path
from typing import Any

from app.services.runs import RunService

VETO_ADVISORY = "M9 报了虚构类断言 veto（诊断，不影响择优）"
_CALIBRATION = re.compile(r"检出\s+(\d+)\s*/\s*(\d+)\s*=\s*([\d.]+)%[^\n]*逆序\s+(\d+)")
_RUBRIC = re.compile(r"rubric v([^｜\s]+)")
_JUDGE = re.compile(r"judge\s+([^（｜\s]+)")


@dataclass(frozen=True)
class VersionCandidate:
    run_id: str
    question_id: int
    deliverable: bool
    veto: bool = False
    score: float | None = None
    rubric_version: str | None = None
    judge_model: str | None = None
    refs: int | None = None
    tokens: int | None = None


def m9_ranking_eligible(candidates: Sequence[VersionCandidate], reports: Sequence[str]) -> bool:
    scored = [candidate for candidate in candidates if candidate.score is not None]
    versions = {candidate.rubric_version for candidate in scored if candidate.rubric_version}
    judges = {candidate.judge_model for candidate in scored if candidate.judge_model}
    if len(versions) != 1 or len(judges) != 1:
        return False
    version = next(iter(versions))
    judge = next(iter(judges))
    for report in reports:
        rubric_match = _RUBRIC.search(report)
        judge_match = _JUDGE.search(report)
        summary = _CALIBRATION.search(report)
        if not rubric_match or not judge_match or not summary:
            continue
        detected, judgeable, reported_rate, inverted = summary.groups()
        count = int(judgeable)
        if (
            rubric_match.group(1) == version
            and judge_match.group(1) == judge
            and count >= 4
            and int(detected) / count >= 0.75
            and float(reported_rate) / 100 >= 0.75
            and int(inverted) == 0
        ):
            return True
    return False


def select_version(candidates: Sequence[VersionCandidate], reports: Sequence[str] = ()) -> dict[str, Any]:
    eligible = m9_ranking_eligible(candidates, reports)
    eliminated = [
        {"runId": candidate.run_id, "reason": "未通过交付 gate（runOutcome 判定不可交付）"}
        for candidate in candidates
        if not candidate.deliverable
    ]
    survivors = [candidate for candidate in candidates if candidate.deliverable]
    def compare(left: VersionCandidate, right: VersionCandidate) -> int:
        return _compare(left, right, eligible)

    ranked = sorted(survivors, key=cmp_to_key(compare))
    advisories = [
        {"runId": candidate.run_id, "note": VETO_ADVISORY} for candidate in survivors if candidate.veto
    ]
    if not candidates:
        reason = "没有候选版本"
    elif not ranked:
        reason = "没有版本通过交付 gate"
    elif len(ranked) == 1:
        reason = "唯一通过 gate 的版本"
    else:
        reason = _reason(ranked[0], ranked[1], eligible)
    return {
        "m9Eligible": eligible,
        "winner": _candidate_dict(ranked[0]) if ranked else None,
        "ranked": [_candidate_dict(candidate) for candidate in ranked],
        "reason": reason,
        "eliminated": eliminated,
        "advisories": advisories,
    }


def paired_comparison(candidates: Sequence[VersionCandidate]) -> dict[str, Any]:
    groups: dict[int, list[VersionCandidate]] = defaultdict(list)
    for candidate in candidates:
        groups[candidate.question_id].append(candidate)
    questions: list[dict[str, Any]] = []
    for question_id, group in sorted(groups.items()):
        ordered = sorted(group, key=lambda candidate: candidate.run_id)
        if len(ordered) < 2:
            continue
        earlier, later = ordered[0], ordered[-1]
        questions.append(
            {
                "questionId": question_id,
                "earlier": earlier.run_id,
                "later": later.run_id,
                "earlierPass": earlier.deliverable,
                "laterPass": later.deliverable,
            }
        )
    b = sum(not row["earlierPass"] and row["laterPass"] for row in questions)
    c = sum(row["earlierPass"] and not row["laterPass"] for row in questions)
    discordant = b + c
    if discordant:
        tail = sum(math.comb(discordant, index) for index in range(min(b, c) + 1))
        p = min(1.0, 2 * tail * 0.5**discordant)
    else:
        p = 1.0
    return {
        "questions": questions,
        "b": b,
        "c": c,
        "discordant": discordant,
        "p": p,
        "significant": p < 0.05,
        "concordantPass": sum(row["earlierPass"] and row["laterPass"] for row in questions),
        "concordantFail": sum(not row["earlierPass"] and not row["laterPass"] for row in questions),
    }


def evaluate_runs(runs_root: Path) -> dict[str, Any]:
    service = RunService(runs_root)
    candidates = [candidate for run_id in service.list_ids() if (candidate := _load_candidate(service, run_id))]
    reports = [text for run_id in service.list_ids() if (text := service.artifact(run_id, "calibration.md"))]
    groups: dict[int, list[VersionCandidate]] = defaultdict(list)
    for candidate in candidates:
        groups[candidate.question_id].append(candidate)
    selections = {
        str(question_id): select_version(group, reports)
        for question_id, group in sorted(groups.items())
        if len(group) > 1
    }
    return {"source": str(runs_root.resolve()), "versions": selections, "pairedComparison": paired_comparison(candidates)}


def _load_candidate(service: RunService, run_id: str) -> VersionCandidate | None:
    detail = service.detail(run_id)
    question_id = detail.get("science125Id") if detail else None
    if detail is None or not isinstance(question_id, int) or isinstance(question_id, bool):
        return None
    proposal = detail.get("proposal")
    refs = proposal.get("references") if isinstance(proposal, dict) else None
    score = _json_mapping(service.artifact(run_id, "score.json"))
    usage = _usage_total(service.artifact(run_id, "usage.jsonl"))
    veto = score.get("veto") if score else None
    return VersionCandidate(
        run_id=run_id,
        question_id=question_id,
        deliverable=detail.get("status") == "passed",
        veto=bool(veto.get("triggered")) if isinstance(veto, dict) else False,
        score=_number(score.get("weighted")) if score else None,
        rubric_version=_string(score.get("rubricVersion")) if score else None,
        judge_model=_string(score.get("judgeModel")) if score else None,
        refs=len(refs) if isinstance(refs, list) else None,
        tokens=usage,
    )


def _compare(left: VersionCandidate, right: VersionCandidate, eligible: bool) -> int:
    comparisons = []
    if eligible:
        comparisons.append(_nullable(left.score, right.score, descending=True))
    comparisons.extend(
        [_nullable(left.refs, right.refs, descending=True), _nullable(left.tokens, right.tokens, descending=False)]
    )
    return next((result for result in comparisons if result), (left.run_id > right.run_id) - (left.run_id < right.run_id))


def _candidate_dict(candidate: VersionCandidate) -> dict[str, Any]:
    return {
        "runId": candidate.run_id,
        "questionId": candidate.question_id,
        "deliverable": candidate.deliverable,
        "veto": candidate.veto,
        "score": candidate.score,
        "rubricVersion": candidate.rubric_version,
        "judgeModel": candidate.judge_model,
        "refs": candidate.refs,
        "tokens": candidate.tokens,
    }


def _reason(winner: VersionCandidate, runner_up: VersionCandidate, eligible: bool) -> str:
    if eligible and _nullable(winner.score, runner_up.score, descending=True):
        return "M9 总分更高"
    if _nullable(winner.refs, runner_up.refs, descending=True):
        return "M9 总分持平，refs 更多" if eligible else "M9 未达校准阈值，refs 更多"
    if _nullable(winner.tokens, runner_up.tokens, descending=False):
        return "M9 总分与 refs 持平，token 成本更低" if eligible else "M9 未达校准阈值，refs 持平，token 成本更低"
    return "各级全部持平，按 run id 取最早的一版"


def _nullable(left: float | int | None, right: float | int | None, *, descending: bool) -> int:
    if left == right:
        return 0
    if left is None:
        return 1
    if right is None:
        return -1
    return ((right > left) - (right < left)) if descending else ((left > right) - (left < right))


def _json_mapping(text: str | None) -> Mapping[str, Any] | None:
    if text is None:
        return None
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def _usage_total(text: str | None) -> int | None:
    if text is None:
        return None
    total = 0
    seen = False
    for line in text.splitlines():
        row = _json_mapping(line)
        usage = row.get("usage") if row else None
        if not isinstance(usage, dict):
            continue
        value = usage.get("total_tokens", usage.get("totalTokens"))
        if isinstance(value, int) and not isinstance(value, bool):
            total += value
            seen = True
    return total if seen else None


def _number(value: object) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def _string(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Offline criteria-H version selection and paired comparison.")
    parser.add_argument("--runs-root", type=Path, default=Path.cwd().parent / "runs")
    parser.add_argument("--output", type=Path, help="Optional JSON output; stdout is always emitted.")
    args = parser.parse_args(argv)
    report = evaluate_runs(args.runs_root)
    rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
