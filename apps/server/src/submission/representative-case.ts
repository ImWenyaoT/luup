import { z } from "zod";

import { findQuestion, science125Integrity } from "../domain/science125.ts";
import { buildRound, buildTrace, buildUsage, buildVerification, unknownCase } from "./representative-case-facts.ts";
import {
  isRecord,
  lastEvent,
  parseChangedFieldsList,
  parseSafeId,
  readArtifacts,
  readEvents,
  unique,
} from "./representative-case-parsing.ts";
import { buildPublicArtifacts } from "./representative-case-public-artifacts.ts";
import { redactSensitiveText } from "./representative-case-sanitization.ts";
import { buildSourceLedger } from "./representative-case-source-ledger.ts";
import {
  FAILURE_CODE_SET,
  REPRESENTATIVE_CASE_FORMAT,
  REPRESENTATIVE_CASE_VERSION,
  RUN_STATUS_SET,
  type CaseStatus,
  type RepresentativeCaseExport,
  type RepresentativeCaseReadSource,
  type RepresentativeCaseStrictReport,
  type UnknownRecord,
} from "./representative-case-types.ts";

export function buildRepresentativeCase(
  store: RepresentativeCaseReadSource,
  runId: string,
  generatedAt = new Date().toISOString(),
): RepresentativeCaseExport {
  const safeRunId = parseSafeId(runId);
  const snapshot = store.snapshot(runId);
  if (snapshot === null) return unknownCase(safeRunId, generatedAt, "run_not_found");

  const rootReasons: string[] = [];
  const statusStr =
    typeof snapshot.status === "string" && RUN_STATUS_SET.has(snapshot.status) ? snapshot.status : "unknown";
  const runStatus: CaseStatus = statusStr as CaseStatus;
  if (runStatus === "unknown") rootReasons.push("run_status_unknown");

  let science125Id: number | null = null;
  if (snapshot.science125_id !== null && snapshot.science125_id !== undefined) {
    const parsed = z.number().int().min(1).safeParse(snapshot.science125_id);
    if (parsed.success) science125Id = parsed.data;
    else rootReasons.push("science125_id_unknown");
  }

  const question =
    typeof snapshot.question === "string" && snapshot.question.length <= 4000
      ? redactSensitiveText(snapshot.question)
      : null;
  if (question === null) rootReasons.push("question_unknown");

  let errorCode: string | null = null;
  if (snapshot.error_code !== null && snapshot.error_code !== undefined) {
    if (typeof snapshot.error_code === "string" && FAILURE_CODE_SET.has(snapshot.error_code)) {
      errorCode = snapshot.error_code;
    } else {
      rootReasons.push("error_code_unknown");
    }
  }

  const finalArtifactId = parseSafeId(snapshot.final_artifact_id);
  if (snapshot.final_artifact_id !== null && finalArtifactId === null) rootReasons.push("final_artifact_id_unknown");

  const events = readEvents(snapshot.recent_events, rootReasons);
  const artifacts = readArtifacts(snapshot.artifacts, rootReasons);
  const publicArtifacts = buildPublicArtifacts(store, artifacts, rootReasons);
  const sourceLedger = buildSourceLedger(snapshot.tool_evidence, store, artifacts, rootReasons);
  const round1 = buildRound(1, store, events, artifacts, rootReasons);
  const round2 = buildRound(2, store, events, artifacts, rootReasons);
  const verification = buildVerification(events, rootReasons);
  const trace = buildTrace(events, rootReasons);
  const usage = buildUsage(events, rootReasons);

  return {
    format: REPRESENTATIVE_CASE_FORMAT,
    version: REPRESENTATIVE_CASE_VERSION,
    generated_at: generatedAt,
    run_id: safeRunId,
    run: {
      science125_id: science125Id,
      status: runStatus,
      question,
      error_code: errorCode,
      final_artifact_id: finalArtifactId,
    },
    artifacts,
    public_artifacts: publicArtifacts,
    source_ledger: sourceLedger,
    rounds: { round1, round2 },
    verification,
    trace,
    usage,
    unknown_reasons: unique(rootReasons),
  };
}

export function checkRepresentativeCaseStrict(
  store: RepresentativeCaseReadSource,
  value: RepresentativeCaseExport,
): RepresentativeCaseStrictReport {
  const reasons: string[] = [];
  const catalog = science125Integrity();
  if (!catalog.ok) reasons.push("frozen_catalog_invalid");
  const science125Id = value.run.science125_id;
  if (science125Id === null || findQuestion(science125Id) === null) {
    reasons.push("science125_id_not_in_frozen_catalog");
  }
  if (value.run.status !== "completed") reasons.push("run_not_completed");
  if (!value.rounds.round1.present) reasons.push("round1_missing");
  if (!value.rounds.round2.present) reasons.push("round2_missing");
  if (
    value.source_ledger.status !== "known" ||
    value.source_ledger.records.length === 0 ||
    value.source_ledger.unknown_records > 0
  ) {
    reasons.push("source_ledger_missing_or_unknown");
  }

  const snapshot = value.run_id === null ? null : store.snapshot(value.run_id);
  const events = snapshot === null ? [] : readEvents(snapshot.recent_events, []);
  if (!events.some((event) => event.kind === "feedback.received")) reasons.push("feedback_missing");

  const revisions = events.filter((event) => event.kind === "revision.applied");
  if (revisions.length === 0) {
    reasons.push("revision_missing");
  } else if (
    !revisions.some((event) => {
      const from = parseSafeId(event.payload.from_artifact_id);
      const to = parseSafeId(event.payload.to_artifact_id);
      const fields = parseChangedFieldsList(event.payload.changed_fields, []);
      return from !== null && to !== null && fields.length > 0;
    })
  ) {
    reasons.push("revision_facts_incomplete");
  }

  const verificationEvent = lastEvent(events, "verification.references");
  if (verificationEvent === null) {
    reasons.push(
      "verification_missing",
      "verification_b1_missing",
      "verification_b2_missing",
      "verification_b3_missing",
      "verification_b4_missing",
    );
  } else {
    if (verificationEvent.payload.ok !== true) reasons.push("verification_not_passed");
    const checks = Array.isArray(verificationEvent.payload.checks) ? verificationEvent.payload.checks : [];
    for (const family of ["b1", "b2", "b3", "b4"] as const) {
      const familyChecks = checks.filter(
        (check): check is UnknownRecord =>
          isRecord(check) && typeof check.id === "string" && check.id.toLowerCase().startsWith(`${family}.`),
      );
      if (familyChecks.length === 0) reasons.push(`verification_${family}_missing`);
      else if (familyChecks.some((check) => check.pass !== true)) reasons.push(`verification_${family}_failed`);
    }
  }

  if (
    value.usage.status !== "known" ||
    value.usage.records === 0 ||
    value.usage.unknown_records !== 0 ||
    value.usage.total_tokens === null
  ) {
    reasons.push("usage_missing_or_unknown");
  }
  return { passed: reasons.length === 0, reasons: unique(reasons) };
}

export { renderRepresentativeCaseMarkdown } from "./representative-case-markdown.ts";
export {
  type RepresentativeCaseExport,
  type RepresentativeCasePublicArtifact,
  type RepresentativeCaseReadSource,
  type RepresentativeCaseRound,
  type RepresentativeCaseSourceLedger,
  type RepresentativeCaseSourceLedgerEntry,
  type RepresentativeCaseStrictReport,
  type RepresentativeCaseTrace,
  type RepresentativeCaseUsage,
  type RepresentativeCaseVerification,
} from "./representative-case-types.ts";
