"""Deterministic B1-B4 reference verifier backed by run-local paper cards."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.domain.contracts import Proposal
from app.domain.references import ReferenceCheck, verify_offline_references, verify_resolved_titles

from .tools.arxiv import ArxivClient
from .tools.papers import RunPaperStore


class FileReferenceVerifier:
    def __init__(self, arxiv: ArxivClient) -> None:
        self._arxiv = arxiv

    async def verify(self, proposal: Proposal, run_dir: Path) -> dict[str, Any]:
        store = RunPaperStore(run_dir)
        local = verify_offline_references(proposal.references, store.cards(), store.ids())
        checks: list[ReferenceCheck] = list(local.checks)
        infra_error = False
        try:
            resolved = await self._arxiv.get_many([reference.arxiv_id for reference in proposal.references])
            titles = {paper.arxiv_id: paper.title for paper in resolved}
            checks.extend(verify_resolved_titles(proposal.references, titles))
        except Exception as exc:
            # An unreachable arXiv is an outage, not a fabricated reference. M4 has to
            # be able to drop these runs from the quality denominator.
            infra_error = True
            checks.append(ReferenceCheck(id="B2.resolve", passed=False, detail=f"arXiv 独立反查失败：{exc}"))
        failed = [check.id for check in checks if not check.passed]
        return {
            "ok": not failed,
            "referenceCount": len(proposal.references),
            "papersInRun": len(store.ids()),
            "checks": [check.model_dump(by_alias=True) for check in checks],
            "failed": failed,
            "infraError": infra_error,
        }
