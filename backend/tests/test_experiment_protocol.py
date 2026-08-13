"""The pre-registered protocol is only worth having if a change to it is loud.

``docs/design/experiment-protocol.json`` fixes the Phase B subset *before* Phase A runs. The
whole value of that promise is that nobody can quietly re-pick the 30 questions once the results
are in, so these tests recompute the declared sampling rule from the question bank and compare —
editing a question id without re-deriving it turns the suite red.
"""

from __future__ import annotations

import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any

import pytest

from app.domain.science125 import read_science125

PROTOCOL_PATH = Path(__file__).resolve().parents[2] / "docs" / "design" / "experiment-protocol.json"


@pytest.fixture(scope="module")
def protocol() -> dict[str, Any]:
    return json.loads(PROTOCOL_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def strata() -> dict[str, list[int]]:
    """The bank grouped exactly as the protocol's stratification key says: by ``domain``."""
    bank = read_science125()
    assert bank is not None
    grouped: dict[str, list[int]] = defaultdict(list)
    for domain in bank.domains:
        for question in domain.questions:
            grouped[domain.domain].append(question.id)
    return dict(grouped)


def test_the_protocol_is_parseable_json_registered_before_the_campaign(protocol: dict[str, Any]) -> None:
    assert protocol["status"] == "pre_registered_protocol"
    assert protocol["phase_b_subset"]["fixed_before_phase_a"] is True
    assert protocol["arms"]["phase_a"]["memory_arm"] == "on"
    assert protocol["arms"]["phase_b"]["memory_arm"] == "off"


def test_the_subset_is_thirty_distinct_question_ids_inside_the_bank(
    protocol: dict[str, Any], strata: dict[str, list[int]]
) -> None:
    ids = protocol["phase_b_subset"]["question_ids"]

    assert len(ids) == 30
    assert len(set(ids)) == 30
    assert ids == sorted(ids)
    assert all(isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= 125 for value in ids)
    assert set(ids) <= {value for group in strata.values() for value in group}


def test_the_subset_matches_the_sampling_rule_the_protocol_declares(
    protocol: dict[str, Any], strata: dict[str, list[int]]
) -> None:
    """Recomputed from the declared seed and rule — the ids cannot be hand-edited into agreement."""
    subset = protocol["phase_b_subset"]
    total, size = sum(len(ids) for ids in strata.values()), subset["size"]

    exact = {domain: len(ids) * size / total for domain, ids in strata.items()}
    allocation = {domain: max(1, math.floor(value)) for domain, value in exact.items()}
    eligible = sorted(
        (domain for domain, value in exact.items() if math.floor(value) >= 1),
        key=lambda domain: (-(exact[domain] - math.floor(exact[domain])), domain),
    )
    for domain in eligible[: size - sum(allocation.values())]:
        allocation[domain] += 1

    seed = subset["seed"]
    recomputed: dict[str, list[int]] = {}
    for domain, ids in strata.items():
        ranked = sorted(ids, key=lambda value: hashlib.sha256(f"{seed}:{value}".encode()).hexdigest())
        recomputed[domain] = sorted(ranked[: allocation[domain]])

    declared = {domain: row["ids"] for domain, row in subset["allocation"].items()}
    assert declared == recomputed
    assert {domain: row["stratum_size"] for domain, row in subset["allocation"].items()} == {
        domain: len(ids) for domain, ids in strata.items()
    }
    assert subset["question_ids"] == sorted(value for ids in recomputed.values() for value in ids)


def test_every_stratum_is_represented_in_proportion(
    protocol: dict[str, Any], strata: dict[str, list[int]]
) -> None:
    """A stratified subset that skips a domain would answer for 11 domains and claim 12."""
    allocation = protocol["phase_b_subset"]["allocation"]

    assert set(allocation) == set(strata)
    assert all(row["allocated"] >= 1 for row in allocation.values())
    assert sum(row["allocated"] for row in allocation.values()) == 30


def test_the_commitment_digest_pins_the_subset(protocol: dict[str, Any]) -> None:
    """The digest is over the ids, not over the file: a file self-hash is a fixed point."""
    commitment = protocol["phase_b_subset"]["commitment"]
    payload = json.dumps(protocol["phase_b_subset"]["question_ids"], separators=(",", ":"))

    assert commitment["algorithm"] == "sha256"
    assert hashlib.sha256(payload.encode("utf-8")).hexdigest() == commitment["digest"]
    assert len(commitment["git_commit"]) == 40


def test_the_protocol_refuses_significance_claims_up_front(protocol: dict[str, Any]) -> None:
    """n=30 paired cannot reach p<0.05 with ≤5 discordant pairs, so the refusal is a design fact."""
    statistics = protocol["statistics"]

    assert statistics["design"] == "bounded_comparison"
    assert "显著性主张" in statistics["claims_forbidden"]
    assert "0.0625" in statistics["reason"]


def test_the_reading_declarations_are_registered_before_any_result_exists(protocol: dict[str, Any]) -> None:
    """三条口径声明与子集同批冻结；事后补写的声明不成其为预注册，所以少一条就红。

    钉的是它们**在**且各自说到了那句要害话，不是逐字比对——措辞可以改，口径不能消失。
    """
    declarations = protocol["declarations"]

    assert {"pass_squared", "verifier", "failure_classes"} <= set(declarations)
    assert "机会样本" in declarations["pass_squared"]
    assert "k=2" in declarations["pass_squared"]
    assert "TITLE_OVERLAP_THRESHOLD=0.8" in declarations["verifier"]
    assert "未经校准的自由参数" in declarations["verifier"]
    assert "B2" in declarations["verifier"]
    assert "infra_timeout" in declarations["failure_classes"]
    assert "domain/runs.py" in declarations["failure_classes"]


def test_the_metrics_keep_mechanism_and_outcome_apart(protocol: dict[str, Any]) -> None:
    mechanism, outcome = protocol["metrics"]["mechanism"], protocol["metrics"]["outcome"]

    assert {"memorySearchCalls", "memorySearchHits", "ablation_effectiveness_assertion"} <= set(mechanism)
    assert {"deliveryRate", "regressionRate", "mcnemar", "passSquared"} <= set(outcome)
    assert not (set(mechanism) & set(outcome)) - {"note"}  # No metric may be filed under both.
