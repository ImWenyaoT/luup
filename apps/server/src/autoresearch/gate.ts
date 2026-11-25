import type { AutoresearchGate, AutoresearchRuntime, CritiqueResult, CritiqueVerdict } from "./types.ts";

/** 森林硬闸：无证据或 critique 否决则 fail-closed。 */
export function evaluateAutoresearchGate(runtime: AutoresearchRuntime): AutoresearchGate {
  const critique = runtime.critiques.at(-1) ?? null;
  if (runtime.evidence.length === 0) {
    return {
      ok: false,
      reason: "no_evidence",
      critique,
      evidenceCount: 0,
    };
  }
  if (!critique) {
    return {
      ok: false,
      reason: "missing_critique",
      critique: null,
      evidenceCount: runtime.evidence.length,
    };
  }
  if (critique.verdict === "contradicts") {
    return {
      ok: false,
      reason: "critique_contradicts",
      critique,
      evidenceCount: runtime.evidence.length,
    };
  }
  if (critique.verdict === "insufficient") {
    return {
      ok: false,
      reason: "critique_insufficient",
      critique,
      evidenceCount: runtime.evidence.length,
    };
  }
  return {
    ok: true,
    reason: "verified",
    critique,
    evidenceCount: runtime.evidence.length,
  };
}

const VERDICT_LINE = /^\s*verdict\s*:\s*(supports|contradicts|insufficient)\b/im;

/** 只认显式 `verdict:` 行；rationale 正文不参与判定（避免「does not support」误判）。 */
export function parseCritiqueText(text: string): CritiqueResult {
  const match = text.match(VERDICT_LINE);
  const verdict = (match?.[1]?.toLowerCase() as CritiqueVerdict | undefined) ?? "insufficient";
  const gaps: string[] = [];
  for (const line of text.split(/\n+/)) {
    const trimmed = line.trim();
    if (/^[-*•]\s+/.test(trimmed) || /^gaps?\s*:/i.test(trimmed)) {
      gaps.push(
        trimmed
          .replace(/^[-*•]\s+/, "")
          .replace(/^gaps?\s*:\s*/i, "")
          .slice(0, 240),
      );
    }
  }
  return {
    verdict,
    rationale: text.slice(0, 4000),
    gaps: gaps.slice(0, 12),
  };
}

/** 宿主拥有的交付文本：gate 不过则不交出 coordinator draft。 */
export function formatGateDelivery(gate: AutoresearchGate, draftText: string): string {
  if (gate.ok) {
    return [
      draftText.trim(),
      "",
      "---",
      `[host-gate] verified · evidence=${gate.evidenceCount} · verdict=${gate.critique?.verdict ?? "n/a"}`,
    ].join("\n");
  }
  return [
    "[host-gate] FAIL-CLOSED",
    `reason: ${gate.reason}`,
    `evidence_count: ${gate.evidenceCount}`,
    gate.critique ? `critique: ${gate.critique.verdict}` : "critique: (missing)",
    gate.critique?.rationale ? `rationale: ${gate.critique.rationale.slice(0, 800)}` : null,
    gate.critique?.gaps?.length ? `gaps: ${gate.critique.gaps.join("; ")}` : null,
    "",
    "Coordinator draft was not delivered. Forest hard gate rejected merge.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
