import type { AutoresearchGate, AutoresearchRuntime, CritiqueResult } from "./types.ts";

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

export function parseCritiqueText(text: string): CritiqueResult {
  const lower = text.toLowerCase();
  let verdict: CritiqueResult["verdict"] = "insufficient";
  if (/\bcontradict/.test(lower) || /\b否决\b/.test(text) || /\breject/.test(lower)) {
    verdict = "contradicts";
  } else if (/\bsupports?\b/.test(lower) || /\b支持\b/.test(text) || /\bverified\b/.test(lower)) {
    verdict = "supports";
  }
  const gaps: string[] = [];
  for (const line of text.split(/\n+/)) {
    const trimmed = line.trim();
    if (/^[-*•]\s+/.test(trimmed) || /gap/i.test(trimmed)) {
      gaps.push(trimmed.replace(/^[-*•]\s+/, "").slice(0, 240));
    }
  }
  return {
    verdict,
    rationale: text.slice(0, 4000),
    gaps: gaps.slice(0, 12),
  };
}
