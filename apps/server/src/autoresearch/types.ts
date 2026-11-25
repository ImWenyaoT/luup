/** Autoresearch 运行期共享类型（冻结证据面，不共享隐藏对话）。 */

export type EvidenceHit = {
  evidenceId: string;
  source: "arxiv" | "crossref" | "web";
  query: string;
  title: string;
  locator: string;
  url: string | null;
  summary: string;
};

export type CritiqueVerdict = "supports" | "contradicts" | "insufficient";

export type CritiqueResult = {
  verdict: CritiqueVerdict;
  rationale: string;
  gaps: string[];
};

export type AutoresearchGate = {
  ok: boolean;
  reason: string;
  critique: CritiqueResult | null;
  evidenceCount: number;
};

export type AutoresearchRuntime = {
  evidence: EvidenceHit[];
  critiques: CritiqueResult[];
  browserCommands: string[];
};
