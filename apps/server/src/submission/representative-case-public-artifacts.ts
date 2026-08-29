import { projectArtifact, type PublicArtifact } from "../api/projection.ts";

import type {
  RepresentativeCaseExport,
  RepresentativeCasePublicArtifact,
  RepresentativeCaseReadSource,
} from "./representative-case-types.ts";
import { sanitizePublic } from "./representative-case-sanitization.ts";

export function buildPublicArtifacts(
  store: RepresentativeCaseReadSource,
  artifacts: RepresentativeCaseExport["artifacts"],
  rootReasons: string[],
): RepresentativeCaseExport["public_artifacts"] {
  return {
    research: publicArtifactList(store, artifacts.research, rootReasons, "research"),
    hypothesis: publicArtifactList(store, artifacts.hypothesis, rootReasons, "hypothesis"),
    evidence_review: publicArtifactList(store, artifacts.evidence_review, rootReasons, "evidence_review"),
  };
}

function publicArtifactList(
  store: RepresentativeCaseReadSource,
  ids: readonly string[],
  rootReasons: string[],
  kind: string,
): RepresentativeCasePublicArtifact[] {
  const result: RepresentativeCasePublicArtifact[] = [];
  for (const id of ids) {
    const item = readPublicArtifact(store, id, rootReasons, `${kind}_artifact`);
    if (item !== null) result.push(item);
  }
  return result;
}

export function readPublicArtifact(
  store: RepresentativeCaseReadSource,
  artifactId: string | null,
  rootReasons: string[],
  diagnosticLabel: string,
): RepresentativeCasePublicArtifact | null {
  if (artifactId === null) return null;
  const stored = store.artifact(artifactId);
  if (stored === null) {
    rootReasons.push(`${diagnosticLabel}_missing`);
    return null;
  }
  try {
    const projected = projectArtifact(stored);
    return toSubmissionPublicArtifact(projected);
  } catch {
    rootReasons.push(`${diagnosticLabel}_malformed`);
    return null;
  }
}

function toSubmissionPublicArtifact(artifact: PublicArtifact): RepresentativeCasePublicArtifact {
  switch (artifact.content.artifact_type) {
    case "research":
      return {
        id: artifact.id,
        type: artifact.type,
        content: sanitizePublic({
          artifact_type: artifact.content.artifact_type,
          research_framing: artifact.content.research_framing,
          summary: artifact.content.summary,
          claims: artifact.content.claims,
          limitations: artifact.content.limitations,
        }),
      } as RepresentativeCasePublicArtifact;
    case "hypothesis":
      return {
        id: artifact.id,
        type: artifact.type,
        content: sanitizePublic({
          artifact_type: artifact.content.artifact_type,
          question: artifact.content.question,
          candidates: artifact.content.candidates,
          comparison: {
            criteria: artifact.content.comparison.criteria.map((item) => ({ criterion: item.criterion })),
            evaluations: artifact.content.comparison.evaluations.map((item) => ({
              candidate_id: item.candidate_id,
              rank: item.rank,
              strengths: item.strengths,
              weaknesses: item.weaknesses,
              evidence_ids: item.evidence_ids,
            })),
            selected_candidate_id: artifact.content.comparison.selected_candidate_id,
          },
          selection_status: artifact.content.selection_status,
        }),
      } as RepresentativeCasePublicArtifact;
    case "evidence-review":
      return {
        id: artifact.id,
        type: artifact.type,
        content: sanitizePublic({
          artifact_type: artifact.content.artifact_type,
          gaps: artifact.content.gaps,
          assessments: artifact.content.assessments,
        }),
      } as RepresentativeCasePublicArtifact;
    case "research-plan":
      return {
        id: artifact.id,
        type: artifact.type,
        content: sanitizePublic({
          artifact_type: artifact.content.artifact_type,
          problem_statement: artifact.content.problem_statement,
          technical_details: artifact.content.technical_details,
          datasets: artifact.content.datasets,
          source: artifact.content.source,
          target: artifact.content.target,
          execution_plan: artifact.content.execution_plan,
          paper_title: artifact.content.paper_title,
          paper_abstract: artifact.content.paper_abstract,
          methods: artifact.content.methods,
          experiments: artifact.content.experiments,
          results: artifact.content.results,
          references: artifact.content.references,
        }),
      } as RepresentativeCasePublicArtifact;
    case "review":
      return {
        id: artifact.id,
        type: artifact.type,
        content: sanitizePublic({
          artifact_type: artifact.content.artifact_type,
          accepted: artifact.content.accepted,
          scores: artifact.content.scores,
          weaknesses: artifact.content.weaknesses,
          feedback: artifact.content.feedback,
        }),
      } as RepresentativeCasePublicArtifact;
  }
}
