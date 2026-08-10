"""Offline criteria-H evaluation from immutable ``runs/<id>`` artifacts.

Everything here is a pure function over artifacts already on disk: no model call, no new
collection, no writes into ``runs/``. M9 (LLM-judge score) and M10 (judge calibration)
were retired on 2026-08-11 — their producers went with the TypeScript stack and the one
calibration report on record detected 0/4 planted flaws — so no branch reads
``score.json`` or ``calibration.md`` and the selection chain is deterministic end to end.
"""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from functools import cmp_to_key
from pathlib import Path
from typing import Any

from app.services.runs import RunService

INFRASTRUCTURE_CLASSES = frozenset({"infra_error", "infra_timeout"})
"""Failure classes that say nothing about the proposal's quality — an outage, not a verdict.

M4 must not be read as a quality number while outages are folded into it, so every
aggregate below reports the two groups separately rather than netting them out.
"""


@dataclass(frozen=True)
class RunFacts:
    """The one row type: everything the evaluation derives from a single run.

    ``question_id`` is ``None`` for free-form (OOD) runs. They count towards the
    campaign-wide rates but cannot enter version selection or paired comparison,
    which both compare answers to the *same* question.
    """

    run_id: str
    question_id: int | None = None
    deliverable: bool = True
    refs: int | None = None
    tokens: int | None = None
    classification: str | None = None
    memory_arm: str | None = None
    reviewed: bool = False
    revised: bool = False
    searches: int = 0
    deduplicated_searches: int = 0
    new_information_searches: int = 0


def select_version(candidates: Sequence[RunFacts]) -> dict[str, Any]:
    """Deterministic version selection: gate -> refs -> token cost -> run id."""
    eliminated = [
        {"runId": candidate.run_id, "reason": "未通过交付 gate（runOutcome 判定不可交付）"}
        for candidate in candidates
        if not candidate.deliverable
    ]
    survivors = [candidate for candidate in candidates if candidate.deliverable]
    ranked = sorted(survivors, key=cmp_to_key(_compare))
    if not candidates:
        reason = "没有候选版本"
    elif not ranked:
        reason = "没有版本通过交付 gate"
    elif len(ranked) == 1:
        reason = "唯一通过 gate 的版本"
    else:
        reason = _reason(ranked[0], ranked[1])
    return {
        "winner": _candidate_dict(ranked[0]) if ranked else None,
        "ranked": [_candidate_dict(candidate) for candidate in ranked],
        "reason": reason,
        "eliminated": eliminated,
    }


def paired_comparison(candidates: Sequence[RunFacts]) -> dict[str, Any]:
    """M11: exact-binomial McNemar over whatever pairing the artifacts actually support.

    ``firstVsLatest`` is named for what it measures — the first and the newest run of a
    question, which differ by every change in between, not by one controlled variable.
    ``memoryArms`` is the controlled pairing: same question, ``meta.memoryArm`` on vs off.
    """
    return {"firstVsLatest": _first_vs_latest(candidates), "memoryArms": _memory_arms(candidates)}


def delivery_rate(facts: Sequence[RunFacts]) -> dict[str, Any]:
    """M4: deliverable share with the binomial standard error √(p(1-p)/n).

    Quality-only rate excludes runs that failed on an outage, because an arXiv timeout
    is not evidence about the pipeline's science.
    """
    quality = [item for item in facts if item.deliverable or item.classification not in INFRASTRUCTURE_CLASSES]
    delivered = sum(item.deliverable for item in facts)
    delivered_quality = sum(item.deliverable for item in quality)
    return {
        "runs": len(facts),
        "deliverable": delivered,
        **_proportion(delivered, len(facts)),
        "excludingInfrastructure": {
            "runs": len(quality),
            "deliverable": delivered_quality,
            **_proportion(delivered_quality, len(quality)),
        },
    }


def pass_squared(facts: Sequence[RunFacts]) -> dict[str, Any]:
    """M5: share of adjacent same-question run pairs where *both* runs delivered.

    A single-run pass rate flatters an unreliable pipeline; two in a row is the
    reliability claim the report can defend.
    """
    pairs = [
        (earlier, later)
        for _, group in _by_question(facts)
        for earlier, later in zip(group, group[1:])
    ]
    both = sum(earlier.deliverable and later.deliverable for earlier, later in pairs)
    return {"pairs": len(pairs), "both": both, **_proportion(both, len(pairs))}


def revision_rate(facts: Sequence[RunFacts]) -> dict[str, Any]:
    """M7: how often the Reviewer sends the proposal back, over the runs that got reviewed."""
    reviewed = sum(item.reviewed for item in facts)
    revised = sum(item.revised for item in facts)
    return {"reviewed": reviewed, "revised": revised, **_proportion(revised, reviewed)}


def search_health(facts: Sequence[RunFacts]) -> dict[str, Any]:
    """M8: literature yield per search, straight from tool-events.jsonl.

    ``newInformationRate`` is the share of searches that returned at least one paper the
    run had not already seen — the deterministic version of "the Reviewer brought new
    information". ``deduplicatedRate`` is the share served from the same-run cache.
    """
    searches = sum(item.searches for item in facts)
    deduplicated = sum(item.deduplicated_searches for item in facts)
    fresh = sum(item.new_information_searches for item in facts)
    refs = [item.refs for item in facts if item.refs is not None]
    return {
        "runsWithSearchEvents": sum(1 for item in facts if item.searches),
        "searches": searches,
        "deduplicated": deduplicated,
        "deduplicatedRate": _ratio(deduplicated, searches),
        "newInformation": fresh,
        "newInformationRate": _ratio(fresh, searches),
        "refsMean": (sum(refs) / len(refs)) if refs else None,
    }


def failure_classes(facts: Sequence[RunFacts]) -> dict[str, Any]:
    """Failed runs grouped by the classification the Harness wrote, outages kept apart."""
    failed = [item for item in facts if not item.deliverable]
    infrastructure = [item for item in failed if item.classification in INFRASTRUCTURE_CLASSES]
    quality = [
        item for item in failed if item.classification and item.classification not in INFRASTRUCTURE_CLASSES
    ]
    return {
        "failed": len(failed),
        "infrastructure": {"count": len(infrastructure), "byClass": _counts(infrastructure)},
        "quality": {"count": len(quality), "byClass": _counts(quality)},
        "unclassified": sum(1 for item in failed if item.classification is None),
    }


def evaluate_runs(runs_root: Path) -> dict[str, Any]:
    service = RunService(runs_root)
    facts = [candidate for run_id in service.list_ids() if (candidate := _load_facts(service, run_id))]
    identified = [item for item in facts if item.question_id is not None]
    return {
        "source": str(runs_root.resolve()),
        "runs": len(facts),
        "versions": {
            str(question_id): select_version(group)
            for question_id, group in _by_question(identified)
            if len(group) > 1
        },
        "pairedComparison": paired_comparison(identified),
        "statistics": {
            "delivery": delivery_rate(facts),
            "passSquared": pass_squared(identified),
            "revision": revision_rate(facts),
            "searchHealth": search_health(facts),
            "failureClasses": failure_classes(facts),
        },
    }


def _load_facts(service: RunService, run_id: str) -> RunFacts | None:
    detail = service.detail(run_id)
    if detail is None:
        return None
    proposal = detail.get("proposal")
    refs = proposal.get("references") if isinstance(proposal, dict) else None
    question_id = detail.get("science125Id")
    review = _json_mapping(service.artifact(run_id, "review.json")) or {}
    exit_fact = _json_mapping(service.artifact(run_id, "exit.json")) or {}
    meta = _json_mapping(service.artifact(run_id, "meta.json")) or {}
    searches, deduplicated, fresh = _search_events(service.artifact(run_id, "tool-events.jsonl"))
    return RunFacts(
        run_id=run_id,
        question_id=question_id if isinstance(question_id, int) and not isinstance(question_id, bool) else None,
        deliverable=detail.get("status") == "passed",
        refs=len(refs) if isinstance(refs, list) else None,
        tokens=_usage_total(service.artifact(run_id, "usage.jsonl")),
        classification=_string(exit_fact.get("classification")),
        memory_arm=_string(meta.get("memoryArm")),
        reviewed="verdict" in review,
        revised=review.get("verdict") == "revise",
        searches=searches,
        deduplicated_searches=deduplicated,
        new_information_searches=fresh,
    )


def _compare(left: RunFacts, right: RunFacts) -> int:
    comparisons = [
        _nullable(left.refs, right.refs, descending=True),
        _nullable(left.tokens, right.tokens, descending=False),
    ]
    return next((result for result in comparisons if result), (left.run_id > right.run_id) - (left.run_id < right.run_id))


def _candidate_dict(candidate: RunFacts) -> dict[str, Any]:
    return {
        "runId": candidate.run_id,
        "questionId": candidate.question_id,
        "deliverable": candidate.deliverable,
        "refs": candidate.refs,
        "tokens": candidate.tokens,
    }


def _reason(winner: RunFacts, runner_up: RunFacts) -> str:
    if _nullable(winner.refs, runner_up.refs, descending=True):
        return "refs 更多"
    if _nullable(winner.tokens, runner_up.tokens, descending=False):
        return "refs 持平，token 成本更低"
    return "各级全部持平，按 run id 取最早的一版"


def _by_question(facts: Sequence[RunFacts]) -> list[tuple[int, list[RunFacts]]]:
    """Same-question runs in time order; run ids are UTC stamps, so sorting them is sorting time."""
    groups: dict[int, list[RunFacts]] = defaultdict(list)
    for item in facts:
        if item.question_id is not None:
            groups[item.question_id].append(item)
    return [
        (question_id, sorted(group, key=lambda item: item.run_id)) for question_id, group in sorted(groups.items())
    ]


def _first_vs_latest(facts: Sequence[RunFacts]) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    outcomes: list[tuple[bool, bool]] = []
    for question_id, group in _by_question(facts):
        if len(group) < 2:
            continue
        earlier, later = group[0], group[-1]
        rows.append(
            {
                "questionId": question_id,
                "earlier": earlier.run_id,
                "later": later.run_id,
                "earlierPass": earlier.deliverable,
                "laterPass": later.deliverable,
            }
        )
        outcomes.append((earlier.deliverable, later.deliverable))
    return _mcnemar(rows, outcomes)


def _memory_arms(facts: Sequence[RunFacts]) -> dict[str, Any] | None:
    """One pair per question that ran both arms: the newest off-run against the newest on-run."""
    rows: list[dict[str, Any]] = []
    outcomes: list[tuple[bool, bool]] = []
    for question_id, group in _by_question(facts):
        off = [item for item in group if item.memory_arm == "off"]
        on = [item for item in group if item.memory_arm == "on"]
        if not off or not on:
            continue
        rows.append(
            {
                "questionId": question_id,
                "off": off[-1].run_id,
                "on": on[-1].run_id,
                "offPass": off[-1].deliverable,
                "onPass": on[-1].deliverable,
            }
        )
        outcomes.append((off[-1].deliverable, on[-1].deliverable))
    return _mcnemar(rows, outcomes) if rows else None


def _mcnemar(rows: list[dict[str, Any]], outcomes: Sequence[tuple[bool, bool]]) -> dict[str, Any]:
    """Exact two-sided binomial on the discordant pairs — the χ² approximation is invalid at n≈10."""
    b = sum(not baseline and treatment for baseline, treatment in outcomes)
    c = sum(baseline and not treatment for baseline, treatment in outcomes)
    discordant = b + c
    if discordant:
        tail = sum(math.comb(discordant, index) for index in range(min(b, c) + 1))
        p = min(1.0, 2 * tail * 0.5**discordant)
    else:
        p = 1.0
    return {
        "questions": rows,
        "b": b,
        "c": c,
        "discordant": discordant,
        "p": p,
        "significant": p < 0.05,
        "concordantPass": sum(baseline and treatment for baseline, treatment in outcomes),
        "concordantFail": sum(not baseline and not treatment for baseline, treatment in outcomes),
    }


def _proportion(successes: int, total: int) -> dict[str, float | None]:
    """A rate without its standard error invites reading noise as a trend."""
    if total <= 0:
        return {"rate": None, "se": None}
    rate = successes / total
    return {"rate": rate, "se": math.sqrt(rate * (1 - rate) / total)}


def _ratio(part: int, total: int) -> float | None:
    return part / total if total else None


def _counts(facts: Iterable[RunFacts]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in facts:
        if item.classification:
            counts[item.classification] = counts.get(item.classification, 0) + 1
    return dict(sorted(counts.items()))


def _search_events(text: str | None) -> tuple[int, int, int]:
    """(searches, deduplicated, brought-new-information) over the arxiv_search tool events."""
    searches = deduplicated = fresh = 0
    for line in (text or "").splitlines():
        row = _json_mapping(line)
        if not row or row.get("tool") != "arxiv_search":
            continue
        searches += 1
        deduplicated += row.get("deduplicated") is True
        new_count = row.get("newCount")
        fresh += isinstance(new_count, int) and not isinstance(new_count, bool) and new_count > 0
    return searches, deduplicated, fresh


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


def _string(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Offline criteria-H version selection and campaign statistics.")
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
