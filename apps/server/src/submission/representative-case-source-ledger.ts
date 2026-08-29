import { isRecord, parseNullableId, parseSafeId, unique } from "./representative-case-parsing.ts";
import type {
  HypothesisRole,
  RepresentativeCaseExport,
  RepresentativeCaseReadSource,
  RepresentativeCaseSourceLedger,
  RepresentativeCaseSourceLedgerEntry,
  SourceLedgerRelations,
  SourceLedgerUse,
  UnknownRecord,
} from "./representative-case-types.ts";
import { redactSensitiveText } from "./representative-case-sanitization.ts";

export function buildSourceLedger(
  value: unknown,
  store: RepresentativeCaseReadSource,
  artifacts: RepresentativeCaseExport["artifacts"],
  rootReasons: string[],
): RepresentativeCaseSourceLedger {
  const relations = new Map<string, SourceLedgerRelations>();
  const addRelation = (evidenceId: string, use: SourceLedgerUse): void => {
    const existing = relations.get(evidenceId) ?? { artifactUses: [], hypothesisRoles: [] };
    const useKey = `${use.artifact_id}\0${use.relation}\0${use.candidate_id ?? ""}`;
    if (
      !existing.artifactUses.some(
        (item) => `${item.artifact_id}\0${item.relation}\0${item.candidate_id ?? ""}` === useKey,
      )
    ) {
      existing.artifactUses.push(use);
    }
    relations.set(evidenceId, existing);
  };
  const addHypothesisRole = (evidenceId: string, role: HypothesisRole): void => {
    const existing = relations.get(evidenceId) ?? { artifactUses: [], hypothesisRoles: [] };
    const roleKey = `${role.artifact_id}\0${role.candidate_id}\0${role.role}`;
    if (
      !existing.hypothesisRoles.some((item) => `${item.artifact_id}\0${item.candidate_id}\0${item.role}` === roleKey)
    ) {
      existing.hypothesisRoles.push(role);
    }
    relations.set(evidenceId, existing);
  };

  const relationReasonStart = rootReasons.length;
  collectSourceRelations(store, artifacts, addRelation, addHypothesisRole, rootReasons);
  const relationReasons = rootReasons.slice(relationReasonStart);
  if (!Array.isArray(value)) {
    rootReasons.push("source_ledger_unknown");
    return {
      status: "unknown",
      records: [],
      unknown_records: 0,
      unknown_reasons: unique([...relationReasons, "source_ledger_unknown"]),
    };
  }

  const records: RepresentativeCaseSourceLedgerEntry[] = [];
  const ledgerReasons: string[] = [...relationReasons];
  const observedEvidenceIds = new Set<string>();
  let unknownRecords = relationReasons.length;

  for (const row of value) {
    if (!isRecord(row)) {
      ledgerReasons.push("source_evidence_row_malformed");
      unknownRecords += 1;
      continue;
    }
    const evidenceId = parseSafeId(row.id);
    if (evidenceId === null) {
      ledgerReasons.push("source_evidence_id_unknown");
      unknownRecords += 1;
      continue;
    }
    const rowReasons: string[] = [];
    const attemptId = parseNullableId(row.attempt_id);
    if (row.attempt_id !== null && row.attempt_id !== undefined && attemptId === null) {
      rowReasons.push("source_attempt_id_unknown");
    }
    const tool =
      typeof row.tool_name === "string" && (row.tool_name === "arxiv_search" || row.tool_name === "crossref_search")
        ? row.tool_name
        : null;
    if (tool === null) rowReasons.push("source_tool_unknown");
    const query = typeof row.query === "string" && row.query.length <= 4000 ? redactSensitiveText(row.query) : null;
    if (query === null) rowReasons.push("source_query_unknown");
    const evidenceStatus = typeof row.status === "string" ? row.status : null;
    if (evidenceStatus === null) rowReasons.push("source_status_unknown");
    const output = isRecord(row.output) ? row.output : null;
    if (output === null) rowReasons.push("source_output_unknown");

    const citations = output === null ? [] : readSourceCitations(output.citations, rowReasons);
    const sourceRows = citations.length === 0 ? [null] : citations;
    if (citations.length === 0 && evidenceStatus === "succeeded") {
      rowReasons.push("succeeded_without_citation");
    }

    for (const citation of sourceRows) {
      observedEvidenceIds.add(evidenceId);
      const citationResult = citation === null ? { source: null, reasons: [] } : sourceFromCitation(citation);
      const reasons = unique([
        ...rowReasons,
        ...citationResult.reasons,
        ...(citation === null ? ["no_citable_source"] : []),
      ]);
      const relationsForEvidence = relations.get(evidenceId) ?? { artifactUses: [], hypothesisRoles: [] };
      const entry: RepresentativeCaseSourceLedgerEntry = {
        evidence_id: evidenceId,
        attempt_id: attemptId,
        evidence_status: evidenceStatus,
        acquisition: {
          method: tool !== null && query !== null ? "search_tool" : "unknown",
          tool,
          query,
        },
        availability: {
          status: availabilityStatus(evidenceStatus),
          evidence_status: evidenceStatus,
        },
        source: citationResult.source,
        hypothesis_roles: [...relationsForEvidence.hypothesisRoles].sort(compareHypothesisRole),
        artifact_uses: [...relationsForEvidence.artifactUses].sort(compareSourceUse),
        limitations: sourceLimitations(tool, evidenceStatus, citationResult.source),
        unknown_reasons: reasons,
      };
      records.push(entry);
      if (reasons.some((reason) => reason !== "no_citable_source")) unknownRecords += 1;
    }
    ledgerReasons.push(...rowReasons.filter((reason) => reason !== "no_citable_source"));
  }

  for (const [evidenceId, sourceRelations] of relations) {
    if (observedEvidenceIds.has(evidenceId)) continue;
    const unknownReasons = ["evidence_missing"];
    records.push({
      evidence_id: evidenceId,
      attempt_id: null,
      evidence_status: null,
      acquisition: { method: "unknown", tool: null, query: null },
      availability: { status: "unknown", evidence_status: null },
      source: null,
      hypothesis_roles: [...sourceRelations.hypothesisRoles].sort(compareHypothesisRole),
      artifact_uses: [...sourceRelations.artifactUses].sort(compareSourceUse),
      limitations: ["evidence_not_found"],
      unknown_reasons: unknownReasons,
    });
    ledgerReasons.push(...unknownReasons);
    unknownRecords += 1;
  }

  const unknownReasons = unique(ledgerReasons);
  rootReasons.push(...unknownReasons);
  return {
    status: records.length === 0 ? "unknown" : unknownRecords === 0 ? "known" : "partial",
    records,
    unknown_records: unknownRecords,
    unknown_reasons: unknownReasons,
  };
}

function collectSourceRelations(
  store: RepresentativeCaseReadSource,
  artifacts: RepresentativeCaseExport["artifacts"],
  addRelation: (evidenceId: string, use: SourceLedgerUse) => void,
  addHypothesisRole: (evidenceId: string, role: HypothesisRole) => void,
  rootReasons: string[],
): void {
  const groups: Array<{
    artifactType: SourceLedgerUse["artifact_type"];
    ids: readonly string[];
  }> = [
    { artifactType: "research", ids: artifacts.research },
    { artifactType: "hypothesis", ids: artifacts.hypothesis },
    { artifactType: "evidence-review", ids: artifacts.evidence_review },
    { artifactType: "research-plan", ids: artifacts.research_plan },
    { artifactType: "review", ids: artifacts.review },
  ];
  for (const group of groups) {
    for (const artifactId of group.ids) {
      let stored;
      try {
        stored = store.artifact(artifactId);
      } catch {
        rootReasons.push(`source_${group.artifactType}_artifact_unavailable`);
        continue;
      }
      if (stored === null || !isRecord(stored.content)) {
        rootReasons.push(`source_${group.artifactType}_artifact_unknown`);
        continue;
      }
      collectArtifactRelations(
        group.artifactType,
        artifactId,
        stored.content,
        addRelation,
        addHypothesisRole,
        rootReasons,
      );
    }
  }
}

function collectArtifactRelations(
  artifactType: SourceLedgerUse["artifact_type"],
  artifactId: string,
  content: UnknownRecord,
  addRelation: (evidenceId: string, use: SourceLedgerUse) => void,
  addHypothesisRole: (evidenceId: string, role: HypothesisRole) => void,
  reasons: string[],
): void {
  const addIds = (value: unknown, relation: SourceLedgerUse["relation"], candidateId: string | null = null): void => {
    if (!Array.isArray(value)) {
      if (value !== undefined && value !== null) reasons.push(`source_${artifactType}_${relation}_unknown`);
      return;
    }
    for (const item of value) {
      const evidenceId = parseSafeId(item);
      if (evidenceId === null) {
        reasons.push(`source_${artifactType}_evidence_id_unknown`);
        continue;
      }
      addRelation(evidenceId, {
        artifact_id: artifactId,
        artifact_type: artifactType,
        relation,
        candidate_id: candidateId,
      });
    }
  };

  switch (artifactType) {
    case "research": {
      const queries = Array.isArray(content.queries) ? content.queries : [];
      for (const query of queries) {
        if (isRecord(query))
          addIds(query.evidence_id === undefined ? undefined : [query.evidence_id], "research_query");
      }
      const claims = Array.isArray(content.claims) ? content.claims : [];
      for (const claim of claims) {
        if (isRecord(claim)) addIds(claim.evidence_ids, "research_claim");
      }
      break;
    }
    case "hypothesis": {
      const candidates = Array.isArray(content.candidates) ? content.candidates : [];
      for (const candidate of candidates) {
        if (!isRecord(candidate)) continue;
        const candidateId = parseSafeId(candidate.candidate_id);
        addIds(candidate.supporting_evidence_ids, "hypothesis_supporting", candidateId);
        addIds(candidate.opposing_evidence_ids, "hypothesis_opposing", candidateId);
        if (candidateId !== null && Array.isArray(candidate.supporting_evidence_ids)) {
          for (const item of candidate.supporting_evidence_ids) {
            const evidenceId = parseSafeId(item);
            if (evidenceId !== null)
              addHypothesisRole(evidenceId, { artifact_id: artifactId, candidate_id: candidateId, role: "supporting" });
          }
        }
        if (candidateId !== null && Array.isArray(candidate.opposing_evidence_ids)) {
          for (const item of candidate.opposing_evidence_ids) {
            const evidenceId = parseSafeId(item);
            if (evidenceId !== null)
              addHypothesisRole(evidenceId, { artifact_id: artifactId, candidate_id: candidateId, role: "opposing" });
          }
        }
      }
      const comparison = isRecord(content.comparison) ? content.comparison : null;
      const evaluations = Array.isArray(comparison?.evaluations) ? comparison.evaluations : [];
      for (const evaluation of evaluations) {
        if (isRecord(evaluation)) {
          addIds(evaluation.evidence_ids, "hypothesis_comparison", parseSafeId(evaluation.candidate_id));
        }
      }
      break;
    }
    case "evidence-review": {
      const assessments = Array.isArray(content.assessments) ? content.assessments : [];
      for (const assessment of assessments) {
        if (isRecord(assessment)) addIds(assessment.evidence_ids, "evidence_review");
      }
      break;
    }
    case "research-plan": {
      const experiments = isRecord(content.experiments) ? content.experiments : null;
      const baselines = Array.isArray(experiments?.baselines) ? experiments.baselines : [];
      for (const baseline of baselines) {
        if (isRecord(baseline))
          addIds(baseline.evidence_id === undefined ? undefined : [baseline.evidence_id], "plan_grounding");
      }
      const metrics = Array.isArray(experiments?.metrics) ? experiments.metrics : [];
      for (const metric of metrics) {
        if (isRecord(metric))
          addIds(metric.evidence_id === undefined ? undefined : [metric.evidence_id], "plan_grounding");
      }
      addIds(content.verification_evidence_ids, "plan_verification");
      break;
    }
    case "review": {
      addIds(content.independent_evidence_ids, "review_independent");
      break;
    }
  }
}

function readSourceCitations(value: unknown, reasons: string[]): UnknownRecord[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    reasons.push("citations_malformed");
    return [];
  }
  return value.filter(isRecord);
}

function sourceFromCitation(citation: UnknownRecord): {
  source: RepresentativeCaseSourceLedgerEntry["source"];
  reasons: string[];
} {
  const reasons: string[] = [];
  const sourceType = citation.source_type === "web" || citation.source_type === "arxiv" ? citation.source_type : null;
  if (sourceType === null) reasons.push("source_type_unknown");
  const title =
    typeof citation.title === "string" && citation.title.length <= 4000 ? redactSensitiveText(citation.title) : null;
  if (title === null) reasons.push("source_title_unknown");
  const locator =
    typeof citation.locator === "string" && citation.locator.length <= 4000
      ? redactSensitiveText(citation.locator)
      : null;
  if (locator === null) reasons.push("source_locator_unknown");
  const url =
    typeof citation.url === "string" && citation.url.length <= 4000 ? redactSensitiveText(citation.url) : null;

  return {
    source: { source_type: sourceType, title, locator, url },
    reasons,
  };
}

function sourceLimitations(
  tool: string | null,
  status: string | null,
  source: RepresentativeCaseSourceLedgerEntry["source"],
): string[] {
  const limitations: string[] = [];
  if (status && status !== "succeeded") limitations.push(`retrieval_status_${status}`);
  if (tool === "arxiv_search") limitations.push("metadata_only_no_full_text_verification");
  if (tool === "crossref_search") limitations.push("doi_registry_metadata_only");
  if (!source || (!source.locator && !source.url)) limitations.push("citation_missing_locator_and_url");
  return unique(limitations);
}

function availabilityStatus(status: string | null): RepresentativeCaseSourceLedgerEntry["availability"]["status"] {
  switch (status) {
    case "succeeded":
      return "available";
    case "partial":
      return "partial";
    case "source_unavailable":
    case "timeout":
    case "rate_limited":
    case "not_configured":
      return "unavailable";
    case null:
    default:
      return "unknown";
  }
}

function compareHypothesisRole(left: HypothesisRole, right: HypothesisRole): number {
  return (
    left.artifact_id.localeCompare(right.artifact_id) ||
    left.candidate_id.localeCompare(right.candidate_id) ||
    left.role.localeCompare(right.role)
  );
}

function compareSourceUse(left: SourceLedgerUse, right: SourceLedgerUse): number {
  return (
    left.artifact_id.localeCompare(right.artifact_id) ||
    left.artifact_type.localeCompare(right.artifact_type) ||
    left.relation.localeCompare(right.relation) ||
    (left.candidate_id ?? "").localeCompare(right.candidate_id ?? "")
  );
}
